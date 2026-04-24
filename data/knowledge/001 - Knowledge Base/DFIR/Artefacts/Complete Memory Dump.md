---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
  - Memory
Linked: "[[Artefacts]]"
---
# Context
A complete RAM dump, contains processes, data, loaded registry keys, ...
# Usage
Can help analysing malwares or other dynamic behavior and their impact on the memory.
For example, you should never shut down a workstation that has been encrypted by a ransomware, as the key can be stored in the RAM and a shutdown would simply erase it definitly
# Tools
- Volatility
# Example
```json

```