# Project Specification: Remora
1. Core Objective
Purpose: A DFIR-IRIS like application that will help an analyst reporting an incident through an LLM where you give him informations through a chat and it will populate the case (IOC, Evidences, Notes, ...) as you give him informations.
You can then export a .md or a .docx that will be structured following a precise template with a really formal and legal way, just like how an forensic legal expert would make it.
Target Users: SOC Analysts | DFIR Analysts

2. Tech Stack
Language: Python
Color Scheme: HTB inspired, using white for text, #9FEF00 for headings, #0B121F for background and #A3B3BC for accents

3. Functional Requirements
Auth/Security: Login page, roles, admin panel
Features :
Case management (Executive Summary, Notes, IOC, Assets, Timeline)
Case templates, to structure the case at it's creation
Data store, to store and archive evidences (such as logs, malicious content, ...) + automatic computing of SHA256 when an file is uploaded + Integrated Chain of Custody
Auto-reporting using external templates (.md and .docx)
A conversational chat interface to give data to a local LLM in natural language and it will integrate the data to the report
A dashboard, showing data related to IOCs, Assets, Cases, ...
A playbook page, which contains playbooks graphs that are interactive and can be created using templates
The playbook page being integrated in a tab in the case and act like a checklist so every analyst can see at what step of the playbook we are, what path we choose, what decision we took, ...
A page that process IOCs with a multiple of modules for defanging URLs, testing them against platforms such as virustotal, crt.sh, OpenCTI, ...
CVSS calculator for incident severity
Correlation other cases based on the IOCs and Assets
Diff between 2 reports versions to validate changes (version history)
Automatic MITRE ATT&CK mapping based on the report content 


---

Project Name: Remora
Purpose: A DFIR-IRIS alternative where you can create cases based on templates, the cases contains multiple tabs to document a Cybersecurity Incident for DFIR purposes.
There will be an auto-reporting feature that allow an analyst to populate the case and report it without the trouble of writing the report.
The design should be modular as there will be a lot of feature that will be added incrementally (Like a dynamic playbook  graph page, a page to process IOCs, OpenCTI integrations, ...)
The platform should also be though for the long run, later, I plan to add connectors to import alerts from other security platforms such as EDRs, SIEMs, ...

Features for the V1: 
- The case management system, for each case, there will be tabs for the Executive Summary, quick notes, report, IOCs, Assets, Evidences, Timeline
- A data store to store the evidences added to cases
- A case template system where  you can define the structure for the report, the Executive summary, the tags of the case, metadata, ..., it should be in YAML

Tech Stack:
Python, but you should also consider how we can store the data, shoul
Color Scheme: HTB inspired, using white for text, #9FEF00 for headings, #0B121F for background and #A3B3BC for accents


---

Remarque de Yohan
export CSV
audibilité des actions admin
