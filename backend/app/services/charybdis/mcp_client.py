"""
Calling third-party MCP servers (`docs/CHARYBDIS_FEATURES.md`, H2).

A plain client for MCP's streamable HTTP transport: each operation opens a
session (initialize, then the initialized notification), sends one request,
and reads the answer whether the server replies with JSON or with a
server-sent event stream. Servers are registered by an administrator in
`agent_mcp_servers`; an agent never names a URL.

Listing a server's tools sends nothing from the case. Calling a tool does,
so it goes through the approval queue (`approvals.py`) and the TLP policy.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.orm import Session

from ...config import settings
from ...models.agent import AgentMcpServer

PROTOCOL_VERSION = "2025-06-18"


class McpError(Exception):
    """The server could not be reached or answered with an error. The message says which."""


@dataclass(frozen=True)
class Server:
    name: str
    url: str
    locality: str
    authorization: str | None


def load(db: Session, name: str) -> Server:
    from ..mfa import MfaError, decrypt_secret

    row = db.query(AgentMcpServer).filter(AgentMcpServer.name == name).first()
    if row is None or not row.enabled:
        raise McpError(f"No enabled MCP server named '{name}'.")
    auth = None
    if row.auth_enc and row.auth_salt:
        try:
            auth = decrypt_secret(row.auth_enc, row.auth_salt)
        except MfaError as exc:
            raise McpError(f"The credential of '{name}' cannot be read: SECRET_KEY changed. "
                           "Enter it again.") from exc
    return Server(name=row.name, url=row.url, locality=row.locality, authorization=auth)


def _reply(response: httpx.Response, message_id: int) -> dict[str, Any]:
    """The JSON-RPC answer to `message_id`, from a JSON body or an event stream."""
    if response.status_code >= 400:
        raise McpError(f"The server answered {response.status_code}: {response.text[:200]}")
    if response.headers.get("content-type", "").startswith("text/event-stream"):
        for line in response.text.splitlines():
            if line.startswith("data:"):
                try:
                    message = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict) and message.get("id") == message_id:
                    return message
        raise McpError("The server's event stream held no answer to the request.")
    try:
        message = response.json()
    except ValueError as exc:
        raise McpError("The server did not answer with JSON.") from exc
    if isinstance(message, list):
        message = next((m for m in message if isinstance(m, dict) and m.get("id") == message_id), {})
    return message if isinstance(message, dict) else {}


def _request(server: Server, method: str, params: dict[str, Any],
             transport: httpx.BaseTransport | None = None) -> Any:
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
               "MCP-Protocol-Version": PROTOCOL_VERSION}
    if server.authorization:
        headers["Authorization"] = server.authorization
    try:
        with httpx.Client(timeout=settings.charybdis_request_timeout_seconds, transport=transport) as client:
            init = client.post(server.url, headers=headers, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                           "clientInfo": {"name": "remora-charybdis", "version": "1"}}})
            first = _reply(init, 1)
            if "error" in first:
                raise McpError(f"The server refused to start a session: {first['error'].get('message')}")
            session = init.headers.get("mcp-session-id")
            if session:
                headers["Mcp-Session-Id"] = session
            client.post(server.url, headers=headers,
                        json={"jsonrpc": "2.0", "method": "notifications/initialized"})
            answer = _reply(client.post(server.url, headers=headers, json={
                "jsonrpc": "2.0", "id": 2, "method": method, "params": params}), 2)
    except httpx.HTTPError as exc:
        raise McpError(f"{server.name} is unreachable ({type(exc).__name__}).") from exc
    if "error" in answer:
        raise McpError(f"{server.name}: {answer['error'].get('message', 'error')}")
    return answer.get("result")


def list_tools(server: Server, transport: httpx.BaseTransport | None = None) -> list[dict[str, Any]]:
    result = _request(server, "tools/list", {}, transport) or {}
    return [{"name": t.get("name"), "description": str(t.get("description") or "")[:300],
             "input_schema": t.get("inputSchema") or {}} for t in result.get("tools") or []]


def call_tool(server: Server, name: str, arguments: dict[str, Any],
              transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    result = _request(server, "tools/call", {"name": name, "arguments": arguments}, transport) or {}
    texts = [c.get("text", "") for c in result.get("content") or [] if c.get("type") == "text"]
    return {"is_error": bool(result.get("isError")), "text": "\n".join(texts)[:8000]}
