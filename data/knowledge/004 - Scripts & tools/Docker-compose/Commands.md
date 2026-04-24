---
Date: <% tp.date.now("Do MMMM YYYY") %>
Template: "[[Documentation - Template]]"
tags: 
Linked: "[[Docker-Compose]]"
---

# Basic commands
```Shell
sudo docker-compose logs -f $appName
```

super, désormais, on va travailler sur un autre gros chantier, la page artifact processing : Filesystem & Logs.
L'idée est d'avoir une page avec 2 tabs, une pour Windows, une pour Linux.
On laisserai la linux vide pour l'instant, concentrons nous sur la partie Windows.
Ce que je souhaite, c'est avoir une partie pour uploader des fichiers EVTX
Les fichiers uploadés seront considérés pour le current case histoire de pouvoir revenir dessus si on quitte l'interface sans avoir a le reuploadé.
Cependant, il ne seera poussé dans les Evidences du case actuel que si on clique sur un +ADD comme pour les IOCs.
Une fois uploadée, ils seront donc parsé avec les outils d'Eric Zimmerman (il me sembler que les .dll fonctionennt sur Linux pour le parsing avec des outils comme EvtxEcmd, ...) et ainsi obtenir des .csv parsé que l'on pourra naviguer dans une autre partie de l'interface, semblable a Timeline Explorer.
Ainsi, le process sera : 
On upload un fichier EVTX
Il est parsé dans le backend
On pourra donc cliquer sur celui-ci ou sur un autre fichier depuis une liste de fichiers uploadés (dans le contexte du current case).
On pourra ensuite naviguer grace a une interface tableur comme Timeline Explorer les différents champs parsés