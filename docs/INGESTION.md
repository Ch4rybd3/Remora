# Remora — Artifact Ingestion Pipeline

Specification for the unified ingestion pipeline (S15) and the Eric Zimmerman
parser integration (S16). See `ROADMAP.md` for sequencing.

---

## 1. The problem

Fourteen routers currently expose `UploadFile`, each with its own storage
layout, its own naming, and its own hashing — or none:

```
assets  binary  case_emails  cases  chainsaw_rules  clients  collection_import
csv_artifacts  email_analysis  evidences  evtx  knowledge  memory  report_doc_templates  vault
```

Seven of them ingest case artifacts and are in scope for consolidation:
`binary`, `case_emails`, `collection_import`, `csv_artifacts`, `email_analysis`,
`evtx`, `memory`. The rest upload platform content and keep their own endpoints
(§2, *What is not an artifact*).

`evidences` was listed here in an earlier draft and does not belong. Uploading a
file straight into the chain of custody is not ingestion - the file is not
parsed, not routed, and not queried. It is the custody path, and routing it
through identification would only delay preserving it.

Consequences:
- No single answer to *"what has been ingested into this case?"*.
- No cross-cutting duplicate detection.
- Format support varies by entry point: an EVTX accepted by one endpoint is rejected by another.
- Parsing logic lives in routers, so it cannot be reused or tested.
- No record of the timezone the artifact was exported in — an ambiguity that is unrecoverable once the file is on disk.

## 2. The principle

**One ingestion path: the drop folder.** There is no unitary import any more.
No endpoint parses a file, decides where it belongs, or writes it to permanent
storage. Identification, deduplication and routing happen in exactly one
service, which means they are testable in exactly one place and behave
identically no matter how the bytes arrived.

### The two access points

```
  A. host filesystem ──── cp / scp / rsync / mount ─────┐
                                                        ▼
                                          <dropzone>/<case>/  ──► ingest service ──► routing
                                                        ▲
  B. Collection tab ───── POST .../uploads ─────────────┘
                          (writes the file, returns 202)
```

**A — directly on the machine.** The analyst copies an acquisition into the
case folder over SSH, from a mounted share, or from a write blocker. No browser
involved, no size limit but the disk, and a 400 GB E01 never travels through
HTTP. This is the path that matters for real acquisitions.

**B — from the Collection tab.** A drag-and-drop zone in the UI. This is a
*courier, not an importer*: it writes the bytes into the same case folder that
path A writes into, then returns `202 Accepted`. It holds no parsing logic and
makes no storage decision. Removing it would change nothing about how a file is
processed — only who can put one there.

Both converge before anything is inspected. An EVTX uploaded from a laptop and
an EVTX dropped by `scp` produce byte-identical `ingested_files` rows apart from
`origin` and `origin_detail`.

### Why the browser upload must not write in place

The watcher only picks up a file once its size and mtime are unchanged across
two consecutive polls (§3) — that is what stops a half-copied file being
ingested. An HTTP upload streamed straight into the case folder can still stall
long enough to look stable, and would then be parsed truncated.

So the upload endpoint writes to `<dropzone>/<case>/.incoming/<uuid>` and, once
the request body is fully read and the handle closed, **atomically renames** it
into the case folder. A rename within a filesystem is atomic, so the watcher
sees either nothing or a complete file — never a partial one. `.incoming/` is
skipped by the watcher, and anything left there is garbage from an interrupted
request, swept on startup.

A name that already exists in the case folder is suffixed (`System.evtx` →
`System (2).evtx`). It is not overwritten and not rejected: two acquisitions
legitimately contain a file of the same name, and content-level duplicates are
caught by hash in §7 regardless of what they are called.

### What is *not* an artifact

The rule covers **case artifacts** — evidence about the incident. It does not
cover platform content that happens to arrive as a file:

| Stays a direct upload | Why |
|---|---|
| Report DOCX/Markdown templates | Configuration, global, not case-scoped |
| Chainsaw / Sigma rule packs | Detection content, versioned with the tool |
| Knowledge base attachments, client and user avatars | Not evidence |
| Vault entries | Encrypted at rest by a different path on purpose |

Running these through hashing, magic-byte routing and a parser queue would buy
nothing and would put a report template in the Artifact Explorer. They keep
their own endpoints and are explicitly out of scope for §1's consolidation.

---

## 3. Layout

