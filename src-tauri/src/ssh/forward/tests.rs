use super::*;

fn forward_spec(target_port: u16) -> ForwardSpec {
    ForwardSpec {
        id: "forward".into(),
        kind: "local".into(),
        bind_host: "127.0.0.1".into(),
        bind_port: 8080,
        target_host: Some("localhost".into()),
        target_port: Some(target_port),
        hops: Vec::new(),
    }
}

#[tokio::test]
async fn socks5_parses_domain_connect_without_premature_success() {
    let (mut client, mut server) = tokio::io::duplex(256);
    let client_task = tokio::spawn(async move {
        client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut method_reply = [0u8; 2];
        client.read_exact(&mut method_reply).await.unwrap();
        assert_eq!(method_reply, [0x05, 0x00]);
        let host = b"example.com";
        let mut request = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
        request.extend_from_slice(host);
        request.extend_from_slice(&8080u16.to_be_bytes());
        client.write_all(&request).await.unwrap();
        let mut reply = [0u8; 10];
        assert!(
            tokio::time::timeout(Duration::from_millis(20), client.read_exact(&mut reply))
                .await
                .is_err()
        );
    });
    assert_eq!(
        socks5_request(&mut server).await.unwrap(),
        ("example.com".into(), 8080)
    );
    client_task.await.unwrap();
}

#[tokio::test]
async fn socks5_rejects_unoffered_authentication_method() {
    let (mut client, mut server) = tokio::io::duplex(64);
    let client_task = tokio::spawn(async move {
        client.write_all(&[0x05, 0x01, 0x02]).await.unwrap();
        let mut reply = [0u8; 2];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply, [0x05, 0xff]);
    });
    assert!(socks5_request(&mut server).await.is_err());
    client_task.await.unwrap();
}

#[tokio::test]
async fn socks5_rejects_unsupported_commands_and_zero_ports() {
    for request in [
        [0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0, 80],
        [0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 0],
    ] {
        let (mut client, mut server) = tokio::io::duplex(64);
        let client_task = tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut method_reply = [0u8; 2];
            client.read_exact(&mut method_reply).await.unwrap();
            client.write_all(&request).await.unwrap();
            let mut reply = [0u8; 10];
            client.read_exact(&mut reply).await.unwrap();
            assert_ne!(reply[1], 0x00);
        });
        assert!(socks5_request(&mut server).await.is_err());
        client_task.await.unwrap();
    }
}

#[test]
fn reconnect_delay_uses_bounded_exponential_backoff() {
    assert_eq!(retry_delay(1), Duration::from_secs(1));
    assert_eq!(retry_delay(2), Duration::from_secs(2));
    assert_eq!(retry_delay(6), Duration::from_secs(30));
    assert_eq!(retry_delay(30), Duration::from_secs(30));
}

#[test]
fn old_generation_cannot_remove_replacement() {
    let active = Mutex::new(HashMap::new());
    let (shutdown, _) = watch::channel(false);
    let (_, finished) = watch::channel(false);
    active.lock().insert(
        "forward".into(),
        ActiveForward {
            generation: 2,
            spec: forward_spec(80),
            ready: watch::channel(None).1,
            shutdown,
            finished,
        },
    );

    remove_finished(&active, "forward", 1);
    assert_eq!(active.lock().get("forward").unwrap().generation, 2);
    remove_finished(&active, "forward", 2);
    assert!(!active.lock().contains_key("forward"));
}

#[test]
fn stop_all_cancels_active_forwards_and_invalidates_starts() {
    let manager = ForwardManager::new();
    let lifecycle = manager.lifecycle.load(Ordering::Acquire);
    let (shutdown, shutdown_rx) = watch::channel(false);
    let (_, finished) = watch::channel(false);
    manager.active.lock().insert(
        "forward".into(),
        ActiveForward {
            generation: 1,
            spec: forward_spec(80),
            ready: watch::channel(None).1,
            shutdown,
            finished,
        },
    );

    manager.stop_all();

    assert!(manager.active.lock().is_empty());
    assert!(*shutdown_rx.borrow());
    assert_ne!(manager.lifecycle.load(Ordering::Acquire), lifecycle);
}

