---
Date: <% tp.date.now("Do MMMM YYYY") %>
Template: "[[Documentation - Template]]"
tags: 
Linked: "[[DFIR-IRIS]]"
---
# Generation de report non fonctionnel
## Pull request de fix faite sur le Github officiel de DFIR-IRIS : 
When trying to generate a report on a fresh install (reproduced on multiple environments: RPi5, VM with all hardware/software requirements met, clean installs), I consistently encountered an internal server error when attempting to generate a report for a case using a template.

Upon checking the docker-compose logs, I found the following error trace:
```
iriswebapp_app |   File "/opt/venv/lib/python3.12/site-packages/docx_generator/globals/picture_globals.py", line 44, in __init__
iriswebapp_app |     self._available_alignment_values.append(member.name)
iriswebapp_app |                                             ^^^^^^^^^^^
iriswebapp_app | AttributeError: 'str' object has no attribute 'name'
```
After some digging, I identified the root cause: the loop in picture_globals.py assumes that each member has a .name attribute, which is true for Enum instances but not when member is a plain string. This leads to the crash.

I replaced : 
`self._available_alignment_values.append(member.name)`
by : 
`self._available_alignment_values.append(getattr(member, 'name', member))`

This preserves the expected behavior for Enum values while gracefully handling strings.
Now it works perfectly for me, reports get generated and I get no more internal server errors

## Fix depuis les fichiers
Pour ce faire, il faut aller dans le container : 
```Shell
docker exec -it iriswebapp_app bash
```
Installer nano (ou sauter cette étape et utiliser vi)
```Shell
apt install nano
```
et modifier le fichier suivant : 
```Shell
nano /opt/venv/lib/python3.12/site-packages/docx_generator/globals/picture_globals.py
```
en remplaçant la ligne :
```Python
self._available_alignment_values.append(member.name)
```
par la ligne : 
```Python
self._available_alignment_values.append(getattr(member, 'name', member))
```


