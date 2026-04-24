---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
Linked: "[[Artefacts]]"
---
# Context
A prefetch file isn't that useful, it's its presence that is used when investigateting, as it gets created when a user start an application
It consist of the executable name + hash + .pf
Not activated by default on server, but is on windows client
# Usage
- Give informations on executables that were launched on the endpoint
# Tools
- 
# Example
```bash
NET.EXE-61E7A54D.pf
NET1.EXE-1C88A7BA.pf
NETSH.EXE-59756CAC.pf
NGEN.EXE-383F81D5.pf
NGEN.EXE-A8DBB043.pf
NGENTASK.EXE-4DB88ADA.pf
NGENTASK.EXE-CD4E002C.pf
NOTEPAD++.EXE-E7DBD7BD.pf
NOTEPAD.EXE-1630E83C.pf
NOTEPAD.EXE-6421657E.pf
NOTEPAD.EXE-790D3BB2.pf
NOTEPAD.EXE-B39D4A8C.pf
NOTEPAD.EXE-D6CB2A96.pf
OBSIDIAN.EXE-BB8778ED.pf
OBSIDIAN.EXE-BB8778EE.pf
OBSIDIAN.EXE-BB8778EF.pf
OBSIDIAN.EXE-BB8778F7.pf
OBSIDIAN.EXE-BB8778F8.pf
OBSIDIAN.EXE-BB8778FB.pf
```