```
<dropzone>/
  acme-ransomware-4f3a9b21/       one folder per case (slug + short id)
    <files dropped here>
    evtx/  registry/  memory/     optional type hints (see §6)
    .incoming/                    browser uploads in flight, renamed in when complete
    .processed/                   ingested originals, moved never deleted
    .failed/                      files that could not be ingested, with a .error sidecar
  _inbox/                         case-less drops, assigned from the UI
```

The watcher skips every dot-prefixed folder, so nothing under `.incoming/`,
`.processed/` or `.failed/` is ever re-ingested.

A file is only picked up once its size and mtime are unchanged across two
consecutive polls, so a large copy in progress is never ingested half-written.
This behaviour already exists in `services/dropzone.py` and is preserved.

### What the folder accepts

**Anything the signature table recognises.** Not an extension whitelist - that
was the original gate, and it meant a memory image, a disk acquisition or a PE
copied into the case folder was *silently ignored*: the drop folder claimed to
be the single entry point while refusing half the artifact types, on the
strength of a filename.

Whether a parser exists is a separate question, answered per file in the ingest
queue. A recognised artifact with no parser is listed as `unsupported` with the
reason attached, which is worth far more than never appearing at all.

A file whose kind has no handler is **not copied into the collection
directory**. Duplicating a 64 GB memory image there would gain nothing: no
parser reads it from that location, and disk images are read in place by
design. Provenance is still recorded and the original still moves to
`.processed/`, so the file is listed, hashed and findable - and can be
preserved in the chain of custody like anything else.

---

## 4. State machine

```
discovered ──► hashed ──► identified ──► routed ──► parsed ──► indexed
                  │            │            │          │
                  │            ▼            │          ▼
                  │      unidentified       │       failed
                  ▼                         ▼
              duplicate                 unsupported
```

| State | Meaning |
|---|---|
| `discovered` | Seen in the drop folder, stable, not yet read. |
| `hashed` | SHA-256 computed. |
| `duplicate` | Hash already ingested in this case. Terminal. Original is referenced. |
| `identified` | Type determined from magic bytes (§5). |
| `unidentified` | No signature matched. **Terminal but recoverable** — surfaced in the Collection tab with a "force type" action. |
| `routed` | Destination module chosen and record created. |
| `parsed` | Raw artifact converted to a tabular form. |
| `indexed` | Available in the Artifact Explorer. |
| `failed` | Parser crashed, timed out, or exceeded its output quota. Recoverable: the error is stored and the file can be retried. |
| `unsupported` | Recognised type with no handler yet. Stored, listed, not parsed. |

Design rule: **no state discards the file.** Unrecognised input is a soft
signal, never an error. A single mandatory pipeline that rejects files becomes
a prison, and analysts route around prisons.

### `ingested_files`

Single source of truth for provenance.

| Column | Notes |
|---|---|
| `id` | UUID |
| `case_id` | FK, `ondelete="CASCADE"` |
| `collection_id` | FK — groups a batch/archive into one logical import |
| `original_name` | As dropped |
| `origin` | `dropzone` \| `upload` \| `archive` \| `connector` \| `legacy` |
| | `legacy` means the file predates this table. Which of the fourteen endpoints it came through was never recorded, and claiming one would be fabricating provenance - so "unknown" is a value, not a blank. |
| `origin_detail` | Parent archive path, uploading user, connector name |
| `size_bytes` | |
| `sha256` | Indexed |
| `magic_type` | libmagic MIME |
| `detected_kind` | Internal key, e.g. `evtx`, `mft`, `registry_hive` |
| `detection_source` | `magic` \| `extension` \| `folder_hint` \| `forced` |
| `source_timezone` | IANA name, `UTC` default (§7) |
| `state` | See above |
| `error` | Populated for `failed` |
| `routed_to` | Destination module |
| `parsed_artifact_id` | FK to the produced Explorer artifact, if any |
| `created_at` / `updated_at` | |

---

## 5. Identification

**Magic bytes take priority over the extension**, always. A `.txt` that is
really an EVTX must route to Logs; an `.evtx` that is really a text file must
not reach the EVTX parser.

Order of precedence: `magic bytes` → `structural sniff` → `folder hint` →
`extension` → `unidentified`.

