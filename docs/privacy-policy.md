# Privacy Policy

Effective date: 2026-07-08

Sageport is a local-first desktop SSH workbench. This policy explains what data the application handles while running, where that data lives, and where it goes if you turn on optional features that transmit data off your device.

## 1. Overview

- Sageport does not require an account, and the developer does not operate any backend server.
- Everything the application produces — hosts, credentials, keys, snippets, AI conversation history, interface settings — is stored in a SQLite database on your own device.
- The developer does not collect, receive, or store any usage data. The application contains no analytics, telemetry, or crash-reporting components.
- Data leaves your device only when you deliberately enable an optional feature such as Sync or the AI assistant, as described below.

## 2. Data stored locally

The following is kept only in the local database and is never sent to the developer:

- Host addresses, groups, and notes
- Credentials and keys (including private keys and passwords), stored encrypted in the database
- Terminal scrollback content and session state
- SFTP transfer history and path bookmarks
- Command snippets and port-forwarding rules
- Command history used for terminal autocomplete
- AI assistant conversation history
- Interface preferences (locale, theme, zoom level, etc.)

Uninstalling the application or deleting the local database file removes all of the above.

## 3. Servers you connect to directly

Sageport's core function is connecting, via SSH/SFTP, to servers you configure yourself. These connections are established directly between your device and the target server — they never pass through any server operated by the developer, and the developer cannot see or receive any session content.

## 4. Sync & backup (optional, off by default)

Sync is disabled by default and must be turned on explicitly in Settings. Once enabled:

- You choose one sync provider: GitHub Gist, Google Drive, or Microsoft OneDrive (via OAuth authorization), or WebDAV / S3 (using credentials you supply).
- Before anything is uploaded, it is encrypted on your device: a key is derived from your passphrase using Argon2id, and the payload is sealed with AES-256-GCM. Only the resulting ciphertext is sent to the chosen provider — your passphrase itself is never transmitted or stored anywhere.
- Only you hold the passphrase; the developer cannot access it and cannot recover it for you. **If you lose the passphrase, previously synced data cannot be decrypted or recovered.**
- Synced data includes hosts, credentials, keys, snippets, port-forwarding rules, SFTP bookmarks, and interface preferences (locale, theme, zoom). It does not include AI conversation history, command history, transfer history, or device-local sync/update settings.
- When you connect via OAuth to GitHub, Google, or Microsoft, the authorization flow is handled by that platform, and how it processes your account information is governed by that platform's own privacy policy.
- You can disconnect sync or switch providers at any time. Disconnecting does not automatically delete encrypted data already stored with the provider — remove it directly through that provider's own service if needed.

## 5. AI assistant (optional)

The AI assistant requires you to supply your own API key for a third-party service (Anthropic, or any OpenAI-compatible endpoint):

- Your API key, conversation content, and the terminal context necessary to answer your questions are sent directly from your device to the AI provider you configured — not through the developer.
- How that data is stored, used, or potentially used for model training is governed entirely by your chosen AI provider's own privacy policy, not by this one.
- Any remote command proposed by the AI assistant requires your explicit confirmation before it runs on a target server; Sageport never executes AI-generated commands automatically.
- Conversation history is stored only in the local database; deleting a conversation removes it.

## 6. Automatic updates

The application periodically checks GitHub Releases for new version information. This is a standard HTTP request that does not carry any of your application data; network metadata generated during this request (such as IP address) is subject to GitHub's own privacy policy.

## 7. Children's privacy

Sageport is a tool aimed at technical users with server-administration needs. It is not directed at children, and the developer does not knowingly collect personal information from children.

## 8. Changes to this policy

Updates to this policy will appear as changes to this file in the source repository, and the full history of changes is visible through Git commit history. Continued use of Sageport after an update constitutes acceptance of the revised policy.

## 9. Contact

If you have questions about this policy, reach the developer via [GitHub Issues](https://github.com/joygqz/sageport/issues).
