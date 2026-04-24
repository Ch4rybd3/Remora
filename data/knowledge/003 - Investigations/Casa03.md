---
Date: 2025-04-09
Template: "[[Investigation - Template]]"
tags:
  - DFIR
Investigateur: florian.salingue-ext
---
# Synthèse managériale
Une machine présentait des traces de compromissions.
L'incident nous a été escaladé par l'équipe Vigilance de SentinelOne.
La machine et les utilisateurs sont du domaine casabarbara.com.
La machine semble être une machine de réceptionniste localisé sur Nice.
La machine a été placée en quarantaine a la suite de ces actions.
Un ticket a été créé sur ITcare pour remasteriser le poste.
# Détection
Alerte sur SentinelOne + Escalade de Vigilance
# Collecte
Collecte des artefacts via Forensic Collection (Full)
Nom du endpoint : "Casa03"
Nom de l'utilisateur : "accueil.nice"
Date/heure : May 2 2025 10:45:36 CEST
# Analyse
La machine a tenté de télécharger un WinPEAS depuis Google Chrome
Après une investigation plus poussée, plusieurs éléments sont remontés comme potentiellement malicieux/non propre.

Les logiciels suivants sont considérés comme non propre car pas managés par la DSI et peuvent être utilisés a des fin malicieuses : 
- Teamviewer (Remote Desktop tool)
- SplashTop SOS (Remote Desktop tool)
- Dameware Remote Control (Remote Desktop tool)
- ipscan (Recon)

De plus, l'historique PowerShell de l'utilisateur acceuil.nice ne contient qu'une seule ligne : 
`([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()).DomainControllers`
Cette commande est souvent utilisée dans des contexte de Post-Exploitation pour mapper les DC, mais elle n'est pas spécialement utilisée dans des tâches communes.
Cette commande a été lancée manuellement par l'utilisateur, ce qui est louche.
# Contenir
La machine a été isolé du réseau au vu des éléments relevés en Analyse et de la criticité de ce genre d'alerte
L'utilisateur n'a pas été trouvé dans : 
- L'AD
- EntraID
- IT Korian
Elle existe cependant dans ITcare ce qui laisse sous-entendre que c'est une entité active que nous manageons.
# Eradication
Un ticket a été créé sur ITcare, n'ayant pas trouvé de catégorie qui correspondrait bien pour la remasterisation de poste, je l'ai mis en FR/A qualifier, voici le lien : 
https://itcare.easyvista.com/index.php?eventName=formEvent&target=282207&checksum=baa1034f82080a4a9923b84a0125b913875223be&sender=HelpDesk_IncidentsItem&PHPSESSID=d1724cbad4fb85836cd0ae6cd0875da4&internalurltime=1746196106
et la référence : 
INC2505_00195
Si vous pensez qu'il manque des éléments, qu'il faut l'attribuer différemment ou autre, allez-y

Je demande dedans la remasteriser le poste, je donne les infos nécessaires avec juste assez de contexte pour : 
- Justifier l'utilisation de SentinelOne
- Montrer que l'on a pas quarantine comme des sauvages, mais qu'il y a une justification derrière
# Recouvrir
Pas d'étapes de recovery spécifiques pour le moment
# Leçon apprises
- La collecte Forensic est un super outil pour ces uses cases (historique PowerShell, prefetch, navigation, ...)
- Casabarbara n'est pas directement visible dans notre scope, pourtant il l'est
- Faire une documentation pour la création de tickets sur ITcare avec une liste des uses cases spécifiques comme la remasterisation de postes.
- Il arrive que les collections d'artefact Forensic passent en fail si elles sont trop complètes, il faudrait voir avec SentinelOne pour ceci, je vais créer un ticket pour demander le pourquoi du comment.