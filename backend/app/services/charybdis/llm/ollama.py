"""
Ollama, through its native `/api/chat`.

Native rather than the OpenAI-compatible endpoint because the native one
reports token counts and the separate `thinking` field, and accepts `options`
such as the context window - without which Ollama silently truncates to 2048
tokens, which is shorter than a system prompt plus two tool results.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

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


def _wire_message(message: ChatMessage) -> dict[str, Any]:
    wire: dict[str, Any] = {"role": message.role, "content": message.content}
    if message.tool_calls:
        wire["tool_calls"] = [
            {"function": {"name": call.name, "arguments": call.arguments}}
            for call in message.tool_calls
        ]
    if message.tool_name:
        wire["tool_name"] = message.tool_name
    return wire


def _wire_tool(tool: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name":        tool.name,
            "description": tool.description,
            "parameters":  tool.parameters,
        },
    }


def _parse_arguments(raw: Any) -> dict[str, Any]:
    """Arguments arrive as an object, or - from some models - as a JSON string."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {"_unparsed": raw}
        return parsed if isinstance(parsed, dict) else {"_unparsed": raw}
    return {}


def parse_chat_response(body: dict[str, Any]) -> ChatResult:
    """Turn an `/api/chat` response body into a `ChatResult`. Pure, for tests."""
    message = body.get("message") or {}
    calls = [
        ToolCall(
            name=str((call.get("function") or {}).get("name", "")),
            arguments=_parse_arguments((call.get("function") or {}).get("arguments")),
            id=call.get("id"),
        )
        for call in message.get("tool_calls") or []
        if (call.get("function") or {}).get("name")
    ]
    return ChatResult(
        content=str(message.get("content") or ""),
        tool_calls=calls,
        thinking=str(message.get("thinking") or ""),
        tokens_in=int(body.get("prompt_eval_count") or 0),
        tokens_out=int(body.get("eval_count") or 0),
    )


class OllamaProvider:
    kind     = "ollama"
    locality = Locality.LOCAL

    def __init__(self, base_url: str, *, timeout_seconds: float, num_ctx: int,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._base_url = base_url.rstrip("/")
        self._timeout  = timeout_seconds
        self._num_ctx  = num_ctx
        # Injected in tests so no request ever leaves the process.
        self._transport = transport

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base_url, timeout=timeout,
                                 transport=self._transport)

    async def chat(
        self, model: str, messages: list[ChatMessage], tools: list[ToolSpec],
    ) -> ChatResult:
        body: dict[str, Any] = {
            "model":    model,
            "messages": [_wire_message(m) for m in messages],
            "stream":   False,
            "options":  {"num_ctx": self._num_ctx, "temperature": 0.2},
        }
        if tools:
            body["tools"] = [_wire_tool(t) for t in tools]

        try:
            async with self._client(self._timeout) as client:
                response = await client.post("/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise LLMError(f"Ollama did not answer within {self._timeout:.0f}s",
                           retryable=True) from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Ollama is unreachable at {self._base_url}",
                           retryable=True) from exc

        if response.status_code == 404:
            raise LLMError(f"Model '{model}' is not available in Ollama. "
                           f"Pull it on the host: ollama pull {model}")
        if response.status_code >= 400:
            detail = _error_detail(response)
            # Ollama answers 400 "does not support tools" for models without
            # native tool calling, which is the most likely first-run mistake.
            raise LLMError(f"Ollama refused the request ({response.status_code}): {detail}")
        return parse_chat_response(response.json())

    async def health(self) -> ProviderHealth:
        try:
            async with self._client(10.0) as client:
                response = await client.get("/api/tags")
            response.raise_for_status()
        except httpx.HTTPError:
            return ProviderHealth(reachable=False, models=[],
                                  detail=f"Ollama is unreachable at {self._base_url}")
        models = [
            ModelInfo(name=str(m.get("name", "")), size_bytes=int(m.get("size") or 0))
            for m in response.json().get("models") or []
        ]
        return ProviderHealth(reachable=True, models=models)


def _error_detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("error", ""))[:300]
    except ValueError:
        return response.text[:300]
