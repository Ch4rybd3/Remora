## 🧭 **Phase 1 – Bases indispensables**

### 1. **Introduction à Windows & PE**

- Comprendre l'architecture Windows, les formats PE, les processus, les threads.
    
- Modules : _Introduction to Windows OS_, _WinAPIs & PE File Format_, _Parsing PE Headers_.
    

### 2. **Langage & Environnement**

- C fondamentaux, compilation manuelle, MASM.
    
- Modules : _More C fundamentals_, _Introduction to MASM assembly_, _Malware compiling_.
    

### 3. **API Windows & Manipulation**

- Appels directs WinAPI, fonctions personnalisées, manipulation bas niveau.
    
- Modules : _Custom WinAPI functions_, _Thread enumeration via syscall_.
    

---

## 🧩 **Phase 2 – Execution de payloads**

### 4. **Injection & Mapping**

- Techniques de chargement et exécution de code en mémoire.
    
- Modules :
    
    - _Local PE execution_
        
    - _Local/Remote mapping injection_
        
    - _Reflective DLL injection_
        
    - _Thread/Remote APC injection_
        
    - _Payload execution via callbacks_
        

### 5. **Staging et Obfuscation**

- Construction de payloads en plusieurs étapes avec chiffrage/obfuscation.
    
- Modules : _Payload staging_, _Payload obfuscation (x4)_, _Payload encryption (x3)_.
    

---

## 🧠 **Phase 3 – Anti-analyse et évasion**

### 6. **Anti-Debugging / Anti-VM**

- Dissuader les analystes et éviter les environnements sandbox.
    
- Modules : _Anti-debugging (x2)_, _Anti-virtualization (x3)_, _TLS callbacks_.
    

### 7. **Bypass AV/EDR**

- Désactivation ou contournement des protections.
    
- Modules :
    
    - _AMSI bypass_, _ETW bypass_
        
    - _EDR evasion - LOLBINs, Patchless syscalls, etc._
        
    - _Ntdll unhooking (x5)_
        

---

## 🦠 **Phase 4 – Techniques d’injection avancées**

### 8. **Process Hollowing & Stomping**

- Remplacement ou dissimulation de code dans un processus existant.
    
- Modules : _Process hollowing_, _Module stomping_, _Remote module stomping_, _Ghost hollowing_.
    

### 9. **Syscalls & Hell’s Gate**

- Utilisation directe des appels système pour l’injection furtive.
    
- Modules : _Indirect syscalls_, _Syscalls (x4)_, _Hell’s Gate_.
    

### 10. **Fonctions détournées et sans thread**

- Exécution sans thread classique, injection par VEH, HWBP, fibres.
    
- Modules :
    
    - _Threadless injection_
        
    - _VEH Local Code Execution_
        
    - _Utilizing fibers_
        
    - _Patchless injection via hardware breakpoints_
        

---

## 🔐 **Phase 5 – Persistance & Comportement conditionnel**

### 11. **Implémenter une persistance logique**

- Techniques pour faire durer le malware et se camoufler.
    
- Modules : _Malware directory placement_, _Malware kill date_, _Working hours_, _Domain kill switch_.
    

### 12. **Évasion conditionnelle**

- Contrôle du comportement en fonction du contexte réseau ou système.
    
- Modules : _IP Whitelisting_, _Environment checks_, _Anti-sandbox_, _File Time Stomping_.
    

---

## 📤 **Phase 6 – Exfiltration & C2**

### 13. **Communication & C2**

- Envoyer des données au serveur, créer un C2.
    
- Modules :
    
    - _Sending Keystrokes To Remote Server_
        
    - _Introduction to Havoc C2_
        
    - _PSExec implementation_
        
    - _Command-line argument spoofing_
        

### 14. **Exfiltration**

- Capturer et envoyer des données : screen, clavier, LSASS, etc.
    
- Modules :
    
    - _Developing a Keylogger_
        
    - _Screenshot to memory_
        
    - _LSASS dump BoF_
        

---

## 🧱 **Phase 7 – Construction modulaire & customisation**

### 15. **Création de Loaders et Packers**

- Générer des loaders polymorphes, empaqueter son binaire.
    
- Modules :
    
    - _Building a loader_
        
    - _Building a PE packer_
        
    - _Object File Loader_
        
    - _Zilean Stack Duplication_
        

### 16. **DRM & Signing**

- Empêcher la rétro-ingénierie, signer les binaires.
    
- Modules : _Malware binary signing_, _Building DRM-equipped malware_
    

---

## 🚀 **Bonus – Techniques avancées et expérimentales**

- Utilisation de Drivers vulnérables (BYOVD)
    
- BoF (Beacon Object Files)
    
- Heap encryption, Ekko obfuscation
    
- .NET Assembly Injection & patching