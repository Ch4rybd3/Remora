"""
The one door between an agent and a model.

Policy lives here rather than in the agent, so no agent - and no future
prompt that talks an agent into something - can route case data to a provider
the case does not allow (`docs/CHARYBDIS.md` principle P5).
"""
from __future__ import annotations

import asyncio

from ....config import settings
from .base import ChatMessage, ChatResult, LLMError, LLMProvider, Locality, ToolSpec
from .ollama import OllamaProvider

#: The provider that needs no configuration. Others come from `agent_providers`.
OLLAMA = "ollama"

#: TLP labels whose data may not leave the host. Compared case-insensitively
#: and without the `TLP:` prefix, which Remora stores but analysts do not
#: always type.
LOCAL_ONLY_TLP = frozenset({"red", "amber+strict"})


def _normalise_tlp(tlp: str | None) -> str:
    value = (tlp or "").strip().lower()
    return value.removeprefix("tlp:")


def provider_allowed(tlp: str | None, locality: Locality) -> bool:
    """
    Whether a case with this TLP may be sent to a provider of this locality.

    An unknown or empty TLP is treated as the strictest: a label that cannot
    be read must not be the reason data left the building.
    """
    if locality == Locality.LOCAL:
        return True
    label = _normalise_tlp(tlp)
    if not label:
        return False
    return label not in LOCAL_ONLY_TLP


class PolicyDenied(LLMError):
    """The case's TLP forbids this provider. Never retryable."""


_providers: dict[str, LLMProvider] = {}
_semaphore: asyncio.Semaphore | None = None


def _configured(name: str) -> LLMProvider:
    """Build a provider an administrator configured, from its row."""
    from ....database import SessionLocal
    from ....models.agent import PROVIDER_KIND_ANTHROPIC, AgentProvider
    from ...mfa import MfaError, decrypt_secret
    from .anthropic_provider import AnthropicProvider
    from .openai_compat import OpenAICompatibleProvider

    db = SessionLocal()
    try:
        row = db.query(AgentProvider).filter(AgentProvider.name == name).first()
        if row is None or not row.enabled:
            raise LLMError(f"Model provider '{name}' is not configured or is disabled")
        try:
            key = (decrypt_secret(row.api_key_enc, row.api_key_salt)
                   if row.api_key_enc and row.api_key_salt else None)
        except MfaError as exc:
            raise LLMError(f"The API key of '{name}' cannot be read: SECRET_KEY changed since it "
                           "was entered. Enter it again in the provider settings.") from exc
        locality = Locality.LOCAL if row.locality == "local" else Locality.CLOUD
        timeout = settings.charybdis_request_timeout_seconds
        if row.kind == PROVIDER_KIND_ANTHROPIC:
            return AnthropicProvider(name, key, locality, base_url=row.base_url, timeout_seconds=timeout)
        return OpenAICompatibleProvider(name, row.base_url, key, locality, timeout_seconds=timeout)
    finally:
        db.close()


def get_provider(kind: str) -> LLMProvider:
    """A provider by name: `ollama`, or one configured in `agent_providers`."""
    if kind not in _providers:
        if kind == OLLAMA:
            _providers[kind] = OllamaProvider(
                settings.ollama_base_url,
                timeout_seconds=settings.charybdis_request_timeout_seconds,
                num_ctx=settings.charybdis_num_ctx,
            )
        else:
            _providers[kind] = _configured(kind)
    return _providers[kind]


def set_provider(kind: str, provider: LLMProvider) -> None:
    """Replace a provider. For tests, which must never reach a real model."""
    _providers[kind] = provider


def forget_provider(name: str) -> None:
    """Drop a cached provider after its settings changed; rebuilt on next use."""
    _providers.pop(name, None)


def known_providers() -> list[str]:
    from ....database import SessionLocal
    from ....models.agent import AgentProvider

    db = SessionLocal()
    try:
        return [OLLAMA] + [name for (name,) in db.query(AgentProvider.name)
                           .filter(AgentProvider.enabled.is_(True)).order_by(AgentProvider.name)]
    finally:
        db.close()


def _gate() -> asyncio.Semaphore:
    # Created lazily, inside the running loop it will be awaited on.
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.charybdis_concurrency))
    return _semaphore


async def chat(
    *, kind: str, model: str, case_tlp: str | None,
    messages: list[ChatMessage], tools: list[ToolSpec],
) -> ChatResult:
    provider = get_provider(kind)
    if not provider_allowed(case_tlp, provider.locality):
        raise PolicyDenied(
            f"The case is {case_tlp or 'unlabelled'}; its data may only reach a local model, "
            f"and '{kind}' is a cloud provider")
    async with _gate():
        return await provider.chat(model, messages, tools)
