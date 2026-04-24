# Perte d'auditabilité
### Problème
Perte d'auditabilité, on perd les infos de qui a créer un dossier, et donc sur les dossiers un peu perdu, avec peu de mouvement, on peut perdre l'info de a quoi il servait
### Solution
Le script qui va procéder au lissage des droits devrait également intégrer des fonctions de logging, afin de garder un fichier de log contenant les informations dans le cas ou quelqu'un viendrait nous demander suite au changement a qui appartenait tel dossier, ...

# Least Privilege
### Problème
Pas très least priviledge friendly, si un owner se retrouve attribué avec de trop nombreux dossiers dont il n'a pas forcément besoin ou autre, on risque de créer un compte a risque avec des droits trop gros
### Solution
On devrait lister les répertoires qui subirons ce changement au travers d'un script "passif" ou des requêtes précises sur Varonis si possible afin de déterminer les users qui vont se voir attribuer des dossiers, si des users sortent du lot avec un nombre gargantuesque d'attribution, alors il faudra voir pour les surveiller avec une attention particulière (or else). On pourrait également regarder pour attribuer des groupes à la place, ce qui serait un peu plus résistant au turnover de l'entreprise

# RGPD
### Problème
Sur la conservation de fichier sensibles, le fait de les attribuer a quelqu'un qui ne connait pas leurs contenu n'est pas très RGPD
### Solution
Il faudrait peut-être notifier les utilisateurs, cela peut être fait avec le script, afin de générer des CSV des dossiers, ..., ainsi, les utilisateurs qui se voient attribuer des dossiers sont au courant que ces dossiers leurs appartiennent, mais peut-être un peu plus touchy

# ACL
### Problème
Risque sur les ACL a déterminer
### Solution
Il faudra faire un audit des ACL avant et après, voir si des éléments bizarre sont arrivés, voir pour scripter la vérification/diff

# Dry-run
### Problème
Le script qui va tourner pourrait casser des trucs, mal fonctionner, etc
### Solution
Il faudrait en faire une version pour faire un dry-run, ainsi, on réduit le risque d'erreur quand on le lancera pour de vrai
