# Remora — Sample Content

This directory contains sample data that ships with the platform.
It is tracked in git and seeded into the database on first startup.

## Structure

```
samples/
├── playbooks/          # Sample playbook definitions (JSON)
│   ├── ransomware.json
│   ├── phishing.json
│   └── insider_threat.json
└── cases/              # Sample case definitions (YAML) — coming soon
```

## Seeding

The backend automatically imports samples on first startup if the database is empty.
See `backend/app/services/seed_service.py` for the seeding logic.

## Adding samples

1. Drop a `.json` (playbook) or `.yaml` (case) file into the appropriate subfolder.
2. The file will be picked up automatically on the next fresh install.
3. Commit the file — it is intentionally tracked in git.
