"""
What every model provider looks like to the agent loop.

Deliberately small: one call that takes a conversation and the tools on offer
and returns either text or tool calls. Streaming tokens is a later concern;
the trace already streams at the granularity an analyst reads, one turn and
one tool call at a time.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Protocol


class Locality(str, enum.Enum):
    """Where the data goes. The TLP policy is decided on this, nothing else."""
    LOCAL = "local"
    CLOUD = "cloud"


class LLMError(Exception):
    """The provider failed. `retryable` says whether trying again could help."""

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class ToolSpec:
    name:        str
    description: str
    #: JSON Schema of the arguments.
    parameters:  dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    name:      str
    arguments: dict[str, Any]
    #: Provider-assigned id, when there is one. Ollama does not always send it.
    id:        str | None = None


@dataclass
class ChatMessage:
    role:       str                       # system | user | assistant | tool
    content:    str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    #: For role "tool": which tool produced this content.
    tool_name:  str | None = None
    #: An assistant turn as the provider sent it (`ChatResult.raw`), replayed
    #: as is by the provider that produced it. Claude's thinking blocks must
    #: come back unchanged; other providers ignore it.
    raw:        Any = None


@dataclass(frozen=True)
class ChatResult:
    content:    str
    tool_calls: list[ToolCall]
    #: Reasoning a model exposes separately from its answer, if it does.
    thinking:   str = ""
    tokens_in:  int = 0
    tokens_out: int = 0
    #: The provider's own form of the turn, for `ChatMessage.raw`.
    raw:        Any = None


@dataclass(frozen=True)
class ModelInfo:
    name:       str
    size_bytes: int = 0


@dataclass(frozen=True)
class ProviderHealth:
    reachable: bool
    models:    list[ModelInfo]
    detail:    str = ""


class LLMProvider(Protocol):
    kind:     str
    locality: Locality

    async def chat(
        self, model: str, messages: list[ChatMessage], tools: list[ToolSpec],
    ) -> ChatResult: ...

    async def health(self) -> ProviderHealth: ...