Hey everyone.
It's me again with my module issue.
I tried some things this morning, had tried to follow the exact same things as this guide : 
https://docs.dfir-iris.org/development/modules/quick_start/processor/ : but nothing worked.
So I tuned some things and played with the error messages I got and here I am : 
- I modified the name for my app and worker container in my buildnpush script to match the one I got from the clean install.
- I changed the lines corresponding to python as it was forxing 3.9, which I have not
Now the script works well and I get no error when running it : console output from -a : 
```
[BUILDnPUSH2IRIS] Pushing to Worker and App container!
[BUILDnPUSH2IRIS] Starting the build and push process..
[BUILDnPUSH2IRIS] Using Python: /usr/bin/python3
running bdist_wheel
running build
running build_py
copying iris_getrequest_ontag/ __init__.py -> build/lib/iris_getrequest_ontag
/usr/lib/python3/dist-packages/setuptools/command/install.py:34: SetuptoolsDeprecationWarning: setup.py install is deprecated. Use build and pip and other standards-based tools.
  warnings.warn(
installing to build/bdist.linux-x86_64/wheel
running install
running install_lib
creating build/bdist.linux-x86_64/wheel
creating build/bdist.linux-x86_64/wheel/iris_getrequest_ontag
copying build/lib/iris_getrequest_ontag/IrisgetrequestModule.py -> build/bdist.linux-x86_64/wheel/iris_getrequest_ontag
copying build/lib/iris_getrequest_ontag/ __init__.py -> build/bdist.linux-x86_64/wheel/iris_getrequest_ontag
copying build/lib/iris_getrequest_ontag/IrisgetrequestConfig.py -> build/bdist.linux-x86_64/wheel/iris_getrequest_ontag
running install_egg_info
running egg_info
writing iris_getrequest_ontag.egg-info/PKG-INFO
writing dependency_links to iris_getrequest_ontag.egg-info/dependency_links.txt
writing top-level names to iris_getrequest_ontag.egg-info/top_level.txt
reading manifest file 'iris_getrequest_ontag.egg-info/SOURCES.txt'
writing manifest file 'iris_getrequest_ontag.egg-info/SOURCES.txt'
Copying iris_getrequest_ontag.egg-info to build/bdist.linux-x86_64/wheel/iris_getrequest_ontag-0.1.egg-info
running install_scripts
creating build/bdist.linux-x86_64/wheel/iris_getrequest_ontag-0.1.dist-info/WHEEL
creating 'dist/iris_getrequest_ontag-0.1-py3-none-any.whl' and adding 'build/bdist.linux-x86_64/wheel' to it
adding 'iris_getrequest_ontag/ __init__.py'
adding 'iris_getrequest_ontag/IrisgetrequestConfig.py'
adding 'iris_getrequest_ontag/IrisgetrequestModule.py'
adding 'iris_getrequest_ontag-0.1.dist-info/METADATA'
adding 'iris_getrequest_ontag-0.1.dist-info/WHEEL'
adding 'iris_getrequest_ontag-0.1.dist-info/top_level.txt'
adding 'iris_getrequest_ontag-0.1.dist-info/RECORD'
removing build/bdist.linux-x86_64/wheel
[BUILDnPUSH2IRIS] Found latest module file: ./dist/iris_getrequest_ontag-0.1-py3-none-any.whl
[BUILDnPUSH2IRIS] Copy module file to worker container..
[BUILDnPUSH2IRIS] Installing module in worker container..
Processing ./dependencies/iris_getrequest_ontag-0.1-py3-none-any.whl
Installing collected packages: iris-getrequest-ontag
  Attempting uninstall: iris-getrequest-ontag
    Found existing installation: iris-getrequest-ontag 0.1
    Uninstalling iris-getrequest-ontag-0.1:
      Successfully uninstalled iris-getrequest-ontag-0.1
Successfully installed iris-getrequest-ontag-0.1

[notice] A new release of pip is available: 24.3.1 -> 25.0.1
[notice] To update, run: pip install --upgrade pip
[BUILDnPUSH2IRIS] Restarting worker container..
iriswebapp_worker
[BUILDnPUSH2IRIS] Copy module file to app container..
[BUILDnPUSH2IRIS] Installing module in app container..
Processing ./dependencies/iris_getrequest_ontag-0.1-py3-none-any.whl
Installing collected packages: iris-getrequest-ontag
  Attempting uninstall: iris-getrequest-ontag
    Found existing installation: iris-getrequest-ontag 0.1
    Uninstalling iris-getrequest-ontag-0.1:
      Successfully uninstalled iris-getrequest-ontag-0.1
Successfully installed iris-getrequest-ontag-0.1

[notice] A new release of pip is available: 24.3.1 -> 25.0.1
[notice] To update, run: pip install --upgrade pip
[BUILDnPUSH2IRIS] Restarting app container..
iriswebapp_app
[BUILDnPUSH2IRIS] ✅ Module installé avec succès !
```

my tree without the useless folders : 
```
├── buildnpush2iris.sh
├── iris_getrequest_ontag
│   ├──  __init__.py
│   ├── IrisgetrequestConfig.py
│   └── IrisgetrequestModule.py
├── iris_getrequest_ontag.egg-info
│   ├── dependency_links.txt
│   ├── PKG-INFO
│   ├── SOURCES.txt
│   └── top_level.txt
├── README.md
└── setup.py
```

__init.py__ : 
```
from .IrisgetrequestModule import IrisgetrequestModule
__iris_module_interface__ = IrisgetrequestModule
```

