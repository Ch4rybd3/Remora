Voici une checklist structurée pour l'acquisition de compétences en Digital Forensics (DFIR), adaptée pour Obsidian.

### 1. Fondamentaux des Systèmes & Réseaux
- [x] **Architecture OS (Windows)**
    - [x] Structure et ruches du Registre (SYSTEM, SOFTWARE, SAM, NTUSER.DAT, USRCLASS.DAT).
    - [x] Mécanismes de persistance (Run Keys, Services, WMI, Scheduled Tasks).
    - [x] Artefacts d'exécution (Prefetch, ShimCache, Amcache, Jump Lists, UserAssist).
    - [x] Systèmes de fichiers : NTFS (MFT, Journal $LogFile, USN Journal) et FAT32/exFAT.
- [ ] **Architecture OS (Linux)**
    - [ ] Analyse des logs (`/var/log/`), `syslog`, `auth.log`, `dmesg`.
    - [ ] Systèmes de fichiers : Ext4 (Inodes, Journaling) et XFS.
    - [ ] Analyse des fichiers de configuration et persistance (Cron, Systemd units, SSH keys).
- [ ] **Réseaux**
    - [ ] Analyse de captures de trafic (PCAP) avec Wireshark/Tshark.
    - [ ] Protocoles critiques : DNS, HTTP/S, SMB, Kerberos, RDP.
    - [ ] Analyse de logs d'équipement (Firewall, Proxy, IDS/IPS).

### 2. Acquisition et Préservation de la Preuve
- [ ] **Mémoire Vive (RAM)**
    - [ ] Techniques d'acquisition (DumpIt, Magnet RAM Capture, AVML).
    - [ ] Analyse avec Volatility 3 (pslist, pstree, netscan, malfind, handles).
    - [ ] Extraction de binaires injectés et détection de rootkits.
- [ ] **Supports de Stockage**
    - [ ] Clonage physique vs Image logique (E01, RAW/DD).
    - [ ] Utilisation de bloqueurs d'écriture (Write Blockers) matériels et logiciels.
    - [ ] Calcul et vérification de hash (MD5, SHA1, SHA256).

### 3. Analyse Forensique Spécialisée
- [ ] **Forensique Navigateur**
    - [ ] Historique, cookies, cache et sessions (Chrome, Firefox, Edge).
    - [ ] Analyse des bases de données SQLite associées.
- [ ] **Forensique Email**
    - [ ] Analyse des headers (SMTP, SPF, DKIM, DMARC).
    - [ ] Extraction d'attachments et analyse de fichiers PST/OST/MBOX.
- [ ] **Timeline Analysis**
    - [ ] Création de super-timelines (Plaso / log2timeline).
    - [ ] Analyse des écarts temporels (Time Skew) et corrélation d'événements.

### 4. Reverse Engineering & Malware Analysis
- [ ] **Analyse Statique**
    - [ ] Identification de fichiers (Strings, Entropy, Import/Export tables).
    - [ ] Utilisation de PEStudio, Capa, Floss.
    - [ ] Désassemblage de base (Ghidra, IDA Pro).
- [ ] **Analyse Dynamique**
    - [ ] Monitoring système (Procmon, Process Hacker, Regshot).
    - [ ] Analyse réseau en sandbox (INetSim, FakeNet-NG).
- [ ] **Déobfuscation**
    - [ ] Décodage de scripts (PowerShell, VBS, JavaScript).
    - [ ] Extraction de payloads de documents Office (Oletools).

### 5. Méthodologie & Reporting
- [ ] **Chaîne de Causalité (Chain of Custody)**
    - [ ] Documentation rigoureuse de chaque étape de manipulation.
- [ ] **Frameworks**
    - [ ] Maîtrise de MITRE ATT&CK pour mapper les techniques adverses.
    - [ ] Application des étapes du NIST SP 800-61 r2.
- [ ] **Outillage de Référence**
    - [ ] Suite Autopsy / Sleuth Kit.
    - [ ] KAPE (Kroll Artifact Parser and Extractor) pour le triage rapide.
    - [ ] Eric Zimmerman's Tools (EZ Tools).

### 6. Cloud & Environnements Modernes
- [ ] **Cloud Forensics**
    - [ ] Analyse de logs AWS (CloudTrail), Azure (Activity Logs) et Google Cloud.
    - [ ] Acquisition d'instances virtuelles et de snapshots de disques cloud.
- [ ] **Docker & Kubernetes**
    - [ ] Analyse de conteneurs éphémères et logs d'orchestration.