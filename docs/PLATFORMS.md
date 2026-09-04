# Remora — Beyond Windows

A proposal, not a decision. Nothing here is built.

Everything Remora parses today is a Windows artifact, and the pipeline's shape
reflects that: a file arrives, its bytes say what it is, a parser turns it into
a table. That works because Windows forensics is a collection of *files with
signatures* - an EVTX is an EVTX wherever you find it.

**Linux, macOS, Android and iOS do not work that way**, and the difference is
structural rather than a matter of adding parsers.

---

## 1. What actually differs

### The artifact is often not a file

| Platform | Example | Problem |
|---|---|---|
| Linux | `/var/log/journal/<machine-id>/*.journal` | A set of files that only mean something together |
| Linux | `/etc/passwd`, `/etc/shadow`, `/var/log/auth.log` | Plain text with no signature at all |
| macOS | `/private/var/db/uuidtext/` + `.tracev3` | The unified log needs its own string tables to be readable |
| Android | `data/data/<package>/databases/` | Meaning comes from the package it belongs to |
| iOS | `Manifest.db` plus files named by SHA-1 | **Every file has a meaningless name** |

An iOS backup is the clearest case. `3d0d7e5fb2ce288813306e4d4636395e047a3d28` is
the SMS database, and nothing about the file says so - only `Manifest.db` knows.
No signature table will ever classify it.

### The platform is a property of the acquisition

On Windows, a dropped `$MFT` is an `$MFT` with no further context. On iOS,
knowing "this tree is an iTunes backup" tells you how to read every file in it.

That is the architectural gap: identification is currently **per file**, and
these platforms need a step **above** it.

---

## 2. The proposal: acquisition profiles

One new stage, before per-file identification.

```
  archive or folder
        │
        ▼
  ┌─────────────────┐   "this tree is an iOS backup"
  │ profile         │   "this is a KAPE triage"
  │ recognition     │   "this is a UAC collection"
  └────────┬────────┘   "this is a sysdiagnose"
           │
           ▼
  ┌─────────────────┐   profile-specific: path → kind
  │ path mapping    │   (falls back to signatures where there is no profile)
  └────────┬────────┘
           │
           ▼
     existing pipeline: kind → parser → Explorer
```

A **profile** is three things:

1. **A recogniser.** A predicate over the tree. `Manifest.db` and
   `Info.plist` at the root means an iOS backup; `C/Windows/System32/config/`
   means a Windows triage; `[root]/etc/os-release` means a Linux collection.
2. **A path map.** Rules turning a path into a kind, consulted *before* the
   signature table. On iOS this is a lookup through `Manifest.db`; on Linux it
   is mostly literal paths.
3. **A platform label**, recorded on every `ingested_files` row from that
   acquisition.

**Where signatures still win.** A profile says what a file is *supposed* to be;
the bytes say what it *is*. Where the two disagree, the bytes win and the
disagreement is worth surfacing - a `.journal` that is actually a ZIP is
interesting.

### Why this is cheap

The pieces already exist and are already declarative:

- `identify.py` already refines a container by name. A profile is the same
  idea one level up.
- `routing.py` and the parser table are already `kind → destination`. They gain
  a platform column; they do not change shape.
- `ingested_files` already records `detection_source`. `profile` and `platform`
  are two more columns.

---

## 3. Per platform, concretely

### Linux — the easiest, start here

Acquisitions are usually a `tar` from UAC, CatScale or a manual collection.

| Artifact | Parser |
|---|---|
| `auth.log`, `secure`, `syslog` | Regex per distribution family. Text, no library. |
| systemd journal | `journalctl --file` if present, otherwise a binary reader |
| `/etc/passwd`, `group`, `sudoers` | Trivial, and high value |
| `bash_history` and friends | Text, no timestamps unless `HISTTIMEFORMAT` was set |
| `wtmp`, `btmp`, `lastlog` | Fixed-size C structs |
| `audit.log` | Key-value text |
| Docker/containerd state | JSON |

**No new dependency for most of it.** This is where ECS earns its keep: a Linux
`auth.log` login and a Windows 4624 become the same query.

### macOS — one hard part, the rest easy

| Artifact | Parser |
|---|---|
| Unified log (`.tracev3`) | **Hard.** Needs `uuidtext` and `dsc` string tables. A real project. |
| `.plist` (binary and XML) | stdlib `plistlib` |
| FSEvents | Documented, gzip-framed |
| `quarantine` DB, `knowledgeC.db`, `TCC.db` | SQLite |
| `.DS_Store` | Documented |

Start with plists and the SQLite databases; treat the unified log as its own
project.

### iOS — the profile pays for itself here

An iTunes/Finder backup is `Manifest.db` plus SHA-1-named blobs.

- Read `Manifest.db` once; it maps every hashed file to its real domain and path.
- Everything downstream is then ordinary: `sms.db`, `CallHistory.storeData`,
  `knowledgeC.db`, `Safari/History.db` are SQLite.
- Encrypted backups need the password, which is an analyst input like the
  memory OS question already is.

**Without profiles this platform is unreachable.** With them, most of it is
SQLite.

### Android — the most fragmented

- **ADB backup** (`.ab`): a header plus a deflated tar. Trivial to unwrap.
- **Physical image**: goes through the existing disk image path.
- Per app: `data/data/<package>/databases/*.db` - SQLite again, but what each
  means depends on the package, so the map is per-app and will always be
  incomplete.
- `logcat`, `dumpsys`: text.

Honest expectation: broad coverage of the framework artifacts, best-effort on
apps.

---

## 4. What I would not do

**A plugin system.** Tempting, and premature. The tables are already
declarative; a plugin API adds a contract to maintain before there is a second
implementer. Add it when someone outside the project asks.

**One parser per artifact per platform.** A browser history is SQLite on all
five platforms. The parser should key on *format*, and the profile should say
which file is which - otherwise the same code is written five times.

**Waiting for ECS.** The field vocabulary matters more as platforms multiply,
but it is not a prerequisite. Parse first, normalise after.

---

## 5. Suggested order

1. **Linux.** Mostly text, no new dependencies, and it exercises the profile
   layer on the easy case.
2. **iOS.** The profile layer pays for itself immediately, and the artifacts
   behind it are SQLite.
3. **macOS**, minus the unified log.
4. **Android**, framework artifacts first.
5. **The macOS unified log**, on its own, when there is a reason.

Each step is one profile plus a handful of parsers. None of them changes the
pipeline.
