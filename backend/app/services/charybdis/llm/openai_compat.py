"""
OpenAI-compatible chat completions: OpenAI itself, and the servers that speak
its protocol - vLLM, LM Studio, llama.cpp's server, Mistral, Groq and others.

Whether one of them is local or cloud is the administrator's declaration on
the provider, not something this module guesses: the same protocol runs on
the analyst's own GPU and at a vendor.
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


def wire_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    """
    Our conversation in the chat completions shape.

    The protocol pairs each tool result with the id of the call it answers.
    Ollama does not always give ids, so calls without one get positional ids
    here, and each tool message takes the next unanswered id in order.
    """
    wire: list[dict[str, Any]] = []
    pending: list[str] = []
    counter = 0
    for m in messages:
        if m.role == "assistant" and m.tool_calls:
            calls = []
            for call in m.tool_calls:
                counter += 1
                call_id = call.id or f"call_{counter}"
                pending.append(call_id)
                calls.append({"id": call_id, "type": "function",
                              "function": {"name": call.name,
                                           "arguments": json.dumps(call.arguments)}})
            wire.append({"role": "assistant", "content": m.content or None, "tool_calls": calls})
        elif m.role == "tool":
            call_id = pending.pop(0) if pending else f"call_{counter}"
            wire.append({"role": "tool", "tool_call_id": call_id, "content": m.content})
        else:
            wire.append({"role": m.role, "content": m.content})
    return wire


def _wire_tool(tool: ToolSpec) -> dict[str, Any]:
    return {"type": "function",
            "function": {"name": tool.name, "description": tool.description,
                         "parameters": tool.parameters}}


def parse_completion(body: dict[str, Any]) -> ChatResult:
    """A chat completions response as a `ChatResult`. Pure, for tests."""
    choice = (body.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    calls = []
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        raw = function.get("arguments") or "{}"
        try:
            arguments = json.loads(raw) if isinstance(raw, str) else dict(raw)
        except json.JSONDecodeError:
            arguments = {"_unparsed": raw}
        if function.get("name"):
            calls.append(ToolCall(name=str(function["name"]),
                                  arguments=arguments if isinstance(arguments, dict) else {},
                                  id=call.get("id")))
    usage = body.get("usage") or {}
    return ChatResult(
        content=str(message.get("content") or ""),
        tool_calls=calls,
        # Reasoning servers (vLLM, DeepSeek) return it beside the answer.
        thinking=str(message.get("reasoning_content") or ""),
        tokens_in=int(usage.get("prompt_tokens") or 0),
        tokens_out=int(usage.get("completion_tokens") or 0),
    )


class OpenAICompatibleProvider:
    kind = "openai"

    def __init__(self, name: str, base_url: str, api_key: str | None, locality: Locality, *,
                 timeout_seconds: float, transport: httpx.AsyncBaseTransport | None = None):
        self.name = name
        self.locality = locality
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout_seconds
        self._transport = transport

    def _client(self, timeout: float) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        return httpx.AsyncClient(base_url=self._base_url, timeout=timeout, headers=headers,
                                 transport=self._transport)

    async def chat(self, model: str, messages: list[ChatMessage],
                   tools: list[ToolSpec]) -> ChatResult:
        body: dict[str, Any] = {"model": model, "messages": wire_messages(messages)}
        if tools:
            body["tools"] = [_wire_tool(t) for t in tools]
        try:
            async with self._client(self._timeout) as client:
                response = await client.post("/chat/completions", json=body)
        except httpx.TimeoutException as exc:
            raise LLMError(f"{self.name} did not answer within {self._timeout:.0f}s",
                           retryable=True) from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"{self.name} is unreachable at {self._base_url}", retryable=True) from exc
        if response.status_code in (401, 403):
            raise LLMError(f"{self.name} refused the API key ({response.status_code})")
        if response.status_code >= 400:
            raise LLMError(f"{self.name} refused the request ({response.status_code}): "
                           f"{response.text[:300]}", retryable=response.status_code in (429, 503))
        return parse_completion(response.json())

    async def health(self) -> ProviderHealth:
        try:
            async with self._client(10.0) as client:
                response = await client.get("/models")
            response.raise_for_status()
        except httpx.HTTPError as exc:
            return ProviderHealth(reachable=False, models=[],
                                  detail=f"{self.name} is unreachable at {self._base_url} ({type(exc).__name__})")
        models = [ModelInfo(name=str(m.get("id", ""))) for m in response.json().get("data") or []]
        return ProviderHealth(reachable=True, models=models)
