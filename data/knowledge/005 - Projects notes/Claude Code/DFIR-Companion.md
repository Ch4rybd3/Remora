Project Specification: 
1. Core Objective
		Purpose: A DFIR-Oriented EDR platform similar to velociraptor where you can deploy new agents on the fly and have the ability to manage them through a management console hosted on a server. The idea is to onboard forensics utilities for collecting, parsing, monitoring, ... and also have remediation capabilities
    Target Users: DFIR Analysts

2. Tech Stack
    Language: Python
	Need a web server with auth/login, roles, ...

3. Functional Requirements
- Ability to generate agents packages for Linux and Windows
- Ability to collect forensic artifacts using KAPE/UAC
- Ability to remediate using quarantine (should not quarantine from the console, but from all the rest)
- Ability to remediate using modules (delete file, delete registry, schedule tasks, ...) so I can add new remediation features later
- Have a searchfunction, like in ElasticSearch or VQL or else.
- 