#[tokio::test]
async fn conditional_stop_leaves_replacement_running() {
    let manager = ForwardManager::new();
    let current = forward_spec(80);
    let (shutdown, _) = watch::channel(false);
    let (_, finished) = watch::channel(false);
    manager.active.lock().insert(
        current.id.clone(),
        ActiveForward {
            generation: 1,
            spec: current.clone(),
            ready: watch::channel(None).1,
            shutdown,
            finished,
        },
    );

    assert!(!manager.stop_if_spec(&forward_spec(81)).await);
    assert!(manager.active_specs().iter().any(|spec| spec == &current));
}

#[tokio::test]
async fn operations_serialize_each_id_and_release_unused_locks() {
    let manager = Arc::new(ForwardManager::new());
    let first = manager.operation("one").await;
    let task_manager = manager.clone();
    let waiting = tokio::spawn(async move { task_manager.operation("one").await });
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    let other = tokio::time::timeout(Duration::from_secs(1), manager.operation("two"))
        .await
        .unwrap();
    drop(first);
    let next = tokio::time::timeout(Duration::from_secs(1), waiting)
        .await
        .unwrap()
        .unwrap();
    drop(next);
    drop(other);
    let _last = manager.operation("three").await;
    assert_eq!(manager.operations.lock().len(), 1);
}

#[tokio::test]
async fn duplicate_starts_share_readiness_and_preserve_error_codes() {
    let (sender, receiver) = watch::channel(None);
    let first = tokio::spawn(PendingForward(receiver.clone()).wait());
    let second = tokio::spawn(PendingForward(receiver).wait());
    tokio::task::yield_now().await;
    assert!(!first.is_finished());
    assert!(!second.is_finished());
    ForwardReady(sender).send(Err(AppError::Auth("credentials rejected".into())));
    for task in [first, second] {
        let error = task.await.unwrap().unwrap_err();
        assert_eq!(error.code(), "auth");
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], "auth");
        assert!(json["message"]
            .as_str()
            .unwrap()
            .contains("credentials rejected"));
    }
}

#[tokio::test]
async fn dropping_startup_sender_cancels_all_waiters() {
    let (sender, receiver) = watch::channel(None);
    drop(sender);
    assert_eq!(
        PendingForward(receiver).wait().await.unwrap_err().code(),
        "cancelled"
    );
}

#[tokio::test]
async fn stop_waits_for_already_retiring_forward() {
    let manager = Arc::new(ForwardManager::new());
    let (finished, receiver) = watch::channel(false);
    manager.retiring.lock().insert(
        "forward".into(),
        RetiringForward {
            generation: 1,
            finished: receiver,
        },
    );
    let stopping = manager.clone();
    let stopped = tokio::spawn(async move { stopping.stop("forward").await });
    tokio::task::yield_now().await;
    assert!(!stopped.is_finished());
    finished.send(true).unwrap();
    assert!(stopped.await.unwrap());
    assert!(manager.retiring.lock().is_empty());
}

fn status_event(generation: u64, sequence: u64) -> StatusEvent {
    StatusEvent {
        forward_id: "forward".into(),
        status: "active".into(),
        message: None,
        code: None,
        reconnect_attempt: None,
        generation,
        sequence,
        connection_failures: 0,
        last_connection_error: None,
    }
}

#[test]
fn stale_generations_cannot_overwrite_newer_status_or_diagnostics() {
    let mut runtime = HashMap::new();
    let mut active = status_event(2, 3);
    active.connection_failures = 5;
    active.last_connection_error = Some("connection refused".into());
    assert!(store_event(&mut runtime, &active));
    assert!(!store_event(&mut runtime, &status_event(1, 9)));
    assert!(!store_event(&mut runtime, &status_event(2, 2)));
    assert!(store_event(&mut runtime, &status_event(2, 4)));
    assert_eq!(runtime["forward"].connection_failures, 5);
    assert_eq!(
        runtime["forward"].last_connection_error.as_deref(),
        Some("connection refused")
    );
    assert!(store_event(&mut runtime, &status_event(3, 5)));
    assert_eq!(runtime["forward"].connection_failures, 0);
    assert!(runtime["forward"].last_connection_error.is_none());
}

#[test]
fn connection_diagnostics_accumulate_failures_without_counting_successes() {
    let mut diagnostics = ConnectionDiagnostics::default();
    diagnostics.observe(Some(Ok(Ok(()))));
    diagnostics.observe(Some(Ok(Err(AppError::Dns("not resolved".into())))));
    diagnostics.observe(Some(Ok(Err(AppError::Network(
        "connection refused".into(),
    )))));
    assert_eq!(diagnostics.failures, 2);
    assert_eq!(
        diagnostics.last_error.as_deref(),
        Some("connection refused")
    );
}

