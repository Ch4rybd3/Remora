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

Consequences:
- No single answer to *"what has been ingested into this case?"*.
- No cross-cutting duplicate detection.
- Format support varies by entry point: an EVTX accepted by one endpoint is rejected by another.
- Parsing logic lives in routers, so it cannot be reused or tested.
- No record of the timezone the artifact was exported in — an ambiguity that is unrecoverable once the file is on disk.

## 2. The principle

**One ingestion path: the drop folder.** Everything else is a thin wrapper.

```
                          ┌──────────────────────────┐
  browser upload ────────►│                          │
  drop folder (host copy) │  <dropzone>/<case>/      │──► ingest service ──► routing
  connector / API ───────►│                          │
                          └──────────────────────────┘
```

Upload endpoints write the bytes into the case drop folder and return `202`.
They contain no parsing, no storage decision, no hashing. Identification and
routing happen in exactly one place, which means they are testable in exactly
one place.

---

## 3. Layout

```
<dropzone>/
  acme-ransomware-4f3a9b21/       one folder per case (slug + short id)
    <files dropped here>
    evtx/  registry/  memory/     optional type hints (see §6)
    .processed/                   ingested originals, moved never deleted
    .failed/                      files that could not be ingested, with a .error sidecar
  _inbox/                         case-less drops, assigned from the UI
```

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
| `origin` | `dropzone` \| `upload` \| `archive` \| `connector` |
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
2. Backfill `ingested_files` from existing `ImportedCollection` / `ImportedFile` rows and from files already on disk (hash and identify in a background job).
3. Convert upload endpoints to wrappers, one module per PR.
4. Remove the dead parsing code from routers.
5. Convert stored CSV to Parquet lazily, on first access.

No step requires downtime, and each is independently revertible.
