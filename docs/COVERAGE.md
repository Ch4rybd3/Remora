# Artifact parsing coverage

What Remora parses out of a real triage, what it does not, and what closing
each gap costs. Every number here is measured, not estimated.

**Reference collection**: `kapetriage2.zip` — a KAPE `!SANS_Triage` collection
from a live Windows 11 machine. 2,058 files, 3,745 MB extracted. Measured
2026-09-02 by running `services/ingest/identify.py` over every file and
bucketing by whether `dispatch` has a handler for the result.

---

## 1. Where it stands

All three tiers have landed. Every measurement is on the same collection.

| | Files before | Files now | Bytes before | Bytes now |
|---|---:|---:|---:|---:|
| **Parsed** — a table in the Explorer | 1,032 (50.1 %) | **1,945 (94.5 %)** | 2,621 MB (70.0 %) | **3,374 MB (90.1 %)** |
| **Browsable** — a module opens it as it stands | 36 (1.7 %) | 36 (1.7 %) | 260 MB (6.9 %) | 260 MB (6.9 %) |
| **No handler** | 990 (48.1 %) | **77 (3.7 %)** | 865 MB (23.1 %) | **112 MB (3.0 %)** |

Reachable one way or another: **96.2 % of files and 97.0 % of bytes.**

Parsed, by artifact type:

| Kind | Files | Bytes | |
|---|---:|---:|---|
| recycle_bin | 538 | 0.1 MB | tier 1 |
| prefetch | 439 | 13.5 MB | |
| lnk | 281 | 0.3 MB | |
| scheduled_task | 272 | 0.9 MB | tier 1 |
| evtx | 178 | 405.8 MB | |
| jumplist_auto | 79 | 3.9 MB | |
| jumplist_custom | 79 | 0.5 MB | tier 1 |
| already tabular (log/json/text/csv) | 42 | 20.3 MB | |
| browser history + cookies | 7 | 34.9 MB | |
| windows_timeline | 2 | 11.3 MB | |
| sqlite (generic) | 17 | 30.5 MB | tier 3 |
| rdp_bitmap_cache | 6 | 600.4 MB | tier 3 |
| browser_cache (WebCacheV01) | 2 | 82.5 MB | tier 2 |
| srum | 1 | 37.9 MB | tier 2 |
| `$MFT` | 1 | 2,092.5 MB | |
| `$J` | 1 | 38.3 MB | |

Browsable: 36 registry hives, 260 MB — the Registry Explorer (§17 of
`INGESTION.md`).

### What is left

77 files and 112 MB, most of it one file:

| Kind | Files | Bytes | |
|---|---:|---:|---|
| unknown | 70 | 21.6 MB | mostly SQLite `-wal`/`-shm` sidecars, `.jsonlz4` session backups, NTFS metadata |
| binary_blob | 5 | 26.2 MB | opaque `.bin`/`.dat` with no signature |
| ntfs_logfile | 1 | 64.0 MB | tier 4, deliberately |
| empty | 1 | 0 | |

`$LogFile` is 64 MB of the 112 MB remaining, and it is in tier 4 on purpose —
weeks of work for questions `$MFT` and `$J` already mostly answer.

The SQLite sidecars are worth a note. A `-wal` file is not an artifact of its
own — it belongs to the database beside it, and the browser parser already
copies it along — so parsing it separately would be wrong. Labelling it as such
instead of `unknown` would stop the ingest queue inviting an analyst to force a
type on it. Small, and not done.

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

### Tier 1 — identification, and one recipe row — **done**

**Cost: small. Coverage delivered: 50.1 % → 93.2 % of files.**

All three are matched on **content**, not on a filename or a folder. That was a
deliberate constraint: a collection that is not KAPE names things differently,
and an analyst exporting artifacts by hand names them worse. The detections
below fire on bytes alone.

