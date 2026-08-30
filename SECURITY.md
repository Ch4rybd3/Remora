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
- **Parser execution is sandboxed** (`backend/app/services/sandbox.py`). The
  Eric Zimmerman tools parse Windows artifacts natively, which means Remora
  executes code against files that came out of a compromised machine. What is
  enforced, each layer independently sufficient for what it stops:

  | | |
  |---|---|
  | Not root | `setuid` to `remora-parser` before `exec` |
  | No network | seccomp filter refusing `socket()` for every domain but `AF_UNIX` |
  | No privilege regain | `PR_SET_NO_NEW_PRIVS` |
  | Bounded time | wall-clock timeout, then the whole process group is killed |
  | Bounded memory, CPU, output | `RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_FSIZE`, plus a measured total |
  | No shell | argv list, never a string, never `shell=True` |

  A network namespace was considered and rejected: it requires `CAP_SYS_ADMIN`,
  a far larger hole than the one it closes. The seccomp filter needs no
  privilege and is stricter - a namespace with no interfaces still lets a
  process create a socket.

  `Result.applied` records what was actually enforced for a given run, so a
  deployment where the sandbox is weaker than intended can say so rather than
  looking identical to one where it is not. The tests assert the containment
  against the kernel by running real processes, not against mocks.

## Handling evidence

Remora stores evidence unencrypted on disk outside the vault. Encrypt the
underlying volume and restrict access to the `data/` directory and the drop
folder. The drop folder is intentionally world-writable so analysts can copy
into it; it must not be shared beyond the analyst team.
