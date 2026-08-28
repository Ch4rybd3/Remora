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

Eight of them ingest case artifacts and are in scope for consolidation:
`binary`, `case_emails`, `collection_import`, `csv_artifacts`, `email_analysis`,
`evidences`, `evtx`, `memory`. The rest upload platform content and keep their
own endpoints (§2, *What is not an artifact*).

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
| Memory dump | Memory Analysis | Volatility plugins → CSV |
| EML / MSG / PST | Mail Analysis | headers, attachments, IOCs → CSV |
| PCAP / PCAPNG | PCAP | flows, DNS, HTTP → CSV |
| PE / ELF / Mach-O | Binary Analysis | metadata, imports, sections → CSV |
| Archive | recursive unpack | each member re-routed |
| Unidentified | Collection tab | none — awaits a forced type |

**Two destinations are the norm, not the exception.** A raw EVTX belongs in
Logs *and* in the Explorer. The analyst who wants Sigma detections goes to
Logs; the analyst who wants to pivot on a field goes to the Explorer. Producing
only one of the two is what forces manual re-import today.

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

**CSV → Parquet**, partitioned by case and artifact kind.

`routers/csv_artifacts.py:160` opens an in-memory DuckDB connection and calls
`read_csv_auto` **on every request** — the full file is re-scanned and re-parsed
for each page of results. Parquet is columnar, typed and compressed; the same
queries touch only the projected columns.

Consequences:
- No architectural change. DuckDB reads Parquet natively.
- No feature loss. RQL, dynamic column detection, date-column auto-detection and timeline pinning are untouched.
- The current CSV files remain readable; conversion happens on access.

## 10. ECS normalisation

Each parser emits **two** tables:

1. **Raw** — the parser's native columns, preserved verbatim. This is what the Explorer shows today and what an analyst needs when a field only exists in one artifact type.
2. **Normalised (ECS)** — `@timestamp`, `event.category`, `event.action`, `event.outcome`, `host.name`, `user.name`, `process.name`, `process.pid`, `process.parent.pid`, `process.command_line`, `file.path`, `file.hash.sha256`, `source.ip`, `destination.ip`, plus `remora.artifact_kind` and `remora.ingested_file_id` for provenance.

ECS is a published schema, independent of Elasticsearch. Adopting it costs a
mapping per parser and delivers what actually matters: **cross-artifact
correlation and a real super-timeline**, where a Shimcache entry, a Sysmon
process creation and a Prefetch execution sit on one sortable axis.

The Explorer gains a second mode — *unified view* — alongside the existing
per-artifact view.

## 11. `ArtifactStore`

All Explorer queries go through one interface:

```python
class ArtifactStore(Protocol):
    def schema(self, artifact_id: str) -> list[Column]: ...
    def search(self, artifact_id: str, query: Query, page: Page) -> ResultSet: ...
    def aggregate(self, artifact_id: str, spec: AggSpec) -> list[Bucket]: ...
    def get_by_id(self, artifact_id: str, row_id: str) -> dict: ...
```

`DuckDBArtifactStore` is the implementation. No router imports `duckdb`.

This is what keeps the Elasticsearch/OpenSearch question open: with the
interface and the ECS schema in place, that backend becomes an additional
implementation rather than a rewrite. Without them, any such migration means
rebuilding the RQL parser, the column detection and the pinning integration
from scratch.

---

## 12. Parser execution sandbox (S16)

The Eric Zimmerman tools run on .NET 9 on Linux, which is what makes native
Windows-artifact parsing possible here. It also means Remora will execute code
against attacker-controlled input. That question **will** be asked publicly, so
the answer is designed in rather than retrofitted:

- Dedicated non-root user; no write access outside the per-run scratch directory.
- **No network namespace access.** A parser has no reason to reach the network.
- Wall-clock timeout per invocation; the process group is killed on expiry.
- Output size quota; exceeding it fails the run rather than filling the disk.
- Memory limit via cgroup.
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
