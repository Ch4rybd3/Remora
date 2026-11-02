"""
Charybdis — a team of agents that works a case alongside the analyst.

The rest of Remora never imports from this package; it calls into Remora
services, never the reverse. Design of record: `docs/CHARYBDIS.md`.

    llm/           provider protocol, the Ollama adapter, the gateway and its policy
    tools.py       typed adapters over Remora services, and the proposal tools
    events.py      the hash-chained trace and the live event bus
    runtime.py     the supervisor and the process-driven agent loop
    definitions.py roles and processes loaded from templates/agents/
    delegation.py  tasks between agents, through the Incident Leader
"""