| Kind | Signature |
|---|---|
| EVTX | `ElfFile\x00` at 0 |
| Registry hive | `regf` at 0 |
| MFT record | `FILE` at 0 |
| ESE database (SRUDB, Windows.edb) | `\xef\xcd\xab\x89` at 4 |
| Prefetch | `SCCA` at 4, or `MAM\x04` (compressed, Win10+) |
| LNK | `\x4c\x00\x00\x00` + LNK CLSID at 0 |
| EWF / E01 | `EVF\x09\x0d\x0a\xff\x00` at 0 |
| VHDX | `vhdxfile` at 0 |
| VMDK | `KDMV` at 0, or `# Disk DescriptorFile` |
| QCOW | `QFI\xfb` at 0 |
| PCAP | `\xd4\xc3\xb2\xa1` / `\xa1\xb2\xc3\xd4` at 0 |
| PCAPNG | `\x0a\x0d\x0d\x0a` at 0 |
| PE | `MZ` at 0 |
| ELF | `\x7fELF` at 0 |
| Mach-O | `\xfe\xed\xfa\xce` / `\xfe\xed\xfa\xcf` / `\xca\xfe\xba\xbe` at 0 |
| OLE compound (MSG, legacy Office) | `\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1` at 0 |
| PST | `!BDN` at 0 |
| SQLite | `SQLite format 3\x00` at 0 |
| ZIP / OOXML | `PK\x03\x04` at 0 |
| 7z | `7z\xbc\xaf\x27\x1c` at 0 |
| RAR | `Rar!\x1a\x07` at 0 |
| gzip | `\x1f\x8b` at 0 |
| LiME memory dump | `\x4c\x69\x4d\x45` at 0 |
| Windows crash dump | `PAGEDU64` / `PAGEDUMP` at 0 |

**No reliable signature** — identified by name or structure:
- `$J` / `$UsnJrnl:$J` — sparse, leading zeroes. Name-based, then record-structure validation.
- Raw memory dumps (`.vmem`, `.raw`, `.mem`, `.dmp` acquired raw) — no header. Size heuristic plus folder hint plus user confirmation.
- Raw disk images (`dd`) — identified by the partition table or filesystem superblock at a known offset, not by a file header.
- EML — RFC 822 header sniff on the first bytes.
- CSV / JSON / JSONL / TXT — content sniff; delimiter and header detection.

### Archives
Archives are unpacked recursively and **each member is re-routed independently**
through the full pipeline. The archive itself gets an `ingested_files` row with
`state=routed`, and members reference it through `origin=archive` and
`origin_detail`. Depth is capped and the total uncompressed size is capped —
a decompression bomb must not be able to fill the evidence store.

---

## 6. Routing

Declarative table, not a chain of `if` statements. One row per kind.

| Detected kind | Primary destination | Parsed into Explorer via |
|---|---|---|
| CSV / JSON / JSONL / TXT / LOG | Artifact Explorer | direct |
| EVTX | Logs (Chainsaw / Hayabusa) | EVTXECmd |
| `$MFT` | Logs | MFTECmd |
| `$J` / UsnJrnl | Logs | MFTECmd |
| Registry hive | — | RECmd + AmcacheParser + AppCompatCacheParser |
| Prefetch | — | PECmd |
| LNK | — | LECmd |
| Jump lists | — | JLECmd |
| Shellbags | — | SBECmd |
| Recycle bin (`$I`) | — | RBCmd |
| SRUDB.dat | — | SrumECmd |
| `ActivitiesCache.db` | — | WxTCmd |
| E01 / VMDK / VHDX / QCOW / raw | Disk Images | filesystem listing → CSV |
| Windows crash dump / LiME image | Memory Analysis | Volatility plugins → CSV |
| Raw memory dump | Memory Analysis | none — see below |
| EML / MSG / PST | Mail Analysis | headers, attachments, IOCs → CSV |
| PCAP / PCAPNG | PCAP | flows, DNS, HTTP → CSV |
| PE / ELF / Mach-O | Binary Analysis | metadata, imports, sections → CSV |
| Archive | recursive unpack | each member re-routed |
| Unidentified | Collection tab | none — awaits a forced type |

**Two destinations are the norm, not the exception.** A raw EVTX belongs in
Logs *and* in the Explorer. The analyst who wants Sigma detections goes to
Logs; the analyst who wants to pivot on a field goes to the Explorer. Producing
only one of the two is what forces manual re-import today.

### Dispatch

Routing decides *where* a file belongs. Dispatch decides *what happens to it* -
which parser runs. Without it the pipeline produced a correct answer that led
nowhere: it knew a file was an EVTX bound for Logs and had no way to send it
there.

