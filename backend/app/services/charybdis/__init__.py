"""
Charybdis — a team of agents that works a case alongside the analyst.

The rest of Remora never imports from this package; it calls into Remora
services, never the reverse. Design of record: `docs/CHARYBDIS.md`.

    llm/       provider protocol, the Ollama adapter, the gateway and its policy
    tools.py   typed, read-only adapters over Remora services
    events.py  the hash-chained trace and the live event bus
    runtime.py the supervisor and the agent loop
    prompts.py role definitions and system prompts
"""
