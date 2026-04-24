---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags:
  - DFIR
  - Process
Linked: "[[DFIR]]"
---
# Déclenchement
## Réception de la demande d'assistance
- Appel, Mail, Portail dédié
- Identifier un Point de contact (POC) technique et surtout, décisionnaire
## Collecte des informations utiles
- Type d'incident suspecté
- Contexte
- Date/Heure de détection
- Premiers indices
- Impact métier
- Latéralisation
- Arrêt de production
- Fuite de donnée
- Contact de la part de l'attaquant
- ...
## Signature des documents d'accord d'interventions
- Accord de services
- NDA
- Périmètre légal validé avant toute action
## Définition du niveau de criticité
- Utilisation des informations utiles pour définir un niveau de criticité
## Checklist pré intervention
- Accès a l'entreprise (VPN, Physique, ...)
- Contact IT identifié
- Autorisations d'accès
- Plan d'intervention
# Contenir
## Sécurisation des accès
- Isolation du réseau des machines impactés
- Réinitialisation des comptes a risques (rotation des credentials)
## Déploiement d'outils
- Déploiement d'outils pour contenir
	- Velociraptor
	- EDR existant
	- ...
- Déploiement d'outils de collecte
	- KAPE
	- Velociraptor
	- ...
- Mise en place de règles temporaires
	- Segmentation
	- Blocage d'accès a Internet
	- ...
## Collecte et préservation de preuves
- Imagerie de disques
	- FTK Imager
	- dd
	- writeblock
- Exportation des journaux concernés (EVTX, Firewall, Proxy, VPN, AD, ...)
- Hash et Timestamp
	- S'assurer de l'intégrité de 