#[test]
fn flapping_connections_keep_backoff_and_healthy_sessions_reset_it() {
    assert_eq!(next_reconnect_attempt(4, Duration::from_secs(1)), 5);
    assert_eq!(next_reconnect_attempt(4, Duration::from_secs(30)), 1);
    for _ in 0..100 {
        assert!((Duration::from_millis(800)..=Duration::from_millis(1200))
            .contains(&jittered_retry_delay(1)));
        assert!(jittered_retry_delay(50) <= RECONNECT_DELAY_MAX);
    }
}

struct TestServer;

impl russh::server::Handler for TestServer {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        _user: &str,
        _password: &str,
    ) -> Result<russh::server::Auth, Self::Error> {
        Ok(russh::server::Auth::Accept)
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        host: &str,
        port: u32,
        _originator: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        if let Ok(mut target) = TcpStream::connect((host, port as u16)).await {
            reply.accept().await;
            tokio::spawn(async move {
                let mut channel = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut channel, &mut target).await;
            });
        }
        Ok(())
    }
}

struct TestClient(Option<ForwardedTcpIpRoute>);

impl russh::client::Handler for TestClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        _address: &str,
        port: u32,
        _originator: &str,
        _originator_port: u32,
        reply: russh::client::ChannelOpenHandle,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(route) = &self.0 {
            route.forward(channel, port, reply).await;
        }
        Ok(())
    }
}

async fn ssh_pair(
    route: Option<ForwardedTcpIpRoute>,
) -> (russh::client::Handle<TestClient>, russh::server::Handle) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let config = russh::server::Config {
            keys: vec![russh::keys::decode_secret_key(
                include_str!("../../../tests/test_host_key"),
                None,
            )
            .unwrap()],
            ..Default::default()
        };
        let session = russh::server::run_stream(Arc::new(config), stream, TestServer)
            .await
            .unwrap();
        session.handle()
    });
    let mut client = russh::client::connect(
        Arc::new(russh::client::Config::default()),
        address,
        TestClient(route),
    )
    .await
    .unwrap();
    assert!(client
        .authenticate_password("tester", "pw")
        .await
        .unwrap()
        .success());
    (client, server.await.unwrap())
}

async fn respond_after_eof() -> (u16, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut data = Vec::new();
        stream.read_to_end(&mut data).await.unwrap();
        assert_eq!(data, b"request");
        stream.write_all(b"response").await.unwrap();
        stream.shutdown().await.unwrap();
    });
    (port, task)
}

async fn local_roundtrip(dynamic: bool) {
    let (port, target) = respond_after_eof().await;
    let (handle, _server) = ssh_pair(None).await;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (stream, peer) = listener.accept().await.unwrap();
    let mut spec = forward_spec(port);
    spec.target_host = Some("127.0.0.1".into());
    if dynamic {
        spec.kind = kind::DYNAMIC.into();
    }
    let relay =
        tokio::spawn(async move { serve_local_connection(&handle, spec, stream, peer).await });
    if dynamic {
        client.write_all(&[5, 1, 0]).await.unwrap();
        let mut greeting = [0; 2];
        client.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 0]);
        let mut request = vec![5, 1, 0, 1, 127, 0, 0, 1];
        request.extend_from_slice(&port.to_be_bytes());
        client.write_all(&request).await.unwrap();
        let mut reply = [0; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], 0);
    }
    client.write_all(b"request").await.unwrap();
    client.shutdown().await.unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).await.unwrap();
    assert_eq!(response, b"response");
    relay.await.unwrap().unwrap();
    target.await.unwrap();
}

#[tokio::test]
async fn local_forward_preserves_response_after_tcp_half_close() {
    tokio::time::timeout(Duration::from_secs(10), local_roundtrip(false))
        .await
        .unwrap();
}

#[tokio::test]
async fn socks_forward_preserves_response_after_tcp_half_close() {
    tokio::time::timeout(Duration::from_secs(10), local_roundtrip(true))
        .await
        .unwrap();
}

