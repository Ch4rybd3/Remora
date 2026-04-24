---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
  - Registry
Linked: "[[Artefacts]]"
---
# Context
Indicate the folders that have been opened using the explorer (manual user interaction) and help determining the user navigation
# Usage
Can indicate what the user have interacted with, even if the file or folders aren't present anymore
# Tools
- 
# Example
```json
{
    "registry.createdAt": "2025-04-14T11:38:46.000Z",
    "registry.hivePath": "C:\\Users\\florian.salingue-ext\\AppData\\Local\\Microsoft\\Windows\\UsrClass.dat",
    "registry.keyPath": "HKEY_USERS\\S-1-5-21-12599182-4199635625-2060995721-334121\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\BagMRU\\3\\0\\5\\3\\3",
    "registry.lastAccessed": "2025-04-14T12:59:26.000Z",
    "registry.modifiedAt": "2025-04-14T13:10:45.054Z",
    "registry.valueName": "0",
    "shellBag.attributes": "Directory",
    "shellBag.firstInteracted": "2025-04-14T13:10:45.054Z",
    "shellBag.lastInteracted": "2025-04-14T13:10:45.054Z",
    "shellBag.valueType": "Folder",
    "shellBag.version": 9,
    "tgt.file.path": "C:\\Scripts\\IrisModules\\iris_getSentinelOneThreats\\response_script",
    "user.name": "AD\\florian.salingue-ext",
    "user.sid": "S-1-5-21-12599182-4199635625-2060995721-334121"
}
```