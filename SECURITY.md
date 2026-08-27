# Security Policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/Ch4rybd3/Remora/security/advisories/new).
Do not open a public issue.

Include what you need to reproduce it, the affected version
(`GET /api/v1/version`), and the impact you believe it has. Expect an
acknowledgement within a few days.

## Supported versions

Remora is pre-1.0. Only the latest release receives fixes.

## Threat model

Remora holds forensic evidence, and that evidence is attacker-controlled by
definition. The assumptions below are what the design actually relies on —
stated plainly so the gaps are visible rather than implied.

### What Remora assumes

- **The deployment is trusted infrastructure.** Remora is not designed to be
  exposed to the internet. Put it behind a VPN or an authenticating reverse
  proxy.
- **Analysts are authenticated but not trusted equally.** Roles gate access;
  the audit log records who did what.
- **Ingested artifacts are hostile.** Every parser is treated as processing
  attacker-controlled input.

### What is enforced today

- JWT authentication on every `/api/v1` route except `health`, `version` and `login`.
  A contract test asserts this over the whole route table, so a route cannot
  ship without it.
- Login rate limiting: five failed attempts lock the account for 30 seconds.
- Password strength validation on creation.
- Analyst query input (RQL) reaches DuckDB as bound parameters, never as
  interpolated SQL. Asserted by tests.
- Vault contents are encrypted at rest with a key derived via PBKDF2.
- Audit logging of case and user operations.

### Known limitations

These are real and listed deliberately rather than left for a reader to find.

- **No MFA.** Scheduled for S17 (see [docs/ROADMAP.md](docs/ROADMAP.md)).
- **Roles are a linear hierarchy** (`analyst < admin < owner`). There is no
  read-only role and no per-client isolation yet; any authenticated analyst can
  reach any case. S17.
- **Static file mounts are unauthenticated.** `/note-images` and
  `/knowledge-assets` rely on UUID paths for obscurity, not on authorisation.
- **Parsers currently run in the application process.** The sandbox described in
  [docs/INGESTION.md](docs/INGESTION.md) section 12 — a dedicated non-root user,
  no network access, wall-clock timeouts, output quotas — lands in S16, alongside
  the Eric Zimmerman tools. Until then, treat the host as being able to see
  anything a malformed artifact could reach through a parser.
- **Disk images are mounted read-only** but are parsed with `dissect.target`
  in-process, with the same caveat.

## Handling evidence

Remora stores evidence unencrypted on disk outside the vault. Encrypt the
underlying volume and restrict access to the `data/` directory and the drop
folder. The drop folder is intentionally world-writable so analysts can copy
into it; it must not be shared beyond the analyst team.