1. **`$Recycle.Bin` `$I`** — the header is a version number, not a magic, so
   the detection is **structural**: the declared path length has to account for
   exactly the bytes present and the path has to look like a Windows path.
   Nothing about the name or the folder is consulted. That check earns its
   keep immediately — an empty `customDestinations-ms` is twelve bytes
   beginning `02 00 00 00 00 00 00 00`, byte for byte the header of a version 2
   `$I` record, and only the structural test separates them.
   Then one row in `RECIPES`: `recycle_bin` → RBCmd with `-d`, in the batch
   stage, one table with a source column.
2. **`CustomDestinations`** — detected by an embedded shell-link header at a
   non-zero offset, or by the `AB FB BF BA` terminator. Not the extension: 52
   of the 79 in the reference triage are named `.tmp` or `.temp`, caught
   mid-write, and every one holds real link data. The extension survives only
   as a last resort for an empty jump list, where the content says nothing.
3. **Scheduled Tasks** — a UTF-16 byte-order mark and `<?x`, confirmed by the
   Task schema URI appearing in the head. Every UTF-16 XML document starts the
   same way, so the schema check is what stops this swallowing them. A Python
   parser produces one row per **action**: the question is "what runs?", so the
   command is what gets filtered on. 272 tasks became 274 rows, half of them
   COM handlers rather than executables.

Two supporting changes the above needed:

* **Staging mirrors the source tree.** A `$I` record sits under the SID of the
  account that deleted the file; flattening 538 of them into one directory
  throws away *who*. RBCmd reports the path it read, so mirroring preserves it.
* **`Recipe.stage_as`** appends an extension when staging for a
  directory-reading tool, because JLECmd decides what to read from the
  extension and would otherwise walk past every `.tmp` jump list. Appended,
  never replaced, so the original name survives into the tool's own source
  column.

### Tier 2 — one dependency unlocks a family — **done**

**Cost: one pip package. Coverage delivered: +3 files, +120 MB, and four
artifact classes.**

`dissect.esedb` makes the ESE family readable, and carries a SRUM helper that
resolves the application and user id maps — the part that turns a table of
integers into "discord.exe sent 88 MB for S-1-5-21-… at 19:22".

| Artifact | In this triage | Reader |
|---|---:|---|
| SRUM (`SRUDB.dat`) | 37.9 MB, 127k rows | One table per provider |
| `WebCacheV01.dat` | 82.5 MB, 395 entries | One table, container name as a column |
| `Windows.edb` | — | Generic table dump |
| `NTDS.dit` | — | Generic table dump |

**One table per SRUM provider**, not one merged table: the providers hold
genuinely different columns — bytes on a wire, energy drawn from a battery —
and merging them makes one wide table that is mostly empty. The reference
database produced ten, `network_data` (22,778 rows) and `application` (65,860)
being the two an analyst reaches for.

**One table for the web cache**, because every `Container_N` shares a schema
and differs only in what it holds. Which number History landed on varies by
machine, so it becomes a column rather than a filename.

**A generic table dump for the rest.** Not a good answer — the columns are
whatever Microsoft called them and nothing is resolved — but a true one, and it
means an ESE artifact nobody has written a reader for is queryable on the day
it arrives rather than listed as unsupported indefinitely. `NTDS.dit` in
particular needs the SYSTEM hive's boot key before anything in it decrypts;
dumping the tables is honest about stopping short of that.

Two things this got wrong first time, both found by running it against the real
files rather than a fixture:

* **Catching failures per file rather than per table.** One container in the
  reference `WebCacheV01.dat` raises inside the library, and catching per file
  threw away the other fifty-one — 185 entries recovered instead of 378.
* **Reading records through `as_dict()`.** That helper walks the record's
  fixed-column range, and on 16 of 52 containers the range's upper bound is
  absent, so it raises before returning a value. Asking for the columns
  actually wanted never touches that path: 378 entries became 395, with no
  errors left at all.

A third, smaller: about 4 % of SRUM `network_data` rows carry an application id
that is not in the id map. Writing an empty cell for those lost the fact that
the row *has* an id — the raw number correlates across rows, a blank does not —
so an unresolved id keeps its number.

