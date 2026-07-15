use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

use super::{ChatMessage, ChatResult, Role, ToolCall, ToolSpec, Usage};

const MAX_STREAM_BLOCKS: usize = 256;
const MAX_STREAM_ERROR_CHARS: usize = 4_096;
const MAX_STREAM_ID_BYTES: usize = 128;
const MAX_STREAM_TOOL_NAME_BYTES: usize = 128;

pub(super) fn request_body(
    model: &str,
    system: &str,
    context: Option<&str>,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
    max_tokens: u32,
) -> Value {
    let mut out: Vec<Value> = messages.iter().filter_map(message_to_json).collect();
    merge_tool_results(&mut out);
    mark_cache_breakpoint(&mut out);

    let mut system_blocks = vec![json!({
        "type": "text",
        "text": system,
        "cache_control": { "type": "ephemeral" },
    })];
    if let Some(ctx) = context {
        system_blocks.push(json!({
            "type": "text",
            "text": format!("# Current workspace context\n{ctx}"),
        }));
    }

    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_blocks,
        "messages": out,
    });
    if !tools.is_empty() {
        let defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect();
        body["tools"] = json!(defs);
    }
    body
}

fn message_to_json(m: &ChatMessage) -> Option<Value> {
    Some(match m.role {
        Role::User => json!({
            "role": "user",
            "content": m.content.clone().unwrap_or_default(),
        }),
        Role::Assistant => {
            let mut blocks: Vec<Value> = Vec::new();
            if let Some(text) = &m.content {
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            for call in &m.tool_calls {
                blocks.push(json!({
                    "type": "tool_use",
                    "id": call.id,
                    "name": call.name,
                    "input": call.arguments,
                }));
            }
            json!({ "role": "assistant", "content": blocks })
        }
        Role::Tool => {
            let mut result = json!({
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content.clone().unwrap_or_default(),
            });
            if m.tool_error == Some(true) {
                result["is_error"] = json!(true);
            }
            json!({ "role": "user", "content": [result] })
        }
        Role::System => return None,
    })
}

fn merge_tool_results(messages: &mut Vec<Value>) {
    let mut merged: Vec<Value> = Vec::with_capacity(messages.len());
    for msg in messages.drain(..) {
        if is_tool_result_message(&msg) {
            if let Some(last) = merged.last_mut() {
                if is_tool_result_message(last) {
                    let block = msg["content"][0].clone();
                    last["content"].as_array_mut().unwrap().push(block);
                    continue;
                }
            }
        }
        merged.push(msg);
    }
    *messages = merged;
}

fn mark_cache_breakpoint(messages: &mut [Value]) {
    let Some(last) = messages.last_mut() else {
        return;
    };
    let content = &mut last["content"];
    if let Some(text) = content.as_str() {
        if text.is_empty() {
            return;
        }
        *content = json!([{
            "type": "text",
            "text": text,
            "cache_control": { "type": "ephemeral" },
        }]);
    } else if let Some(blocks) = content.as_array_mut() {
        if let Some(block) = blocks.last_mut() {
            block["cache_control"] = json!({ "type": "ephemeral" });
        }
    }
}

fn is_tool_result_message(v: &Value) -> bool {
    v.get("role").and_then(Value::as_str) == Some("user")
        && v.get("content")
            .and_then(Value::as_array)
            .is_some_and(|blocks| {
                !blocks.is_empty()
                    && blocks
                        .iter()
                        .all(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
            })
}

#[derive(Default)]
pub(super) struct StreamAccumulator {
    blocks: Vec<Block>,
    input_tokens: u32,
    output_tokens: u32,
}

enum Block {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
}

impl StreamAccumulator {
    pub(super) fn feed(&mut self, data: &str, on_text: &mut dyn FnMut(&str)) -> AppResult<()> {
        let Ok(event) = serde_json::from_str::<StreamPayload>(data) else {
            return Ok(());
        };
        match event.kind.as_str() {
            "message_start" => {
                if let Some(usage) = event.message.and_then(|m| m.usage) {
                    self.input_tokens = usage.input_tokens
                        + usage.cache_creation_input_tokens
                        + usage.cache_read_input_tokens;
                    self.output_tokens = usage.output_tokens;
                }
            }
            "message_delta" => {
                if let Some(usage) = event.usage {
                    self.output_tokens = usage.output_tokens;
                }
            }
            "content_block_start" => {
                let index = event.index as usize;
                if index >= MAX_STREAM_BLOCKS {
                    return Err(AppError::Other(
                        "the assistant returned too many streamed content blocks".into(),
                    ));
                }
                while self.blocks.len() <= index {
                    self.blocks.push(Block::Text(String::new()));
                }
                if let Some(block) = event.content_block {
                    self.blocks[index] = match block.kind.as_str() {
                        "tool_use" => Block::ToolUse {
                            id: block.id.unwrap_or_default(),
                            name: block.name.unwrap_or_default(),
                            input_json: String::new(),
                        },
                        _ => Block::Text(block.text),
                    };
                    if let Block::Text(text) = &self.blocks[index] {
                        if !text.is_empty() {
                            on_text(text);
                        }
                    }
                }
            }
            "content_block_delta" => {
                let index = event.index as usize;
                if index >= MAX_STREAM_BLOCKS {
                    return Err(AppError::Other(
                        "the assistant returned too many streamed content blocks".into(),
                    ));
                }
                let Some(block) = self.blocks.get_mut(index) else {
                    return Ok(());
                };
                let Some(delta) = event.delta else {
                    return Ok(());
                };
                match (block, delta.kind.as_str()) {
                    (Block::Text(text), "text_delta") => {
                        text.push_str(&delta.text);
                        if !delta.text.is_empty() {
                            on_text(&delta.text);
                        }
                    }
                    (Block::ToolUse { input_json, .. }, "input_json_delta") => {
                        input_json.push_str(&delta.partial_json);
                    }
                    _ => {}
                }
            }
            "error" => {
                let message = event
                    .error
                    .map(|e| e.message)
                    .unwrap_or_else(|| "the provider reported a stream error".into());
                return Err(AppError::Other(
                    message.chars().take(MAX_STREAM_ERROR_CHARS).collect(),
                ));
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) fn finish(self) -> AppResult<ChatResult> {
        let mut content = String::new();
        let mut tool_calls = Vec::new();
        for block in self.blocks {
            match block {
                Block::Text(text) => {
                    let text = text.trim();
                    if !text.is_empty() {
                        if !content.is_empty() {
                            content.push('\n');
                        }
                        content.push_str(text);
                    }
                }
                Block::ToolUse {
                    id,
                    name,
                    input_json,
                } => {
                    if name.is_empty() {
                        continue;
                    }
                    if id.is_empty() {
                        return Err(AppError::Other(
                            "the assistant returned a tool call without an id".into(),
                        ));
                    }
                    if id.len() > MAX_STREAM_ID_BYTES || id.chars().any(char::is_control) {
                        return Err(AppError::Other(
                            "the assistant returned an invalid tool call id".into(),
                        ));
                    }
                    if name.len() > MAX_STREAM_TOOL_NAME_BYTES || name.chars().any(char::is_control)
                    {
                        return Err(AppError::Other(
                            "the assistant returned an invalid tool name".into(),
                        ));
                    }
                    let arguments = if input_json.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&input_json).map_err(|_| {
                            AppError::Other(format!(
                                "the assistant returned invalid arguments for tool {name}"
                            ))
                        })?
                    };
                    if !arguments.is_object() {
                        return Err(AppError::Other(format!(
                            "the assistant returned non-object arguments for tool {name}"
                        )));
                    }
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments,
                    });
                }
            }
        }

        if content.is_empty() && tool_calls.is_empty() {
            return Err(AppError::Other("the assistant returned no content".into()));
        }
        let usage = if self.input_tokens > 0 || self.output_tokens > 0 {
            Some(Usage {
                input_tokens: self.input_tokens,
                output_tokens: self.output_tokens,
            })
        } else {
            None
        };
        Ok(ChatResult {
            content: if content.is_empty() {
                None
            } else {
                Some(content)
            },
            tool_calls,
            usage,
        })
    }
}