`services/ingest/dispatch.py` holds a second declarative table, kind → handler.
The handlers **wrap the parsers that already exist** (`register_csv_artifact`,
`register_evtx_file`, `register_email_file`, the PCAP converter) rather than
reimplementing them, which is what makes it safe to route the legacy Collection
Import through the same table. Parsing behaviour does not change; only who
decides which parser runs, and on what evidence.

That last part is the upgrade the legacy path gets for free. It dispatched on
the filename extension, so a `.txt` that was really an EVTX was registered in
the Explorer as a one-column table of binary garbage. It now identifies from the
bytes like everything else.

An explicit `kind` is trusted over the bytes, because a kind an analyst forced
must not be quietly re-derived - that would undo the correction the Collection
tab exists to let them make.

Memory dumps, binaries and disk images are deliberately **absent** from the
handler table. Their routers still own that work, and wiring them in without
moving it would parse every one of them twice. They move over in the same pull
request that converts their endpoint.

A kind with no handler is `unsupported`, not an error: the file is stored and
listed, it is simply not queryable yet. A handler that raises produces `failed`
with the reason attached - a parser crash is a fact about one file, never a
reason to lose it or to stop the batch it arrived in.

### Kinds that need a person

Three artifact types are recognised and deliberately **not** parsed by the
pipeline, because acting on them requires something only an analyst can supply.
Each says so on its row rather than showing a generic "no parser":

| Kind | What is missing | How it is resolved |
|---|---|---|
| Raw memory dump | Which OS it came from. Guessing would queue the wrong Volatility plugins and produce confident wrong output. | **The dump waits in the queue** - hashed, listed, preservable - and the Collection tab offers `windows` / `linux` on its row. One click registers it in the Memory module. `POST .../ingest/{id}/memory-os`. |
| PE / ELF / Mach-O | The password the binary is encrypted under at rest. The drop folder cannot ask for one. | Upload from the Binary Analysis page. |
| Disk image | Nothing - but it must not be copied. | **The drop folder is an allowed root**, so the Disk Images page opens it where it lies. Nothing has to be moved. |

### Memory formats

Identification splits memory by what the format actually records:

| Signature / name | Kind | Why |
|---|---|---|
| `PAGEDU64`, `PAGEDUMP` | `memory_dump_windows` | A Windows crash dump is Windows. Parsed straight away. |
| `EMiL`, `.lime` | `memory_dump_linux` | LiME is a Linux acquisition format. Parsed straight away. |
| ELF with `e_type == ET_CORE` | `memory_dump_linux` | **A core dump and an ELF executable share `\x7fELF`.** Without the `e_type` check at offset `0x10`, a Linux memory image is filed as a binary and sent to Binary Analysis, which encrypts it under a password and asks nobody about Volatility. |
| `hibr`, `HIBR`, `wake`, `WAKE` | `hiberfil` | Hibernation file. `wake` marks one already resumed from - still the only copy of that machine's memory at suspend time. |
| `\xd2\xbe\xd2\xbe` | `memory_dump` | VMware suspend state. The guest OS is not in the header, so it needs the OS question. |
| `.raw`, `.mem`, `.dmp`, `.vmem`, `.crash` | `memory_dump` | No signature at all. The name is the only handle, and the OS question follows. |

AFF4 containers are not recognised: the format is a ZIP, so one is currently
identified as an archive and unpacked. That is a known gap, not a decision.

### Type-hint folders
Sub-folders such as `evtx/`, `registry/`, `memory/` are **optional hints, never
requirements**. Magic-byte routing makes them unnecessary, and an analyst under
time pressure will drop into the wrong one. A hint only breaks ties when the
signature is ambiguous. The real default is: drop anything anywhere in the case
folder.

---

## 7. Deduplication

SHA-256 on every file.

**Blocking is per case.** The same EVTX legitimately belongs to two different
cases and must exist in both. Dropping it twice into *one* case is a mistake
and is rejected with a reference to the original.

**The index is global.** When a hash is already known from another case, the
file is still ingested, and the Collection tab surfaces:

> *Also present in case ACME-2026-04 (ingested 2026-03-14).*

That cross-case signal is investigative value — the same tool dropped on two
victims is a finding, not noise — so it is shown, never used to block.

---

## 8. Source timezone

`TimezoneContext` on the frontend is **display only**. The missing half is the
input side.

