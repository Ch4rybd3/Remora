---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
Linked: "[[DFIR]]"
---
# Table of content

| Artifact Name             | What is it                                  | Why it's useful                               | Tools commonly used         |
| ------------------------- | ------------------------------------------- | --------------------------------------------- | --------------------------- |
| [[RecentApps]]            | Registry-based log of recently used apps    | Tracks user application usage                 | RegRipper, RECmd            |
| [[RecentDocs]]            | Tracks documents recently opened            | Identifies user-accessed files                | Registry Explorer, RECmd    |
| [[Jump Lists]]            | App-specific recent file lists              | Contextual app usage history                  | JLECmd, Forensic Browser    |
| [[LNK Files]]             | Shortcut files referencing opened items     | Persistence of file access traces             | LECmd, ShellBags Explorer   |
| [[UserAssist]]            | GUI app usage via Start menu or Explorer    | Indicates real user activity                  | UserAssistView, RECmd       |
| [[Prefetch]]              | Binary execution logs for performance boost | Strong execution proof                        | PECmd, Windows Explorer     |
| [[AmCache]]               | Registry hive tracking executed binaries    | Detects executed or deleted apps              | AmCacheParser, RECmd        |
| [[App Compat Cache]]      | ShimCache storing executed file metadata    | Complements prefetch/app execution            | AppCompatCacheParser        |
| [[Shellbags]]             | Tracks folder views in Explorer             | Reveals file system exploration               | ShellBags Explorer, SBECmd  |
| [[PowerShell History]]    | PSReadline command history file             | Reveals commands and scripts run              | PowerShell, Notepad++       |
| [[Office Recent Files]]   | Office MRU list of opened docs              | Points to recent office file use              | OfficeMRUView, FTK          |
| [[Windows Event logs]]    | System event logs for execution/security    | Logs logons, tasks, errors, etc.              | Event Viewer, LogParser     |
| [[$MFT]]                  | NTFS master table with all file metadata    | File activity and timeline source             | MFTECmd, Autopsy            |
| [[UsnJrnl]]               | NTFS journal of file change events          | Timeline reconstruction, file deletion traces | MFTECmd, SleuthKit          |
| [[Volume Shadow Copies]]  | System snapshots at various times           | Recovery of deleted/past files                | vssadmin, ShadowExplorer    |
| [[Web - History]]         | Browsing history from user profiles         | Internet activity analysis                    | Browser History Capturer    |
| [[Web - Cookies]]         | Stored web session and login info           | Useful for account usage/identity             | Nirsoft tools, FTK          |
| [[Web - Cache]]           | Cached images and files from web activity   | Reveals page views/content                    | Nirsoft tools, FTK          |
| [[Network port listing]]  | Snapshot of open/listening ports            | Detects potential backdoors                   | netstat, TCPView            |
| [[001 - Knowledge Base/DFIR/Process]]               | List of running processes                   | Detects suspicious runtime behavior           | tasklist, Process Explorer  |
| [[Process Dump]]          | Memory snapshot of a process                | Malware analysis and string extraction        | ProcDump, Volatility        |
| [[Complete Memory Dump]]  | Full RAM capture during crash               | Complete volatile memory state                | WinDbg, Volatility          |
| [[Drivers Listing]]       | Loaded driver list                          | Detects rootkits, hidden kernel modules       | DriverView, OSForensics     |
| [[Services]]              | Registered Windows services                 | Common persistence vector                     | sc.exe, Autoruns            |
| [[Scheduled Tasks]]       | Automated and triggered tasks               | Persistence and lateral movement detection    | TaskSchedulerView, Autoruns |
| [[File System Listing]]   | List of files with paths/timestamps         | Baseline comparison, anomaly detection        | FTK Imager, Autopsy         |
| [[Groups Listing]]        | Local group membership info                 | Escalation of privilege trace                 | net localgroup, SAM parser  |
| [[Users Listing]]         | Local user accounts                         | User enumeration for context                  | net user, SAM parser        |
| [[Environment Variables]] | User/system environment settings            | Explains behavior of scripts or payloads      | set, RECmd                  |

