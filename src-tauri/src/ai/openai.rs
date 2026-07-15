use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

use super::{ChatMessage, ChatResult, Role, ToolCall, ToolSpec, Usage};

const MAX_STREAM_TOOL_CALLS: usize = 256;
const MAX_STREAM_ERROR_CHARS: usize = 4_096;
const MAX_STREAM_ID_BYTES: usize = 128;
const MAX_STREAM_TOOL_NAME_BYTES: usize = 128;

fn max_tokens_key(model: &str) -> &'static str {
    let name = model.rsplit('/').next().unwrap_or(model);
    if name.starts_with("o1")
        || name.starts_with("o3")
        || name.starts_with("o4")
        || name.starts_with("gpt-5")
    {
        "max_completion_tokens"
    } else {
        "max_tokens"
    }
}

pub(super) fn request_body(
    model: &str,
    system: &str,
    context: Option<&str>,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
    max_tokens: u32,
) -> Value {
    let mut out = Vec::with_capacity(messages.len() + 2);
    out.push(json!({ "role": "system", "content": system }));
    if let Some(ctx) = context {
        out.push(json!({
            "role": "system",
            "content": format!("# Current workspace context\n{ctx}"),
        }));
    }
    out.extend(
        messages
            .iter()
            .filter(|message| message.role != Role::System)
            .map(message_to_json),
    );

    let mut body = json!({
        "model": model,
        "messages": out,
        "stream_options": { "include_usage": true },
    });
    body[max_tokens_key(model)] = json!(max_tokens);
    if !tools.is_empty() {
        let defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                })
            })
            .collect();
        body["tools"] = json!(defs);
        body["tool_choice"] = json!("auto");
    }
    body
}

fn message_to_json(m: &ChatMessage) -> Value {
    let role = match m.role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    };
    let mut obj = Map::new();
    obj.insert("role".into(), json!(role));
    obj.insert(
        "content".into(),
        json!(m.content.clone().unwrap_or_default()),
    );
    if !m.tool_calls.is_empty() {
        let calls: Vec<Value> = m
            .tool_calls
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "type": "function",
                    "function": {
                        "name": c.name,
                        "arguments": c.arguments.to_string(),
                    },
                })
            })
            .collect();
        obj.insert("tool_calls".into(), json!(calls));
    }
    if let Some(id) = &m.tool_call_id {
        obj.insert("tool_call_id".into(), json!(id));
    }
    Value::Object(obj)
}

#[derive(Default)]
pub(super) struct StreamAccumulator {
    content: String,
    tool_calls: Vec<PartialToolCall>,
    usage: Option<Usage>,
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    pub(super) fn feed(&mut self, data: &str, on_text: &mut dyn FnMut(&str)) -> AppResult<()> {
        let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) else {
            return Ok(());
        };
        if let Some(error) = chunk.error {
            return Err(AppError::Other(
                error.message.chars().take(MAX_STREAM_ERROR_CHARS).collect(),
            ));
        }
        if let Some(usage) = chunk.usage {
            self.usage = Some(Usage {
                input_tokens: usage.prompt_tokens,
                output_tokens: usage.completion_tokens,
            });
        }
        for choice in chunk.choices {
            let delta = choice.delta;
            if let Some(text) = delta.content.filter(|t| !t.is_empty()) {
                self.content.push_str(&text);
                on_text(&text);
            }
            for tc in delta.tool_calls {
                let index = tc.index as usize;
                if index >= MAX_STREAM_TOOL_CALLS {
                    return Err(AppError::Other(
                        "the assistant returned too many streamed tool calls".into(),
                    ));
                }
                while self.tool_calls.len() <= index {
                    self.tool_calls.push(PartialToolCall::default());
                }
                let slot = &mut self.tool_calls[index];
                if let Some(id) = tc.id.filter(|i| !i.is_empty()) {
                    slot.id = id;
                }
                if let Some(f) = tc.function {
                    if let Some(name) = f.name {
                        slot.name.push_str(&name);
                    }
                    if let Some(args) = f.arguments {
                        slot.arguments.push_str(&args);
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn finish(self) -> AppResult<ChatResult> {
        let content = Some(self.content.trim().to_string()).filter(|c| !c.is_empty());
        let tool_calls: Vec<ToolCall> = self
            .tool_calls
            .into_iter()
            .filter(|c| !c.name.is_empty())
            .map(|c| {
                if c.id.is_empty() {
                    return Err(AppError::Other(
                        "the assistant returned a tool call without an id".into(),
                    ));
                }
                if c.id.len() > MAX_STREAM_ID_BYTES || c.id.chars().any(char::is_control) {
                    return Err(AppError::Other(
                        "the assistant returned an invalid tool call id".into(),
                    ));
                }
                if c.name.len() > MAX_STREAM_TOOL_NAME_BYTES || c.name.chars().any(char::is_control)
                {
                    return Err(AppError::Other(
                        "the assistant returned an invalid tool name".into(),
                    ));
                }
                let arguments = if c.arguments.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&c.arguments).map_err(|_| {
                        AppError::Other(format!(
                            "the assistant returned invalid arguments for tool {}",
                            c.name
                        ))
                    })?
                };
                if !arguments.is_object() {
                    return Err(AppError::Other(format!(
                        "the assistant returned non-object arguments for tool {}",
                        c.name
                    )));
                }
                Ok(ToolCall {
                    arguments,
                    id: c.id,
                    name: c.name,
                })
            })
            .collect::<AppResult<_>>()?;

        if content.is_none() && tool_calls.is_empty() {
            return Err(AppError::Other("the assistant returned no content".into()));
        }
        Ok(ChatResult {
            content,
            tool_calls,
            usage: self.usage,
        })
    }
}

#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<StreamUsage>,
    #[serde(default)]
    error: Option<StreamError>,
}

#[derive(Deserialize)]
struct StreamError {
    message: String,
}

#[derive(Deserialize)]
struct StreamUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
}

