# Example
```Python
# Import the module types list,  so we can indicate the type of our module
from iris_interface.IrisModuleInterface import IrisModuleTypes

# Human name displayed in the GUI Manage > Modules. This can be anything,
# but try to put something meaningful, so users recognize your module.
module_name = "iris_getrequest_ontag"

# Description displayed when editing the module configuration in the UI.
# This can be anything,
module_description = "Provides a module that make get requests"

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
        "param_name": "iris_getrequest_ontag_URL",
        "param_human_name": "URL cible",
        "param_description": "URL cible de la requête GET",
        "default": "https://zfzegfezgzegezg.requestcatcher.com",
        "mandatory": True,
        "type": "string"
    },
    {
        "param_name": "iris_getrequest_ontag_tag",
        "param_human_name": "Tag cible",
        "param_description": "Tag devant être présent sur l'IOC",
        "default": "reset_mdp",
        "mandatory": True,
        "type": "string"
    }
]
```

![screenshot](/knowledge-assets/3150d5cd815949d9bb65837ccce3e372.png)