- Every collection carries a `source_timezone` (IANA), overridable per file.
- Set in the Collection tab at import time, before parsing runs.
- Default: `UTC`, with a visible warning when a collection is left at the default and its parser produced naive timestamps.
- Parsers store UTC in the database, converting from the declared source zone.
- The original naive value is retained alongside the converted one, so a wrong declaration is correctable without re-ingesting.

This exists because real acquisitions mix local-time and UTC exports, and once
the file is on disk the ambiguity cannot be resolved from the data.

---

## 9. Storage

**CSV → Parquet, materialised on first query.**

Every query used to run `CREATE TEMP TABLE _src AS SELECT * FROM
read_csv_auto(...)`. That re-reads and re-parses the *entire* CSV on every page
turn, every sort, every filter change - so a 30 MB artifact paid full parse cost
to return 100 rows, and the cost did not fall as the analyst narrowed the query.

The first query converts the file once; every query after it reads the Parquet.
Columnar and typed: a filter on one column touches one column, and nothing is
re-parsed.

Measured on a synthetic 400,000-row, 28 MB artifact:

| | |
|---|---|
| Three filtered pages, scanning the CSV | 1.29 s |
| One-off conversion | 0.57 s |
| Three filtered pages, from Parquet | 0.11 s |

**About 12× on queries**, with the conversion paying for itself after roughly
one and a half of them. (That artifact is repetitive enough to compress from
28 MB to 420 KB; real ones will not shrink nearly that far.)

The conversion runs through the same `read_csv_auto` call the queries used to,
so DuckDB infers exactly the same types and no comparison changes meaning -
which is the only reason this is safe to introduce underneath a running product.
A test asserts the two paths return identical rows.

The cache is **derived data**. It lives outside the evidence and collection
directories, is keyed by a hash of the source path rather than by the path
itself - a cache directory should not become a second, unmanaged record of who
was investigated for what - and is dropped when the artifact is deleted.
Deleting it by hand costs one re-conversion and nothing else. `ARTIFACT_STORE_PARQUET=false`
falls back to scanning the CSV.

A conversion is written under a `.partial` name and renamed in, so a crash
mid-write cannot leave a file that looks like a valid cache. A conversion that
fails at all is logged and the query falls back to the CSV: a cache that cannot
be built is a performance problem, never a correctness one.

---

## 10. ECS normalisation

A common field vocabulary across artifact types, so a query means the same thing
whatever produced the row. This is a specification, not a product: adopting it
does not imply Elasticsearch. Deferred until after the store boundary lands.

---

## 11. `ArtifactStore`

The boundary that makes the engine replaceable. `services/store/base.py`.

```python
schema(source)                                   -> Schema
search(source, columns, query, sort, page)       -> Page
aggregate(source, columns, query, group_by)      -> list[Group]
find(source, columns, text, limit, regex)        -> (count, rows)
```

Four operations. The router asks nothing else, and holds no DuckDB code at all -
it used to hold four functions, each opening its own connection.

**Why this exists.** DuckDB is right for this product today: embedded, reads
files in place, costs nothing when idle, which matters for a tool meant to run
on an analyst's laptop. But "should Remora move to Elasticsearch?" will be asked
again, and the honest answer depends on scale nobody has yet. This boundary
makes that a decision about one module rather than a rewrite - an Elasticsearch
backend implements these four methods and the rest of the product does not
notice.

The roadmap named `get_by_id` as a fifth. It is not there: a CSV row has no
identity, and a row number would be an identifier that changes when the file is
re-sorted. The Explorer opens rows from the page it already holds.

---

## 12. Parser execution sandbox (S16)

The Eric Zimmerman tools run on .NET 9 on Linux, which is what makes native
Windows-artifact parsing possible here. It also means Remora will execute code
against attacker-controlled input. That question **will** be asked publicly, so
the answer is designed in rather than retrofitted:

- Dedicated non-root user (`remora-parser`, created by the backend image); no
  write access outside the per-run scratch directory, which is handed to it at
  execution time.
