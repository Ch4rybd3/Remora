---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - Linux
  - Log
Linked: "[[DFIR]]"
---
# Context
The WTMP files are located in `/var/log/wtmp`.
They are used to store persistent log of all login and logout events.
# Usage
Crucial for establishing a timeline of user activity. Investigators use it to trace who accessed the system, from where, and when. This includes system boot and shutdown times.
# Tools
- last -f $filename
# Example
```json

```

![[{3815171A-A378-438F-90EC-E9D6C7A27ACF}.png]]