**Bounded on purpose.** These parsers run in-process rather than in the parser
sandbox, and an ESE database can be tens of gigabytes. Per-table row caps and a
per-cell character cap are what stop a hostile or merely enormous file taking
the worker with it. Moving the Python parsers behind the sandbox is worth doing
and is not done.

### Tier 3 — real work, real value — **done**

**Coverage delivered: 93.4 % → 94.5 % of files, and 73.2 % → 90.1 % of bytes.**

**Generic SQLite → tables.** 17 files here. The value is not those files: it is
that *every* future SQLite artifact — Teams, Slack, Signal, QuickAccess, every
Electron application ever shipped — becomes readable without a parser each.
Databases that have a dedicated reader never arrive: identification refines a
SQLite container by name first, so browser history and the Windows Timeline
keep the parsers that understand their columns. Copied before opening, because
SQLite replays its write-ahead log on open and that is a write.

**RDP bitmap cache.** 6 files, 600 MB — 16 % of the bytes in this triage, and
the only artifact in it that reconstructs what an operator *saw* rather than
what ran. 38,724 tiles decoded into 42 contact sheets in 60 seconds, 44 MB of
PNG for 600 MB of cache.

The format was established from the files rather than assumed, and every step
was checked before any code was written:

* The container announces itself: `RDP8bmp\x00`, a 12-byte file header, then
  tiles laid end to end — each a 12-byte header (two key words, width, height)
  followed by raw 32-bit pixels. Reading the reference cache that way consumes
  it exactly.
* Tiles are **not** all 64×64. The reference cache holds 64×32, 48×64 and 48×32
  as well, so dimensions are read per tile. Assuming a fixed size — which the
  first hundred tiles invite — desynchronises everything after the first
  exception.
* Neighbouring pixels within a tile differ by 5.8 on average where a shuffle of
  the same pixels differs by 23.8. Pictures correlate spatially; noise does
  not. That is what established the pixel layout rather than a guess.
* The fourth byte of every pixel sampled is `0xFF`, which makes it padding
  rather than alpha. The pixels are BGRX.
* The channel order was confirmed by rendering both interpretations and looking
  at them. This is the one thing no automated check catches: read as RGBA, every
  picture still renders — a Windows title bar simply comes out orange, and a
  test that counts pixels sees nothing wrong. There is now a test asserting a
  known red tile is red.

Output is **contact sheets, not 38,724 files**: a tile alone says almost
nothing, and a grid of them in cache order is what an analyst reads. Cache
order is roughly chronological — a tile is rewritten when its screen region
changes — and it is the only ordering the artifact carries, so it is preserved.
The index beside the sheets is an ordinary Explorer table, so tiles can be
counted, filtered and pivoted on, including filtering the blank ones out.

Only the RDP8 container is read. Windows XP and Vista era clients wrote an
older layout; those are not decoded, and the page says so.

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

| | Files | Bytes |
|---|---:|---:|
| Before tier 1 | 50.1 % | 70.0 % |
| After tier 1 (measured) | 93.2 % | 70.0 % |
| After tier 2 (measured) | 93.4 % | 73.2 % |
| **After tier 3 (measured)** | **94.5 %** | **90.1 %** |
| Parsed *or* browsable | **96.2 %** | **97.0 %** |

Every projection held. Tier 1 was projected at 93.3 % and delivered 93.2 % (the
difference is one `$I` record previously counted as a shortcut); tier 3 was
projected at 94.4 % / 90.0 % and delivered 94.5 % / 90.1 %.

### Still outstanding, and worth saying

* **The Python parsers do not run in the sandbox.** The Eric Zimmerman tools
  do; the parsers written here run in-process. Row, cell and tile caps bound
  the work, but bounding is not containment, and an ESE database or a bitmap
  cache is a far larger attack surface than a prefetch file. This is the
  largest piece of unfinished business in the pipeline.
* **SQLite sidecars read as `unknown`.** A `-wal` file is not an artifact of
  its own and must not be parsed separately, but labelling it as belonging to
  the database beside it would stop the ingest queue inviting an analyst to
  force a type on it. 70 of the 77 remaining files are this and similar.

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
