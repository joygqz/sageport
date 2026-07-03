//! OpenAI-compatible chat-completions wire format, including function
//! (tool) calling.

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

use super::{ChatMessage, ChatResult, Role, ToolCall, ToolSpec};

/// Build a `POST /chat/completions` request body.
pub(super) fn request_body(model: &str, messages: &[ChatMessage], tools: &[ToolSpec]) -> Value {
    let messages: Vec<Value> = messages.iter().map(message_to_json).collect();

    let mut body = json!({
        "model": model,
        "max_tokens": super::MAX_TOKENS,
        "messages": messages,
    });
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

/// Accumulates a streamed chat-completions turn: text deltas are forwarded
/// as they arrive, tool calls are assembled fragment by fragment (keyed by
/// their stream `index`) until the arguments JSON is complete.
#[derive(Default)]
pub(super) struct StreamAccumulator {
    content: String,
    tool_calls: Vec<PartialToolCall>,
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    /// Consume one SSE `data:` payload. Payloads that don't parse are
    /// skipped — OpenAI-compatible gateways are known to interleave
    /// keep-alive or vendor-specific lines a strict parser would trip on.
    pub(super) fn feed(&mut self, data: &str, on_text: &mut dyn FnMut(&str)) {
        let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) else {
            return;
        };
        for choice in chunk.choices {
            let delta = choice.delta;
            if let Some(text) = delta.content.filter(|t| !t.is_empty()) {
                self.content.push_str(&text);
                on_text(&text);
            }
            for tc in delta.tool_calls {
                let index = tc.index as usize;
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
    }

    pub(super) fn finish(self) -> AppResult<ChatResult> {
        let content = Some(self.content.trim().to_string()).filter(|c| !c.is_empty());
        let tool_calls: Vec<ToolCall> = self
            .tool_calls
            .into_iter()
            .filter(|c| !c.name.is_empty())
            .map(|c| ToolCall {
                arguments: serde_json::from_str(&c.arguments).unwrap_or_else(|_| json!({})),
                id: c.id,
                name: c.name,
            })
            .collect();

        if content.is_none() && tool_calls.is_empty() {
            return Err(AppError::Other("the assistant returned no content".into()));
        }
        Ok(ChatResult {
            content,
            tool_calls,
        })
    }
}

#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
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
