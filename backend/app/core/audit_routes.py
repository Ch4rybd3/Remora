"""
Which action each mutating route records in the audit trail.

The trail was written one call site at a time, and it showed: 68 of 124
mutating routes wrote an entry and 56 did not, including the whole ingestion
path. Nothing said which - answering it meant grepping, and a route added
tomorrow would be missing from the trail with nobody the wiser.

This table is the answer, and `test_audit_coverage.py` is what keeps it true:

* every mutating route is declared here or exempted with a reason - a new route
  fails CI until somebody decides which;
* every declared route's handler actually calls `audit_log`, checked against
  the handler's source, so "declared" cannot drift from "implemented";
* `PENDING` is a ratchet, like the mypy one in `pyproject.toml`. A route may
  leave it. Nothing may ever be added.

Actions are `<domain>.<verb>`, lower case, dotted. The domain is the thing
acted on rather than the router that happens to serve it, so a reader filtering
the Audit page for `evidence.` sees every way evidence was touched.
"""
from __future__ import annotations

#: (method, route template) to audit action. One entry per mutating route.
ACTIONS: dict[tuple[str, str], str] = {
    # ── Cases ────────────────────────────────────────────────────────────────
    ("POST",   "/api/v1/cases/"):                          "case.create",
    ("PATCH",  "/api/v1/cases/{case_id}"):                 "case.update",
    ("DELETE", "/api/v1/cases/{case_id}"):                 "case.delete",
    ("POST",   "/api/v1/cases/{case_id}/notes/images"):    "case.note_image_upload",
    ("POST",   "/api/v1/cases/{case_id}/report/save"):     "report.save",

    # ── Case content ─────────────────────────────────────────────────────────
    ("POST",   "/api/v1/cases/{case_id}/iocs/"):                      "ioc.create",
    ("PATCH",  "/api/v1/cases/{case_id}/iocs/{ioc_id}"):              "ioc.update",
    ("DELETE", "/api/v1/cases/{case_id}/iocs/{ioc_id}"):              "ioc.delete",
    ("POST",   "/api/v1/cases/{case_id}/assets/"):                    "asset.create",
    ("PATCH",  "/api/v1/cases/{case_id}/assets/{asset_id}"):          "asset.update",
    ("DELETE", "/api/v1/cases/{case_id}/assets/{asset_id}"):          "asset.delete",
    ("POST",   "/api/v1/cases/{case_id}/timeline/"):                  "timeline.create",
    ("PATCH",  "/api/v1/cases/{case_id}/timeline/{event_id}"):        "timeline.update",
    ("DELETE", "/api/v1/cases/{case_id}/timeline/{event_id}"):        "timeline.delete",
    ("POST",   "/api/v1/cases/{case_id}/incident-log/"):              "incident_log.create",
    ("PATCH",  "/api/v1/cases/{case_id}/incident-log/{entry_id}"):    "incident_log.update",
    ("DELETE", "/api/v1/cases/{case_id}/incident-log/{entry_id}"):    "incident_log.delete",
    ("PUT",    "/api/v1/cases/{case_id}/attack-graph"):               "attack_graph.save",
    ("PUT",    "/api/v1/cases/{case_id}/attack-graph/snapshot"):      "attack_graph.snapshot",

    # ── MITRE ────────────────────────────────────────────────────────────────
    ("POST",   "/api/v1/cases/{case_id}/ttp"):                        "mitre.add",
    ("PUT",    "/api/v1/cases/{case_id}/ttp/{ttp_id}"):               "mitre.update",
    ("DELETE", "/api/v1/cases/{case_id}/ttp/{ttp_id}"):               "mitre.delete",
    ("DELETE", "/api/v1/cases/{case_id}/ttp/by-tech/{technique_id}"): "mitre.delete",
    ("POST",   "/api/v1/cases/{case_id}/ttp/import-layer"):           "mitre.import_layer",
    ("POST",   "/api/v1/mitre/download"):                             "mitre.dataset_download",
    ("DELETE", "/api/v1/mitre/cache"):                                "mitre.cache_reset",

    # ── Evidence and custody ─────────────────────────────────────────────────
    ("POST",   "/api/v1/cases/{case_id}/evidences/"):                 "evidence.upload",
    ("PATCH",  "/api/v1/cases/{case_id}/evidences/{evidence_id}"):    "evidence.update",
    ("DELETE", "/api/v1/cases/{case_id}/evidences/{evidence_id}"):    "evidence.delete",
    ("POST",   "/api/v1/cases/{case_id}/custody"):                    "custody.promote",
    ("DELETE", "/api/v1/cases/{case_id}/custody/{evidence_id}"):      "custody.withdraw",

    # ── Ingestion ────────────────────────────────────────────────────────────
    # The door every artifact comes through, and the group that had no trail at
    # all. What entered a case, when, and who let it in is the first question a
    # dispute about evidence asks.
    ("POST",   "/api/v1/cases/{case_id}/ingest/uploads"):             "ingest.upload",
    ("POST",   "/api/v1/cases/{case_id}/ingest/{file_id}/force-kind"): "ingest.force_kind",
    ("POST",   "/api/v1/cases/{case_id}/ingest/{file_id}/memory-os"):  "ingest.set_memory_os",
    ("POST",   "/api/v1/cases/{case_id}/ingest/{file_id}/retry"):      "ingest.retry",
    ("POST",   "/api/v1/cases/{case_id}/dropzone/scan"):              "ingest.scan",
    ("POST",   "/api/v1/dropzone/inbox/assign"):                      "ingest.inbox_assign",
    ("DELETE", "/api/v1/dropzone/inbox/{filename}"):                  "ingest.inbox_delete",
    ("POST",   "/api/v1/cases/{case_id}/collection-imports"):         "collection.import",
    ("DELETE", "/api/v1/cases/{case_id}/collection-imports/{collection_id}"):
        "collection.delete",
    ("PATCH",  "/api/v1/cases/{case_id}/collection-imports/files/{file_id}/evidence"):
        "collection.mark_evidence",
    ("PATCH",  "/api/v1/cases/{case_id}/collection-imports/files/{file_id}/timezone"):
        "collection.set_timezone",

    # ── Artifact Explorer ────────────────────────────────────────────────────
    ("POST",   "/api/v1/cases/{case_id}/artifacts/upload"):           "artifact.upload",
    ("PATCH",  "/api/v1/cases/{case_id}/artifacts/{artifact_id}"):    "artifact.update",
    ("DELETE", "/api/v1/cases/{case_id}/artifacts/{artifact_id}"):    "artifact.delete",
    ("POST",   "/api/v1/cases/{case_id}/artifacts/{artifact_id}/add-evidence"):
        "artifact.promote_to_evidence",
    ("POST",   "/api/v1/cases/{case_id}/artifacts/{artifact_id}/coc-note"):
        "artifact.custody_note",

    # ── Artifact modules ─────────────────────────────────────────────────────
    ("POST",   "/api/v1/evtx/{case_id}/upload"):                      "evtx.upload",
    ("DELETE", "/api/v1/evtx/{case_id}/files/{file_id}"):             "evtx.delete",
    ("POST",   "/api/v1/evtx/{case_id}/files/{file_id}/add-evidence"): "evtx.promote_to_evidence",
    ("POST",   "/api/v1/binary/{case_id}/upload"):                    "binary.upload",
    ("DELETE", "/api/v1/binary/{case_id}/files/{file_id}"):           "binary.delete",
    ("POST",   "/api/v1/binary/{case_id}/files/{file_id}/reanalyse"): "binary.reanalyse",
    ("POST",   "/api/v1/binary/{case_id}/files/{file_id}/add-evidence"):
        "binary.promote_to_evidence",
    ("POST",   "/api/v1/memory/{case_id}/upload"):                    "memory.upload",
    ("DELETE", "/api/v1/memory/{case_id}/dumps/{dump_id}"):           "memory.delete",
    ("POST",   "/api/v1/memory/{case_id}/dumps/{dump_id}/run"):       "memory.run_plugin",
    ("POST",   "/api/v1/memory/{case_id}/dumps/{dump_id}/plugins/{plugin_id}/rerun"):
        "memory.rerun_plugin",
    ("POST",   "/api/v1/cases/{case_id}/disk-images"):                "disk_image.register",
    ("DELETE", "/api/v1/cases/{case_id}/disk-images/{image_id}"):     "disk_image.unregister",
    ("POST",   "/api/v1/cases/{case_id}/disk-images/{image_id}/extract"): "disk_image.extract",
    ("POST",   "/api/v1/cases/{case_id}/emails/upload"):              "email.upload",
    ("DELETE", "/api/v1/cases/{case_id}/emails/{email_id}"):          "email.delete",

    # ── Detection ────────────────────────────────────────────────────────────
    ("POST",   "/api/v1/chainsaw/{case_id}/files/{file_id}/scan"):    "chainsaw.scan",
    ("DELETE", "/api/v1/chainsaw/{case_id}/scans/{scan_id}"):         "chainsaw.delete_scan",
    ("POST",   "/api/v1/chainsaw/{case_id}/alerts/{alert_id}/timeline"):
        "chainsaw.alert_to_timeline",
    ("PUT",    "/api/v1/chainsaw/{case_id}/selection"):               "chainsaw.selection",
    ("POST",   "/api/v1/chainsaw/rules/custom/upload"):               "chainsaw.rules_upload",
    ("DELETE", "/api/v1/chainsaw/rules/custom/{filename}"):           "chainsaw.rules_delete",
    ("POST",   "/api/v1/chainsaw/rules/sigma/download"):              "chainsaw.rules_download",

    # ── Reporting ────────────────────────────────────────────────────────────
    # Generating a report is a read of the case and a *write* to the outside
    # world: it is the moment case data leaves the platform in a form that goes
    # to a client. That is exactly what a trail is for.
    ("POST",   "/api/v1/report-doc-templates/upload"):                "report_template.upload",
    ("DELETE", "/api/v1/report-doc-templates/{template_id}"):         "report_template.delete",
    ("POST",   "/api/v1/report-doc-templates/{template_id}/generate/{case_id}"):
        "report.generate",

    # ── Configuration ────────────────────────────────────────────────────────
    ("POST",   "/api/v1/templates/"):                                 "case_template.create",
    ("PUT",    "/api/v1/templates/{template_id}"):                    "case_template.update",
    ("PUT",    "/api/v1/templates/{template_id}/ttps"):               "case_template.update_ttps",
    ("DELETE", "/api/v1/templates/{template_id}"):                    "case_template.delete",
    ("POST",   "/api/v1/playbooks"):                                  "playbook.create",
    ("PUT",    "/api/v1/playbooks/{pb_id}"):                          "playbook.update",
    ("DELETE", "/api/v1/playbooks/{pb_id}"):                          "playbook.delete",
    ("POST",   "/api/v1/cases/{case_id}/playbooks"):                  "playbook.attach",
    ("DELETE", "/api/v1/cases/{case_id}/playbooks/{cp_id}"):          "playbook.detach",
    ("PATCH",  "/api/v1/cases/{case_id}/playbooks/{cp_id}/steps/{node_id}"): "playbook.step_update",
    ("PATCH",  "/api/v1/cases/{case_id}/playbooks/{cp_id}/steps/{node_id}/assignee"):
        "playbook.step_assign",
    ("PUT",    "/api/v1/connectors/{name}"):                          "connector.configure",
    ("DELETE", "/api/v1/connectors/{name}/key"):                      "connector.clear_key",

    # ── Clients ──────────────────────────────────────────────────────────────
    ("POST",   "/api/v1/clients/"):                                   "client.create",
    ("PATCH",  "/api/v1/clients/{client_id}"):                        "client.update",
    ("DELETE", "/api/v1/clients/{client_id}"):                        "client.delete",
    ("POST",   "/api/v1/clients/{client_id}/documents/upload"):       "client.document.upload",
    ("PATCH",  "/api/v1/clients/{client_id}/documents/{doc_id}"):     "client.document.update",
    ("DELETE", "/api/v1/clients/{client_id}/documents/{doc_id}"):     "client.document.delete",
    ("POST",   "/api/v1/clients/doc-templates"):                      "client.template.create",
    ("PATCH",  "/api/v1/clients/doc-templates/{template_id}"):        "client.template.update",
    ("DELETE", "/api/v1/clients/doc-templates/{template_id}"):        "client.template.delete",

    # ── Knowledge base ───────────────────────────────────────────────────────
    ("POST",   "/api/v1/knowledge/file"):                             "knowledge.create",
    ("PUT",    "/api/v1/knowledge/file"):                             "knowledge.save",
    ("DELETE", "/api/v1/knowledge/file"):                             "knowledge.delete",
    ("POST",   "/api/v1/knowledge/folder"):                           "knowledge.create_folder",
    ("POST",   "/api/v1/knowledge/rename"):                           "knowledge.rename",
    ("POST",   "/api/v1/knowledge/images"):                           "knowledge.image_upload",
    ("POST",   "/api/v1/knowledge/import"):                           "knowledge.vault_import",


    # ── Accounts ─────────────────────────────────────────────────────────────
    ("POST",   "/api/v1/users/"):                                     "user.create",
    ("PATCH",  "/api/v1/users/{user_id}"):                            "user.update",
    ("DELETE", "/api/v1/users/{user_id}"):                            "user.delete",
    ("PUT",    "/api/v1/users/{user_id}/clients"):                    "user.set_clients",
    ("POST",   "/api/v1/users/{user_id}/password"):                   "user.password_change",
    ("POST",   "/api/v1/auth/login"):                                 "auth.login",
    ("POST",   "/api/v1/auth/mfa/setup"):                             "auth.mfa.setup_started",
    ("POST",   "/api/v1/auth/mfa/confirm"):                           "auth.mfa.enabled",
    ("POST",   "/api/v1/auth/mfa/disable"):                           "auth.mfa.disabled",
    ("POST",   "/api/v1/auth/mfa/verify"):                            "auth.login.mfa",
    ("POST",   "/api/v1/auth/mfa/recovery-codes"):
        "auth.mfa.recovery_codes_reissued",
}


