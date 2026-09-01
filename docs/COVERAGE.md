# Artifact parsing coverage

What Remora parses out of a real triage, what it does not, and what closing
each gap costs. Every number here is measured, not estimated.

**Reference collection**: `kapetriage2.zip` — a KAPE `!SANS_Triage` collection
from a live Windows 11 machine. 2,058 files, 3,745 MB extracted. Measured
2026-09-02 by running `services/ingest/identify.py` over every file and
bucketing by whether `dispatch` has a handler for the result.

---

## 1. Where it stands

| | Files | | Bytes | |
|---|---:|---:|---:|---:|
| **Parsed** — a table in the Explorer | 1,032 | 50.1 % | 2,621 MB | 70.0 % |
| **Browsable** — a module opens it as it stands | 36 | 1.7 % | 260 MB | 6.9 % |
| **No handler** | 990 | 48.1 % | 865 MB | 23.1 % |

Parsed, by artifact type:

| Kind | Files | Bytes |
|---|---:|---:|
| prefetch | 439 | 13.5 MB |
| lnk | 282 | 0.3 MB |
| evtx | 178 | 405.8 MB |
| jumplist_auto | 79 | 3.9 MB |
| already tabular (log/json/text/csv) | 43 | 20.3 MB |
| browser history + cookies | 7 | 34.9 MB |
| windows_timeline | 2 | 11.3 MB |
| `$MFT` | 1 | 2,092.5 MB |
| `$J` | 1 | 38.3 MB |

Browsable: 36 registry hives, 260 MB — the Registry Explorer (§17 of
`INGESTION.md`).

---

## 2. The finding that reorders everything

**The largest gap is identification, not parsing.**

Of the 990 files with no handler, 889 belong to three groups. Two of the three
already have a parser sitting there unused, and the third needs a small one.
None of them needs a new tool, a new dependency, or a new page.

| Group | Files | % of triage | Identified as | Parser |
|---|---:|---:|---|---|
| `$Recycle.Bin` `$I` metadata | 538 | 26.1 % | `unknown` (312), `archive_zip` (154), `archive_7z` (37), `archive_rar` (32) | **RBCmd, already provisioned** |
| Scheduled Tasks | 272 | 13.2 % | `unknown` | none — needs one |
| `CustomDestinations` jump lists | 79 | 3.8 % | `unknown` | **JLECmd, already wired** |

Closing these three moves coverage from **50.1 % to 93.3 % of files**.

### Why they are missed

**`$I` files** carry the *deleted file's* extension — `$IZJNHSA.zip` is 212
bytes of metadata about a deleted ZIP, not a ZIP. Identification falls back to
the extension, so 223 of them are currently classified as archives and handed
to the archive sweep, which finds nothing in them. The remaining 312 have
extensions nothing recognises and land as `unknown`.

They are also among the most valuable artifacts in the collection: each one
names a file that was deleted, its original full path, its size, and when it
went. A worked example from this triage:

```
$IZUAP07.stl   146 bytes
  version 2, deleted size 8,358,984
  C:\Users\fsali\Documents\stl-manager\inbox\warrior arm.stl
```

The structure is fixed and trivial: version, size, FILETIME, then a
length-prefixed UTF-16 path. Identification is the whole problem.

