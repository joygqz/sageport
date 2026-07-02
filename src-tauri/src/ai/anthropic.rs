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

/// Extract the assistant's next turn (text and/or tool calls) from a
/// Messages response.
pub(super) fn parse_chat(bytes: &[u8]) -> AppResult<ChatResult> {
    let parsed: MessageResponse = serde_json::from_slice(bytes)?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    for block in parsed.content {
        match block.kind.as_str() {
            "text" => {
                let text = block.text.trim();
                if !text.is_empty() {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(text);
                }
            }
            "tool_use" => tool_calls.push(ToolCall {
                id: block.id.unwrap_or_default(),
                name: block.name.unwrap_or_default(),
                arguments: block.input.unwrap_or_else(|| json!({})),
            }),
            _ => {}
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

#[derive(Deserialize)]
struct MessageResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<Value>,
}
