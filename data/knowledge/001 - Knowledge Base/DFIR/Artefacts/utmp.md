---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - Linux
  - Log
Linked: "[[DFIR]]"
---
# Context
The UTMP files are located in `/run/utmp`.
They are used to store current login sessions and system status.
# Usage
You can use them to determine who is logged in at the time of the acquisition.
You have details such as usernames, terminal, login time and host.
# Tools
- last -f $filename
# Example
```json

```
