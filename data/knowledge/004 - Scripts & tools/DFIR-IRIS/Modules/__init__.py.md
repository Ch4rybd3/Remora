---
Date: 2025-04-09
Template: "[[Templates/Documentation - Template.md]]"
tags: 
Linked: "[[DFIR-IRIS]]"
---
# Example
```Python
# Set the __iris_module_interface variable to the name of our main class.
# When IRIS instantiates the python module, it looks for "module.__iris_module_interface"
# And then tries to instantiate the class "__iris_module_interface.__iris_module_interface", here 'IrisDummyModule.IrisDummyModule'.
# That's why the python file must have the same name as the class.

__iris_module_interface = "iris_getrequest_ontag"
```