#: Mutating routes that write nothing and therefore have nothing to record,
#: each saying why. A POST is not a write - several of these are queries whose
#: input is too large or too structured for a query string.
EXEMPT: dict[tuple[str, str], str] = {
    ("POST", "/api/v1/cti/lookup"): (
        "A read. POST because the indicator is request body rather than a query "
        "string. Nothing in the case changes; the CTI provider's own logs record "
        "that the question was asked."
    ),
    ("POST", "/api/v1/cti/batch"): "The same read, several indicators at once.",
    ("POST", "/api/v1/cti/geo"): (
        "Geolocation of addresses already in the case. A read, and the addresses "
        "were recorded when they were added."
    ),
    ("POST", "/api/v1/cti/command"): (
        "whois and dig against a name. A read, run in a sandbox, changing nothing."
    ),
    ("POST", "/api/v1/connectors/{name}/test"): (
        "A reachability probe against a configured connector. The configuration "
        "it probes was recorded when it was saved."
    ),
    ("POST", "/api/v1/artifacts/email/analyze"): (
        "Stateless analysis of a pasted message. Nothing is stored, so there is "
        "no object an entry could point at. Uploading the same message into a "
        "case is `email.upload`, and that is recorded."
    ),
}


#: Declared, not yet implemented. A ratchet, exactly like the mypy one: a route
#: may be **removed** from this list once its handler records an entry. Nothing
#: may ever be **added** - a new route implements its audit or it does not merge.
#:
#: Everything here predates the registry. The list is what "56 of 124 mutating
#: routes wrote nothing" looks like once the ones that mattered most were done.
PENDING: frozenset[tuple[str, str]] = frozenset({
    ("PUT",    "/api/v1/cases/{case_id}/attack-graph"),
    ("PUT",    "/api/v1/cases/{case_id}/attack-graph/snapshot"),
    ("POST",   "/api/v1/cases/{case_id}/notes/images"),
    ("POST",   "/api/v1/cases/{case_id}/report/save"),
    ("POST",   "/api/v1/cases/{case_id}/ttp"),
    ("PUT",    "/api/v1/cases/{case_id}/ttp/{ttp_id}"),
    ("DELETE", "/api/v1/cases/{case_id}/ttp/{ttp_id}"),
    ("DELETE", "/api/v1/cases/{case_id}/ttp/by-tech/{technique_id}"),
    ("POST",   "/api/v1/cases/{case_id}/ttp/import-layer"),
    ("POST",   "/api/v1/mitre/download"),
    ("DELETE", "/api/v1/mitre/cache"),
    ("POST",   "/api/v1/cases/{case_id}/emails/upload"),
    ("DELETE", "/api/v1/cases/{case_id}/emails/{email_id}"),
    ("POST",   "/api/v1/binary/{case_id}/files/{file_id}/reanalyse"),
    ("POST",   "/api/v1/memory/{case_id}/dumps/{dump_id}/plugins/{plugin_id}/rerun"),
    ("PUT",    "/api/v1/chainsaw/{case_id}/selection"),
    ("POST",   "/api/v1/chainsaw/rules/custom/upload"),
    ("DELETE", "/api/v1/chainsaw/rules/custom/{filename}"),
    ("POST",   "/api/v1/chainsaw/rules/sigma/download"),
    ("POST",   "/api/v1/clients/doc-templates"),
    ("PATCH",  "/api/v1/clients/doc-templates/{template_id}"),
    ("DELETE", "/api/v1/clients/doc-templates/{template_id}"),
    ("PATCH",  "/api/v1/clients/{client_id}/documents/{doc_id}"),
    ("PUT",    "/api/v1/connectors/{name}"),
    ("DELETE", "/api/v1/connectors/{name}/key"),
    ("PUT",    "/api/v1/knowledge/file"),
    ("POST",   "/api/v1/knowledge/images"),
})


def action_for(method: str, template: str) -> str | None:
    return ACTIONS.get((method.upper(), template))


def exemption_for(method: str, template: str) -> str | None:
    return EXEMPT.get((method.upper(), template))


def is_pending(method: str, template: str) -> bool:
    return (method.upper(), template) in PENDING
