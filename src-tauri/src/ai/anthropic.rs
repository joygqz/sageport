//! Anthropic-compatible Messages wire format, including tool use.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

use super::{ChatMessage, ChatResult, Role, ToolCall, ToolSpec};

/// Build a `POST /v1/messages` request body.
pub(super) fn request_body(model: &str, messages: &[ChatMessage], tools: &[ToolSpec]) -> Value {
    let system = messages
        .iter()
        .find(|m| m.role == Role::System)
        .and_then(|m| m.content.clone())
        .unwrap_or_default();

    let mut out: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != Role::System)
        .map(message_to_json)
        .collect();
    merge_tool_results(&mut out);

    let mut body = json!({
        "model": model,
        "max_tokens": super::MAX_TOKENS,
        "system": system,
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

fn message_to_json(m: &ChatMessage) -> Value {
    match m.role {
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
        Role::Tool => json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content.clone().unwrap_or_default(),
            }],
        }),
        Role::System => unreachable!("filtered out before mapping"),
    }
}

/// Anthropic expects every `tool_result` that answers one assistant turn's
/// `tool_use` blocks to live in a single following `user` message. Our
/// canonical messages carry one `tool` entry per call, so merge consecutive
/// tool-result-only user messages back into one before sending.
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

/// Accumulates a streamed Messages turn. Anthropic streams content as
/// indexed blocks: `content_block_start` opens a text or tool_use block,
/// `content_block_delta` grows it (`text_delta` / `input_json_delta`), and
/// the final result is assembled once the stream ends.
#[derive(Default)]
pub(super) struct StreamAccumulator {
    blocks: Vec<Block>,
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
    /// Consume one SSE `data:` payload, forwarding text deltas. A payload of
    /// type `error` aborts the turn with the provider's message.
    pub(super) fn feed(&mut self, data: &str, on_text: &mut dyn FnMut(&str)) -> AppResult<()> {
        let Ok(event) = serde_json::from_str::<StreamPayload>(data) else {
            return Ok(());
        };
        match event.kind.as_str() {
            "content_block_start" => {
                let index = event.index as usize;
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
                return Err(AppError::Other(message));
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
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments: serde_json::from_str(&input_json).unwrap_or_else(|_| json!({})),
                    });
                }
            }
        }

        if content.is_empty() && tool_calls.is_empty() {
            return Err(AppError::Other("the assistant returned no content".into()));
        }
        Ok(ChatResult {
            content: if content.is_empty() {
                None
            } else {
                Some(content)
            },
            tool_calls,
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
    #[serde(rename = "type")]
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