#[derive(Deserialize)]
struct StreamPayload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    index: u32,
    #[serde(default)]
    content_block: Option<RawBlock>,
    #[serde(default)]
    delta: Option<RawDelta>,
    #[serde(default)]
    error: Option<RawError>,
    #[serde(default)]
    message: Option<RawMessage>,
    #[serde(default)]
    usage: Option<RawUsage>,
}

#[derive(Deserialize)]
struct RawMessage {
    #[serde(default)]
    usage: Option<RawUsage>,
}

#[derive(Default, Deserialize)]
struct RawUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
}

#[derive(Deserialize)]
struct RawBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawDelta {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    partial_json: String,
}

#[derive(Deserialize)]
struct RawError {
    message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_streamed_tool_arguments() {
        let mut accumulator = StreamAccumulator::default();
        accumulator
            .feed(
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"run_terminal_command"}}"#,
                &mut |_| {},
            )
            .unwrap();
        accumulator
            .feed(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{broken"}}"#,
                &mut |_| {},
            )
            .unwrap();

        let error = accumulator.finish().expect_err("invalid arguments");
        assert!(error.to_string().contains("invalid arguments"));
    }

    #[test]
    fn captures_usage_across_message_events() {
        let mut accumulator = StreamAccumulator::default();
        accumulator
            .feed(
                r#"{"type":"message_start","message":{"usage":{"input_tokens":1000,"cache_read_input_tokens":200,"cache_creation_input_tokens":50}}}"#,
                &mut |_| {},
            )
            .unwrap();
        accumulator
            .feed(
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hi"}}"#,
                &mut |_| {},
            )
            .unwrap();
        accumulator
            .feed(
                r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":77}}"#,
                &mut |_| {},
            )
            .unwrap();

        let usage = accumulator.finish().unwrap().usage.expect("usage");
        assert_eq!(usage.input_tokens, 1250);
        assert_eq!(usage.output_tokens, 77);
    }

    #[test]
    fn maps_local_tool_errors_to_anthropic_is_error() {
        let body = request_body(
            "claude-sonnet",
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

        let serialized = body["messages"].to_string();
        assert!(!serialized.contains("toolError"));
        assert!(!serialized.contains("tool_error"));
        assert_eq!(body["messages"][0]["content"][0]["is_error"], true);
    }

    #[test]
    fn ignores_untrusted_system_messages_without_panicking() {
        let body = request_body(
            "claude-sonnet",
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

        assert!(body["messages"].as_array().unwrap().is_empty());
        assert!(body["system"].to_string().contains("trusted system"));
        assert!(!body["system"].to_string().contains("untrusted override"));
    }

    #[test]
    fn rejects_unbounded_stream_block_indexes() {
        let mut accumulator = StreamAccumulator::default();
        let error = accumulator
            .feed(
                r#"{"type":"content_block_start","index":4294967295,"content_block":{"type":"text","text":"bad"}}"#,
                &mut |_| {},
            )
            .expect_err("oversized stream index");
        assert!(error.to_string().contains("too many"));
    }
}
