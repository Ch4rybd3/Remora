---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
Linked: "[[Artefacts]]"
---
# Context
The Master File Table ($MFT) contains informations on all the files and folders on the system and is one of the key composant of the NTFS file system
Files starting with a $ are metafiles, containing metadata about data
# Usage
Helps recreate the timeline of what happened on the system, containing all the name, size, access date, ...
# Tools
- [MFTECmd](https://github.com/EricZimmerman/MFTECmd) : Parse the MFT table, made by Eric Zimmerman, huge reference when it comes to DFIR
# Example
```json

```