#[tokio::test]
async fn remote_forward_preserves_response_after_ssh_half_close() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let (sender, mut forwarded) = mpsc::channel(1);
        let route = ForwardedTcpIpRoute {
            port: 8080,
            sender,
            requested: Arc::new(AtomicBool::new(true)),
            capacity: Arc::new(tokio::sync::Semaphore::new(1)),
        };
        let (_client, server) = ssh_pair(Some(route)).await;
        let channel = server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .unwrap();
        let mut remote = channel.into_stream();
        let incoming = forwarded.recv().await.unwrap();
        let (port, target) = respond_after_eof().await;
        let relay =
            tokio::spawn(async move { serve_remote_connection(incoming, "127.0.0.1", port).await });
        remote.write_all(b"request").await.unwrap();
        remote.shutdown().await.unwrap();
        let mut response = Vec::new();
        remote.read_to_end(&mut response).await.unwrap();
        assert_eq!(response, b"response");
        relay.await.unwrap().unwrap();
        target.await.unwrap();
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn remote_channels_reject_unrequested_ports_and_full_queues_before_acceptance() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let (sender, _forwarded) = mpsc::channel(1);
        let requested = Arc::new(AtomicBool::new(false));
        let route = ForwardedTcpIpRoute {
            port: 8080,
            sender,
            requested: requested.clone(),
            capacity: Arc::new(tokio::sync::Semaphore::new(2)),
        };
        let (_client, server) = ssh_pair(Some(route)).await;
        assert!(server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .is_err());
        requested.store(true, Ordering::Release);
        assert!(server
            .channel_open_forwarded_tcpip("127.0.0.1", 8081, "127.0.0.1", 1234)
            .await
            .is_err());
        let accepted = server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .unwrap();
        assert!(server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .is_err());
        drop(accepted.into_stream());
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn remote_target_failure_closes_the_accepted_channel() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let (remote, mut client) = tokio::io::duplex(64);
        assert!(relay_remote_stream(remote, "127.0.0.1", port)
            .await
            .is_err());
        assert_eq!(client.read(&mut [0]).await.unwrap(), 0);
    })
    .await
    .unwrap();
}

#[test]
fn reconnect_does_not_repeat_rejected_credentials_or_host_keys() {
    assert!(!retryable_connection_error(&AppError::Auth(
        "rejected".into()
    )));
    assert!(!retryable_connection_error(&AppError::Ssh(
        russh::Error::UnknownKey
    )));
    assert!(!retryable_connection_error(&AppError::Invalid(
        "invalid settings".into()
    )));
    assert!(retryable_connection_error(&AppError::Ssh(
        russh::Error::KeepaliveTimeout
    )));
    assert!(retryable_connection_error(&AppError::Dns(
        "unavailable".into()
    )));
}

#[test]
fn privileged_port_errors_only_recommend_permissions_when_permission_was_denied() {
    let mut spec = forward_spec(80);
    spec.bind_port = 80;
    let occupied = bind_error(&spec, std::io::ErrorKind::AddrInUse.into()).to_string();
    assert!(occupied.contains("address is in use"));
    assert!(!occupied.contains("grant permission"));
    let denied = bind_error(&spec, std::io::ErrorKind::PermissionDenied.into()).to_string();
    assert!(denied.contains("grant permission"));
}

#[test]
fn manual_stop_suppresses_queued_auto_start_for_only_that_forward() {
    let manager = ForwardManager::new();
    manager.suppress_auto_start("one");
    assert!(!manager.allows_auto_start("one"));
    assert!(manager.allows_auto_start("two"));
    manager.forget("one");
    assert!(manager.allows_auto_start("one"));
}

#[tokio::test]
async fn remote_connection_capacity_is_held_after_the_queue_is_drained() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let (sender, mut forwarded) = mpsc::channel(2);
        let capacity = Arc::new(tokio::sync::Semaphore::new(1));
        let route = ForwardedTcpIpRoute {
            port: 8080,
            sender,
            capacity: capacity.clone(),
            requested: Arc::new(AtomicBool::new(true)),
        };
        let (_client, server) = ssh_pair(Some(route)).await;
        let first = server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .unwrap();
        let incoming = forwarded.recv().await.unwrap();
        assert_eq!(capacity.available_permits(), 0);
        assert!(server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .is_err());
        drop(incoming);
        assert_eq!(capacity.available_permits(), 1);
        let second = server
            .channel_open_forwarded_tcpip("127.0.0.1", 8080, "127.0.0.1", 1234)
            .await
            .unwrap();
        drop(first.into_stream());
        drop(second.into_stream());
    })
    .await
    .unwrap();
}
