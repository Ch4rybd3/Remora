---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags: 
Linked: "[[DFIR-IRIS]]"
---
# Example
```Python
#!/usr/bin/env python3

import requests
from iris_interface.IrisModuleInterface import IrisModuleInterface
from iris_interface.IrisInterfaceStatus import IIStatus as InterfaceStatus
import iris_getrequest_ontag.iris_getrequest_ontagConfig as interface_conf


class iris_getrequest_ontag(IrisModuleInterface):
    _module_name = interface_conf.module_name
    _module_description = interface_conf.module_description
    _interface_version = interface_conf.interface_version
    _module_version = interface_conf.module_version
    _pipeline_support = interface_conf.pipeline_support
    _pipeline_info = interface_conf.pipeline_info
    _module_configuration = interface_conf.module_configuration
    _module_type = interface_conf.module_type

    def register_hooks(self, module_id: int):
        """
        Called by IRIS indicating it's time to register hooks.
        """
        status = self.register_to_hook(module_id, iris_hook_name='on_postload_ioc_create')

        if status.is_failure():
            self.log.error(status.get_message())
        else:
            self.log.info("Successfully subscribed to on_postload_ioc_create hook")

    def hooks_handler(self, hook_name: str, hook_ui_name: str, data):
        """
        Called by IRIS each time one of our hooks is triggered.
        """

        self.log.debug(f"Hook '{hook_name}' triggered with data: {data}")

        # Lecture de la config
        url_template = self._dict_conf.get('iris_getrequest_ontag_URL')
        required_tag = self._dict_conf.get('iris_getrequest_ontag_tag', 'reset_mdp')

        if not url_template:
            self.log.warning("No URL configured for iris_getrequest_ontag_URL.")
            return InterfaceStatus(True, data=data, logs=list(self.message_queue))

        if not isinstance(data, list):
            self.log.error("Expected 'data' to be a list of IOCs.")
            return InterfaceStatus(False, message="Invalid data format")

        # Pour chaque IOC (support dicts + objets IOC)
        for ioc in data:
            try:
                if isinstance(ioc, dict):
                    tags = ioc.get('tags', [])
                    ioc_type = ioc.get('type')
                    ioc_value = ioc.get('value')
                else:
                    tags = getattr(ioc, 'tags', [])
                    ioc_type = getattr(ioc, 'type', None)
                    ioc_value = getattr(ioc, 'value', None)

                self.log.debug(f"Inspecting IOC: type={ioc_type}, value={ioc_value}, tags={tags}")

                if required_tag in tags:
                    url = url_template.format(user=ioc_value)
                    self.log.info(f"Sending GET request to {url} for IOC with tag '{required_tag}'")
                    response = requests.get(url, timeout=5)
                    self.log.info(f"Request returned {response.status_code} - {response.text}")

            except Exception as e:
                self.log.error(f"Error processing IOC: {e}")

        return InterfaceStatus(True, data=data, logs=list(self.message_queue))

```
