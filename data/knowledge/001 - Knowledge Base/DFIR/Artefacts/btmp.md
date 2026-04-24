---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - Linux
  - Log
Linked: "[[DFIR]]"
---
# Context
The WTMP files are located in `/var/log/btmp`.
They are used to store failed login attempts.
# Usage
Useful to identify brute-force attacks or suspicious login behavior. It includes the failed username, originating IP (if remote), and the time of the attempt.
# Tools
- last -f $filename
# Example
```json

```
