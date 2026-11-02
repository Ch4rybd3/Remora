"""
Claude, through the official Anthropic SDK.

Two things differ from the other providers and both live here:

* An assistant turn is a list of content blocks (thinking, text, tool use).
  The blocks are passed back exactly as received on the next request -
  `ChatResult.raw` carries them to `ChatMessage.raw` - because thinking blocks
  must be replayed unchanged.
* Tool results are `tool_result` blocks in a user turn, answering the
  `tool_use` id of the call; consecutive results share one user turn.

Requests go through the server-side refusal fallback (`fallbacks: "default"`):
when the model declines on a safety classifier, the API re-runs the request on
a model that serves it, inside the same call. A refusal that remains is
reported as an error the analyst reads, never as an empty answer.
"""
from __future__ import annotations

from typing import Any

from .base import (
    ChatMessage,
    ChatResult,
    LLMError,
    Locality,
    ModelInfo,
    ProviderHealth,
    ToolCall,
    ToolSpec,
)

DEFAULT_MODEL = "claude-opus-5-5"
#: Non-streaming requests stay under the SDK's HTTP timeouts at this size.
MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def wire_messages(messages: list[ChatMessage]) -> tuple[str, list[dict[str, Any]]]:
    """The system prompt, and our conversation as Messages API turns."""
    system = "\n\n".join(m.content for m in messages if m.role == "system")
    wire: list[dict[str, Any]] = []
    pending: list[str] = []
    counter = 0
    for m in messages:
        if m.role == "system":
            continue
        if m.role == "assistant":
            if isinstance(m.raw, list) and m.raw:
                blocks = m.raw
                pending.extend(b["id"] for b in blocks if b.get("type") == "tool_use")
            else:
                blocks = [{"type": "text", "text": m.content}] if m.content else []
                for call in m.tool_calls:
                    counter += 1
                    call_id = call.id or f"toolu_{counter}"
                    pending.append(call_id)
                    blocks.append({"type": "tool_use", "id": call_id, "name": call.name,
                                   "input": call.arguments})
            if blocks:
                wire.append({"role": "assistant", "content": blocks})
        elif m.role == "tool":
            block = {"type": "tool_result", "tool_use_id": pending.pop(0) if pending else f"toolu_{counter}",
                     "content": m.content}
            # Results of one assistant turn go back together, in one user turn.
            if wire and wire[-1]["role"] == "user" and isinstance(wire[-1]["content"], list) \
                    and all(b.get("type") == "tool_result" for b in wire[-1]["content"]):
                wire[-1]["content"].append(block)
            else:
                wire.append({"role": "user", "content": [block]})
        else:
            wire.append({"role": "user", "content": m.content})
    return system, wire


def parse_message(body: dict[str, Any]) -> ChatResult:
    """A Messages API response (as a dict) as a `ChatResult`. Pure, for tests."""
    if body.get("stop_reason") == "refusal":
        details = body.get("stop_details") or {}
        raise LLMError(f"The model declined the request ({details.get('category') or 'unspecified'}). "
                       "Rephrase the task, or use another model.")
    blocks = body.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    thinking = "".join(b.get("thinking", "") for b in blocks if b.get("type") == "thinking")
    calls = [ToolCall(name=str(b.get("name")), arguments=dict(b.get("input") or {}), id=b.get("id"))
             for b in blocks if b.get("type") == "tool_use"]
    usage = body.get("usage") or {}
    tokens_in = sum(int(usage.get(k) or 0) for k in
                    ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    return ChatResult(content=text, tool_calls=calls, thinking=thinking.strip(),
                      tokens_in=tokens_in, tokens_out=int(usage.get("output_tokens") or 0),
                      raw=blocks)


class AnthropicProvider:
    kind = "anthropic"

    def __init__(self, name: str, api_key: str | None, locality: Locality, *,
                 base_url: str = "", timeout_seconds: float, effort: str | None = "medium"):
        from anthropic import AsyncAnthropic

        self.name = name
        self.locality = locality
        self._effort = effort
        self._client = AsyncAnthropic(api_key=api_key, base_url=base_url or None,
                                      timeout=timeout_seconds, max_retries=2)

    async def chat(self, model: str, messages: list[ChatMessage],
                   tools: list[ToolSpec]) -> ChatResult:
        import anthropic

        system, wire = wire_messages(messages)
        kwargs: dict[str, Any] = {
            "model": model or DEFAULT_MODEL, "max_tokens": MAX_TOKENS, "messages": wire,
            "betas": [FALLBACK_BETA], "fallbacks": "default",
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = [{"name": t.name, "description": t.description,
                                "input_schema": t.parameters} for t in tools]
        if self._effort:
            kwargs["output_config"] = {"effort": self._effort}
        try:
            response = await self._client.beta.messages.create(**kwargs)
        except anthropic.AuthenticationError as exc:
            raise LLMError(f"{self.name} refused the API key") from exc
        except anthropic.NotFoundError as exc:
            raise LLMError(f"Model '{model}' is not available at {self.name}") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError(f"{self.name} is rate limiting requests; try again shortly",
                           retryable=True) from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"{self.name} refused the request ({exc.status_code}): {exc.message[:300]}",
                           retryable=exc.status_code >= 500) from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError(f"{self.name} is unreachable", retryable=True) from exc
        return parse_message(response.model_dump(mode="json", exclude_none=True))

    async def health(self) -> ProviderHealth:
        import anthropic

        try:
            page = await self._client.models.list(limit=50)
        except anthropic.AuthenticationError:
            return ProviderHealth(reachable=False, models=[], detail=f"{self.name} refused the API key")
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            return ProviderHealth(reachable=False, models=[],
                                  detail=f"{self.name} is unreachable ({type(exc).__name__})")
        return ProviderHealth(reachable=True, models=[ModelInfo(name=m.id) for m in page.data])
