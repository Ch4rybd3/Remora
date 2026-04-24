---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
Linked: "[[DFIR]]"
---

| [[EventID - Titre de l'événement]]                     | Description                                                                                | Source                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------- |
| [[4624 - Logon réussi]]                                | Connexion réussie d’un utilisateur. Important pour surveiller les comptes utilisés.        | [[Security]]                 |
| [[4625 - Échec de connexion]]                          | Tentative de connexion échouée, utile pour détecter du brute-force ou tentative suspecte.  | [[Security]]                 |
| [[4634 - Déconnexion]]                                 | Déconnexion d’une session, souvent couplé avec 4624 pour tracer une session.               | [[Security]]                 |
| [[4648 - Connexion avec des identifiants explicites]]  | Connexion via des identifiants fournis manuellement (ex: `runas`, accès à distance).       | [[Security]]                 |
| [[4672 - Droits spéciaux assignés à un nouveau logon]] | Utilisateur avec privilèges admin ou droits élevés.                                        | [[Security]]                 |
| [[4688 - Création d’un nouveau processus]]             | Surveillance des programmes exécutés. Très utile pour détecter des exécutions suspectes.   | [[Security]]                 |
| [[4689 - Fin de processus]]                            | Processus terminé. Peut aider à comprendre la durée de vie d’un processus malicieux.       | [[Security]]                 |
| [[4697 - Installation de service]]                     | Un service a été installé. Fréquemment utilisé pour la persistance.                        | [[Security]]                 |
| [[4700 - Activation de tâche planifiée]]               | Surveillance de l’activation d’une tâche planifiée.                                        | [[Security]]                 |
| [[4702 - Modification d’une tâche planifiée]]          | Modification possible d’un mécanisme de persistance.                                       | [[Security]]                 |
| [[4719 - Changement de politique d’audit]]             | Modification des règles d’audit – indicateur d’évasion possible.                           | [[Security]]                 |
| [[4720 - Création de compte utilisateur]]              | Nouveau compte local ou domaine – souvent utilisé en post-exploitation.                    | [[Security]]                 |
| [[4722 - Activation de compte utilisateur]]            | Un compte désactivé a été réactivé.                                                        | [[Security]]                 |
| [[4723 - Tentative de changement de mot de passe]]     | Un utilisateur tente de modifier son mot de passe – peut indiquer une compromission.       | [[Security]]                 |
| [[4724 - Réinitialisation de mot de passe]]            | Quelqu’un change le mot de passe d’un autre utilisateur – souvent un compte admin.         | [[Security]]                 |
| [[4725 - Désactivation de compte utilisateur]]         | Un compte est désactivé – peut indiquer une réponse ou attaque.                            | [[Security]]                 |
| [[4726 - Suppression de compte utilisateur]]           | Supprime un compte – important en cas de mouvements latéraux ou d'effacement de traces.    | [[Security]]                 |
| [[4732 - Ajout à un groupe privilégié]]                | Un utilisateur est ajouté à un groupe sensible (ex: Administrateurs).                      | [[Security]]                 |
| [[4756 - Ajout à un groupe local]]                     | Ajout dans un groupe local. Utile pour détecter des élévations de privilèges.              | [[Security]]                 |
| [[4768 - TGT Kerberos demandé]]                        | Requête TGT (Ticket Granting Ticket) – début d'une session Kerberos.                       | [[Security]] ([[Kerberos]])  |
| [[4769 - Service Ticket Kerberos demandé]]             | Requête pour un ticket de service – peut révéler du "Kerberoasting".                       | [[Security]] ([[Kerberos]])  |
| [[4771 - Échec d’authentification Kerberos]]           | Tentative échouée – intéressant pour repérer du bruteforce Kerberos.                       | [[Security]] ([[Kerberos]])  |
| [[4776 - Tentative d’authentification NTLM]]           | Tentative de connexion via NTLM. Indice de mouvement latéral ou attaque.                   | [[Security]]                 |
| [[5140 - Accès à un partage réseau]]                   | Accès à un partage de fichiers – souvent observé lors d’un exfiltration ou reconnaissance. | [[Security]]                 |
| [[5145 - Détail d’accès à un fichier partagé]]         | Informations détaillées sur fichiers accédés via partage.                                  | [[Security]]                 |
| [[7045 - Service installé (EventSystem)]]              | Installation de service via SCM – autre point de persistance ou d’élévation de privilèges. | [[System]]                   |
| [[1000 - Crash d’application (App Error)]]             | Application plantée – peut être lié à une attaque ou à un comportement anormal.            | [[Application]]              |
| [[1001 - Rapport d’erreur Windows]]                    | Crashs avec détails – utile pour analyser comportements d’outils malveillants instables.   | [[Application]]              |
| [[1102 - Log d’audit effacé]]                          | Quelqu’un a effacé les journaux d’audit – fort indicateur de compromission.                | [[Security]]                 |
| [[4104 - Exécution de script PowerShell (logging)]]    | Exécution d’un script via PowerShell avec transcription.                                   | [[PowerShell]] (Operational) |
| [[4103 - Chargement de module PowerShell]]             | Module PowerShell chargé – utile pour détecter l’usage d’outils offensifs.                 | [[PowerShell]] (Operational) |
| [[1 - Processus créé (Sysmon)]]                        | Création de processus via Sysmon – très riche en détails, complémentaire au 4688.          | [[Sysmon]]                   |
| [[2 - Chargement de module (DLL)]]                     | DLL chargée dans un processus – permet de détecter des injections ou DLLs suspectes.       | [[Sysmon]]                   |
| [[3 - Connexion réseau établie]]                       | Connexion réseau sortante – très utile pour repérer les C2 ou exfiltrations.               | [[Sysmon]]                   |
| [[5 - Altération de fichier]]                          | Modification de fichier – détecte remplacement binaire ou infection de fichiers légitimes. | [[Sysmon]]                   |
| [[6 - Chargement de driver]]                           | Un driver (.sys) est chargé – indicateur de rootkit ou attaque kernel-mode.                | [[Sysmon]]                   |
| [[7 - Création de fichier]]                            | Un nouveau fichier a été écrit – utile pour détecter les payloads, droppers ou logs.       | [[Sysmon]]                   |
| [[8 - Flux alternatif (ADS) créé]]                     | Utilisation d’Alternate Data Stream – peut cacher du code ou des données.                  | [[Sysmon]]                   |
| [[11 - Modification de fichier]]                       | Fichier modifié – utile pour observer un ransomware ou tampering d’appli.                  | [[Sysmon]]                   |
| [[12 - Connexion au registre]]                         | Un processus accède au registre – bon pour détecter des accès persistants.                 | [[Sysmon]]                   |
| [[13 - Modification de registre]]                      | Une valeur de registre est modifiée – indicateur fort de persistance ou sabotage.          | [[Sysmon]]                   |
| [[22 - Injection de code détectée]]                    | Un processus injecte du code dans un autre – indicateur direct de comportement offensif.   | [[Sysmon]]                   |
| [[23 - Thread distant créé]]                           | Création d’un thread dans un autre processus – utilisé dans les injections (e.g., Cobalt). | [[Sysmon]]                   |
| [[24 - Hook de fenêtre détecté]]                       | Tentative de capturer l’UI ou les entrées clavier – utilisé par les keyloggers.            | [[Sysmon]]                   |
| [[25 - Process Hollowing détecté]]                     | Exécution dans un processus "vidé" – typique des techniques d’évasion.                     | [[Sysmon]]                   |
| [[7034 - Service stoppé de manière inattendue]]        | Service crashé ou tué – utile pour identifier des sabotages ou erreurs provoquées.         | [[System]]                   |
| [[7036 - État d’un service modifié]]                   | Le statut d’un service a changé (démarré/arrêté) – à croiser avec d’autres événements.     | [[System]]                   |