**Scheduled Tasks** are UTF-16 XML under `Windows\System32\Tasks\`, usually
with no extension at all. They are where persistence lives, and 272 of them
being invisible is the single most alarming line in this table.

**`CustomDestinations`** are jump lists. `jumplist_custom` exists as a kind and
JLECmd already reads it in batch — these files simply never reach it.

---

## 3. Ranked plan

Ordered by coverage gained per unit of work and risk, not by how interesting
the artifact is.

### Tier 1 — identification, and one recipe row

**Cost: small. Coverage: +43 % of files.**

1. **`$Recycle.Bin` `$I`** — identify by the `$I` name inside a `$Recycle.Bin`
   path, validated structurally (version 1 or 2, a plausible path length) so a
   file merely *called* `$I…` is not misread. Then one row in `RECIPES`:
   `recycle_bin` → RBCmd with `-d`, which puts it in the batch stage and
   produces one table with a `SourceFile` column, like the others.
   Identification must also stop calling them archives — feeding 223
   non-archives to the unpacker is wrong even though it is currently harmless.
2. **`CustomDestinations`** — extension and folder-hint rules for
   `.customdestinations-ms`. No parser work at all.
3. **Scheduled Tasks** — folder hint plus a UTF-16 XML content check, and a
   Python parser. No Eric Zimmerman tool reads these; the XML is
   straightforward and the fields worth extracting are settled (task name,
   author, trigger, action, principal, enabled).

### Tier 2 — one dependency unlocks a family

**Cost: one pip package. Coverage: +6 files, +120 MB, and four artifact
classes.**

Adding `dissect.esedb` makes the whole ESE family readable at once:

| Artifact | In this triage | Value |
|---|---:|---|
| SRUM (`SRUDB.dat`) | 37.9 MB | Per-application network bytes sent and received. The artifact for "what left the machine". |
| `WebCacheV01.dat` | 82.5 MB | IE/Edge history and cache metadata. |
| `Windows.edb` | — | Search index; content of indexed files. |
| `NTDS.dit` | — | Domain accounts, on a DC collection. |

SrumECmd is Windows-only, so SRUM needs a Python parser regardless. `dissect.esedb`
is the same library `dissect.target` builds on and is the natural choice.

### Tier 3 — real work, real value

4. **Generic SQLite → tables.** 18 files here, 30.5 MB — Firefox
   `permissions`/`protections`/`favicons`, Edge `Web Data`, `Collections`. The
   value is not those files specifically: it is that *every* future SQLite
   artifact (Teams, Slack, Signal, QuickAccess, countless application
   databases) becomes readable without a parser each. Dump every table to its
   own CSV, `sqlite3` from the standard library, and the same copy-before-open
   care the browser parser already takes.
5. **RDP bitmap cache.** 6 files, 600 MB — **16 % of the bytes in this
   triage**, and the only artifact here that reconstructs what an operator
   actually *saw* on a remote session. Output is images, not a table, so it
   needs a viewer rather than an Explorer entry. Highest value per file in the
   whole collection; also the largest single piece of work in this document.

### Tier 4 — deliberately not doing

- **`$R` content files** (the deleted files themselves — `.stl`, `.jpg`,
  `.pdf`). These are user documents, not artifacts to parse. Listing them
  against their `$I` metadata is the answer; parsing them is not.
- **`$LogFile`** (1 file, 64 MB). No library exists; writing an NTFS
  transaction-log parser is weeks, and `$MFT` plus `$J` already answer most of
  what it would.
- **`.jsonlz4` Firefox bookmark backups** (14 files, small). Low value beside
  `places.sqlite`, which is already parsed.
- **AD1 images.** Set aside by decision.

---

## 4. What this would leave

With tiers 1–3 landed:

| | Files | Bytes |
|---|---:|---:|
| Now | 50.1 % | 70.0 % |
| After tier 1 | 93.3 % | 70.1 % |
| After tiers 1–3 | 94.4 % | 90.0 % |

Tier 1 buys the file count; tiers 2 and 3 buy the bytes. The two are different
questions and it is worth not confusing them: 439 prefetch files matter because
of how many there are, and one `$MFT` matters despite being one file.

---

## 5. Method

Reproduce with:

```
7z x kapetriage2.zip -o<dir>
```

then walk every file through `identify()` and bucket the result against
`dispatch.handled_kinds()`. The measurement script is not checked in — it is
twenty lines and the numbers age with the codebase; re-derive rather than trust
this table after the tiers land.

Two ways an earlier measurement of this went wrong, both worth avoiding again:

* Reading ZIP entries with Python's `zipfile` raises on Deflate64, and the
  files that failed were counted as identified from an empty header. Extract
  with `7z` first.
* Counting a file as "handled" because its *kind* has a handler, without
  checking that the handler produces anything. Prefetch was in that state for
  a sprint.