#[derive(Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<StreamToolCall>,
}

#[derive(Deserialize)]
struct StreamToolCall {
    #[serde(default)]
    index: u32,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<StreamFunction>,
}

#[derive(Deserialize)]
struct StreamFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_streamed_tool_arguments() {
        let mut accumulator = StreamAccumulator::default();
        accumulator
            .feed(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"run_terminal_command","arguments":"{broken"}}]}}]}"#,
            &mut |_| {},
        )
            .unwrap();

        let error = accumulator.finish().expect_err("invalid arguments");
        assert!(error.to_string().contains("invalid arguments"));
    }

    #[test]
    fn captures_usage_from_final_chunk() {
        let mut accumulator = StreamAccumulator::default();
        accumulator
            .feed(r#"{"choices":[{"delta":{"content":"hi"}}]}"#, &mut |_| {})
            .unwrap();
        accumulator
            .feed(
                r#"{"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":56}}"#,
                &mut |_| {},
            )
            .unwrap();

        let usage = accumulator.finish().unwrap().usage.expect("usage");
        assert_eq!(usage.input_tokens, 1234);
        assert_eq!(usage.output_tokens, 56);
    }

    #[test]
    fn local_tool_error_metadata_is_not_sent_to_provider() {
        let body = request_body(
            "gpt-4o",
            "system",
            None,
            &[ChatMessage {
                role: Role::Tool,
                content: Some("Error: failed".into()),
                tool_calls: vec![],
                tool_call_id: Some("call-1".into()),
                tool_error: Some(true),
            }],
            &[],
            4096,
        );

        let message = body["messages"].as_array().unwrap().last().unwrap();
        assert!(message.get("toolError").is_none());
        assert!(message.get("tool_error").is_none());
    }

    #[test]
    fn ignores_untrusted_system_messages() {
        let body = request_body(
            "gpt-4o",
            "trusted system",
            None,
            &[ChatMessage {
                role: Role::System,
                content: Some("untrusted override".into()),
                tool_calls: vec![],
                tool_call_id: None,
                tool_error: None,
            }],
            &[],
            4096,
        );

        let serialized = body["messages"].to_string();
        assert!(serialized.contains("trusted system"));
        assert!(!serialized.contains("untrusted override"));
    }

    #[test]
    fn rejects_unbounded_stream_tool_indexes() {
        let mut accumulator = StreamAccumulator::default();
        let error = accumulator
            .feed(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":4294967295,"id":"call-1","function":{"name":"tool","arguments":"{}"}}]}}]}"#,
                &mut |_| {},
            )
            .expect_err("oversized stream index");
        assert!(error.to_string().contains("too many"));
    }

    #[test]
    fn surfaces_stream_error_events() {
        let mut accumulator = StreamAccumulator::default();
        let error = accumulator
            .feed(
                r#"{"error":{"message":"provider overloaded"}}"#,
                &mut |_| {},
            )
            .expect_err("stream error");
        assert_eq!(error.to_string(), "provider overloaded");
    }
}