IrisgetrequestConfig.py : 
```
# Import the module types list,  so we can indicate the type of our module 
from iris_interface.IrisModuleInterface import IrisModuleTypes 

# Human name displayed in the GUI Manage > Modules. This can be anything, 
# but try to put something meaningful, so users recognize your module. 
module_name = "IrisgetrequestModule"

# Description displayed when editing the module configuration in the UI. 
# This can be anything, 
module_description = "Provides a module that replies to one hook"

# Set the interface version used. This needs to be the version of 
# the IrisModuleInterface package. This version is check by the server to
# to ensure our module can run on this specific server 
interface_version = 1.1

# The version of the module itself, it can be anything 
module_version = 1.0

# The type of the module, here processor 
module_type = IrisModuleTypes.module_processor

# Our module is a processor type, so it doesn't offer any pipeline 
pipeline_support = False

# Provide no pipeline information as our module don't implement any 
pipeline_info = {}

# The configuration of the module that will be displayed and configurable 
# by administrators on the UI. This describes every parameter that can 
# be set. 
module_configuration = [
    {
        "param_name": "log_received_hook",

        "param_human_name": "Log received hook",

        "param_description": "Logs a message upon hook receiving if set to true. Otherwise do nothing.",

        "default": True,

        "mandatory": True,

        "type": "bool"
    }
]
```

IrisgetrequestModule.py : 
```
#!/usr/bin/env python3

# Import the IrisInterface class
from iris_interface.IrisModuleInterface import IrisModuleInterface
from iris_interface.IrisStatus import InterfaceStatus  # Import nécessaire pour l'erreur

# Create our module class
class IrisgetrequestModule(IrisModuleInterface):
    # Set the configuration
    _module_name = "Iris GetRequest Module"  # Mets ton propre nom
    _module_description = "A module to handle requests."
    _interface_version = "1.0.0"
    _module_version = "0.1.0"
    _pipeline_support = False
    _pipeline_info = None
    _module_configuration = {}  # Assure-toi d'ajouter une configuration appropriée
    _module_type = "request_handler"  # Exemple de type de module

    def register_hooks(self, module_id: int):
        """
        Called by IRIS indicating it's time to register hooks.  

        :param module_id: Module ID provided by IRIS.
        """

        # Call the hook registration method. We need to pass the 
        # the module_id to this method, otherwise IRIS won't know 
        # to whom associate the hook. 
        # The hook name needs to be a well known hook name by IRIS. 
        status = self.register_to_hook(module_id, iris_hook_name='on_postload_ioc_create')

        if status.is_failure():
            # If we have a failure, log something out 
            self.log.error(status.get_message())

        else:
            # Log that we successfully registered to the hook 
            self.log.info(f"Successfully subscribed to on_postload_ioc_create hook")

    def hooks_handler(self, hook_name: str, data):
        """
        Called by IRIS each time one of our hook is triggered. 
        """

        # read the current configuration and only log the call if 
        # our parameter is set to true 
        if self._dict_conf.get('log_received_hook') is True:
            self.log.info(f'Received {hook_name}')
            self.log.info(f'Received data of type {type(data)}')

        # Return a standardized message to IR

```
setup.py : 

