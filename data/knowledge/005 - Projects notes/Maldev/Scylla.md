# Contexte
Scylla est un C2 développé par Ch4rybd3.
Développé a but éducatif, il a pour objectif de récupérer les requêtes effectuer par les différents malwares, peu importe leurs payloads, configuration, langage ou méthode.
Les mots clés sont : modulable | configurable | stable

# Fonctionnalités
- [ ] Avoir un listener
- [ ] Avoir la possibilité de changer le port du listener a chaud (via call API ou interface web d'admin)
- [ ] Être lancé en tant que service
- [ ] Posséder une interface d'administration caché derrière un login (serveur Flask pour utiliser des blueprints)
- [ ] Pouvoir visualiser les rapports des machines infectés sous plusieurs formes (dans une table DB ou via une fiche info d'une machine)
- [ ] Disposer d'une BDD pour stocker les résultats des requêtes (Postgre = choix favoris)
- [ ] Pouvoir modifier les valeurs de la BDD via l'interface WEB/Clear les résultats d'une session de CTF, ... à chaud
- [ ] Avoir plusieurs fichier de configuration : 
	- [ ] auth_map.yaml : pour identifier des requêtes et les associer avec les bonnes tables
	- [ ] config.yaml
	- [ ] env.yml
- [ ] Utiliser Docker-compose pour déployer Scylla facilement.
- [ ] Faire évoluer le C2 plus tard avec des options pour envoyer des commandes et le rendre bidirectionnel : 
	- [ ] Faire en sorte que le malware lance des requêtes vers le C2 a intervalle régulière (ou presque pour ne pas être flag trop facilement)
	- [ ] Si le C2 ne répond pas, alors rien
	- [ ] Depuis la fiche info d'un endpoint, on entrer une commande a exécuter sur le endpoint et attendre qu'il vienne chercher la requête
	- [ ] Si le C2 répond avec un json, prendre la valeur de la clé "cmd" et l'éxecuter sur le poste, puis envoyer les résultats au C2 sur un l'URL contenu dans la clé "endpoint"
	- [ ] Cette valeur sera alors disponible dans la fiche info du endpoint