- **No network.** Implemented with a seccomp filter, not a network namespace.

  A namespace needs `CAP_SYS_ADMIN`, which Docker does not grant by default and
  which it would be absurd to add: the capability that lets a process mount
  filesystems and enter other namespaces is a far larger hole than the one it
  would close. A seccomp filter needs no privilege at all - any process may
  install one after setting `no_new_privs` - and is stricter in one useful way:
  a namespace with no interfaces still lets a process *create* a socket, while
  this makes the attempt fail.

  `AF_UNIX` stays allowed. Language runtimes create local sockets for their own
  plumbing, and denying those breaks the parser rather than containing it. A
  Unix socket cannot reach a network.

  A syscall arriving on an architecture the filter does not recognise is
  refused rather than allowed - the direction to be wrong in, because the
  alternative is a filter that matches nothing and looks like it works.
- **The wall-clock ceiling grows with the size of the artifact.** A flat number
  is wrong in both directions at once: long enough for a 2 GB `$MFT` is long
  enough for a hostile 4 KB file to pin a core for an hour, and short enough to
  contain that file kills legitimate work on the `$MFT`. EVTXECmd on a few
  hundred megabytes of `Security.evtx`, or MFTECmd on a gigabyte `$MFT`, runs
  for tens of minutes on ordinary hardware.

  15 minutes as a floor, plus 30 minutes per gigabyte, capped at 4 hours. The
  cap exists because the input is hostile and "however long it takes" is not a
  limit.
- The **process group** is killed on expiry, not the process - a parser that
  forked would otherwise leave children running after the one we know about is
  gone.
- The CPU budget is a **multiple** of the wall budget. `RLIMIT_CPU` sums every
  thread, so a parser using four cores burns four CPU-seconds per second of
  wall clock; equal to the wall budget it would be killed at a quarter of its
  time, with a signal nobody could interpret. It is a backstop against a
  process that ignores the clock, not the primary limit.
- Output size quota; exceeding it fails the run rather than filling the disk.
- Memory limit via `RLIMIT_AS`, CPU via `RLIMIT_CPU` (which survives a process that ignores signals), output via `RLIMIT_FSIZE` per file plus a total measured after the run.
- Input path is passed positionally and never interpolated into a shell — parsers are invoked with an argv list, never through `shell=True`.
- Tool versions are pinned and vendored; the versions used are recorded on the `ingested_files` row so a parse is reproducible.
- Failure is `state=failed` with the captured stderr. A crashing parser never takes down ingestion for the rest of the collection.

---

## 13. Process tree (S16)

Reconstructed where the data allows, from strongest to weakest source:

1. **Sysmon Event ID 1** — parent GUID, command line, hashes. Authoritative.
2. **Security 4688** — parent PID, command line if audit policy captured it.
3. **Amcache / Shimcache / Prefetch** — execution evidence without lineage; attached as corroboration on a node, not used to build edges.

Rules:
- PID reuse is resolved by time window, not by PID alone.
- An orphan process attaches to a synthetic root. It is never dropped — a missing parent is itself a finding.
- Nodes carry their evidence sources, so an analyst can see whether a link is asserted or inferred.
- Rendered with the shared graph components extracted in S13, so it inherits the playbook editor's interaction model.

---

## 14. Migration from the current state

1. Ship the ingest service alongside the existing endpoints; both write `ingested_files`.
2. Backfill `ingested_files` from existing `ImportedFile` rows, in a background
   thread at startup - off the boot path, because hashing every artifact on a
   large installation is minutes of IO and an upgrade that looks like a hang is
   worse than one that fills in slowly. Idempotent, so an interrupted run
   resumes on the next start.
   - Where the bytes still exist they are re-identified from the signature. The
     recorded category came from the old filename matching, which is precisely
     the answer this pipeline exists to stop trusting.
   - Where they do not - collections expire after 90 days - the row is still
     written, with the weaker recorded category labelled `extension` so it can
     be overridden. That a file was ingested is itself a fact about the
     investigation; losing it because the artifact was cleaned up would defeat
     the point of the table.
3. Convert the eight artifact upload endpoints into drop-folder couriers, one
   module per PR: write to `.incoming/`, rename in, return `202`.
4. Remove the parsing, hashing and storage code left dead in those routers.
   This is the step that actually retires the unitary import - until it lands,
   two paths still exist and can disagree.
5. Rebuild the Collection tab around the ingest queue: a drop zone, the
   `ingested_files` list with its state per file, and the actions the states
   call for - force a type on `unidentified`, retry a `failed`, set the source
   timezone before parsing. It stops being an import form and becomes the view
   of what the pipeline is doing.
6. Convert stored CSV to Parquet lazily, on first access.

No step requires downtime, and each is independently revertible.