and my modified version of buildnpush2iris.sh : 
```
#!/bin/bash
# Courtesy of SOCFortress (modifié pour stabilité)

# Help
Help()
{
   echo "Ce script build un module DFIR-IRIS en wheel et l’installe dans les conteneurs Docker."
   echo
   echo "Syntax: ./buildnpush2iris.sh [-a|h]"
   echo "options:"
   echo "a     Installe aussi dans le conteneur App (nécessaire au premier déploiement ou si le template a changé)"
   echo "h     Affiche cette aide"
   echo
}

Run()
{
    echo "[BUILDnPUSH2IRIS] Starting the build and push process.."
    SEARCH_DIR="./dist"
    mkdir -p "$SEARCH_DIR"

    get_recent_file () {
        FILE=$(ls -Art1 "$SEARCH_DIR" 2>/dev/null | tail -n 1)
        echo "$SEARCH_DIR/$FILE"
    }

    PYTHON_BIN=$(which python3)
    echo "[BUILDnPUSH2IRIS] Using Python: $PYTHON_BIN"
    $PYTHON_BIN setup.py bdist_wheel

    latest=$(get_recent_file)
    module=$(basename "$latest")

    if [ ! -f "$latest" ]; then
        echo "[BUILDnPUSH2IRIS] ❌ Erreur : le fichier wheel n’a pas été généré."
        exit 1
    fi

    echo "[BUILDnPUSH2IRIS] Found latest module file: $latest"
    echo "[BUILDnPUSH2IRIS] Copy module file to worker container.."
    docker cp "$latest" iriswebapp_worker:/iriswebapp/dependencies/"$module"
    echo "[BUILDnPUSH2IRIS] Installing module in worker container.."
    docker exec -it iriswebapp_worker /bin/sh -c "pip3 install dependencies/$module --force-reinstall"
    echo "[BUILDnPUSH2IRIS] Restarting worker container.."
    docker restart iriswebapp_worker

    if [ "$a_Flag" = true ] ; then
        echo "[BUILDnPUSH2IRIS] Copy module file to app container.."
        docker cp "$latest" iriswebapp_app:/iriswebapp/dependencies/"$module"
        echo "[BUILDnPUSH2IRIS] Installing module in app container.."
        docker exec -it iriswebapp_app /bin/sh -c "pip3 install dependencies/$module --force-reinstall"
        echo "[BUILDnPUSH2IRIS] Restarting app container.."
        docker restart iriswebapp_app
    fi

    echo "[BUILDnPUSH2IRIS] ✅ Module installé avec succès !"
}

a_Flag=false

while getopts ":ha" option; do
   case $option in
      h) # display Help
         Help
         exit;;
      a) # Also install to app container
         echo "[BUILDnPUSH2IRIS] Pushing to Worker and App container!"
         a_Flag=true
         Run
         exit;;
     \?) # Invalid option
         echo "❌ ERREUR : option invalide"
         exit;;
   esac
done

echo "[BUILDnPUSH2IRIS] Pushing to Worker container only!"
Run
exit
```

here is what I get when I try to add the module in iris : 
`Cannot import module. Could not import module iris_getrequest_ontag: module 'iris_getrequest_ontag' has no attribute '__iris_module_interface'`
when I go into my docker instance with `docker exec -it iriswebapp_worker /bin/bash` and use `pip3 show iris_getrequest_ontag`
I have : 
```
Name: iris-getrequest-ontag
Version: 0.1
Summary: 
Home-page: 
Author: 
Author-email: 
License: 
Location: /opt/venv/lib/python3.12/site-packages
Requires: 
Required-by: 
```
same for the app container

Comparaison between my module and the vt module
```
iris_getrequest_ontag
├──  __init__.py
├── IrisgetrequestConfig.py
├── IrisgetrequestModule.py
└── __pycache__
    ├──  __init__.cpython-312.pyc
    ├── IrisgetrequestConfig.cpython-312.pyc
    └── IrisgetrequestModule.cpython-312.pyc
```

```
iris_vt_module
├── IrisVTConfig.py
├── IrisVTInterface.py
├── __init__.py
├── __pycache__
│   ├── IrisVTConfig.cpython-312.pyc
│   ├── IrisVTInterface.cpython-312.pyc
│   └── __init__.cpython-312.pyc
└── vt_handler
    ├── __init__.py
    ├── __pycache__
    │   ├── __init__.cpython-312.pyc
    │   ├── vt_handler.cpython-312.pyc
    │   └── vt_helper.cpython-312.pyc
    ├── vt_handler.py
    └── vt_helper.py
```
I don't know if the handler is something needed, I'm not used to develop modules in python so I'm kind of going by feeling there

The modules packages are located inside of the `/opt/venv/lib/python3.12/site-packages` folders of my 2 containers (app and worker)

So as far as I understand : 
- The buildnpush script worked
- The module exist on both containers
- It is found by the iris GUI
- Restarting the containers/VM does nothing
- The last error message that I don't know how to get rid of is `Cannot import module. Could not import module iris_getrequest_ontag: module 'iris_getrequest_ontag' has no attribute '__iris_module_interface'`