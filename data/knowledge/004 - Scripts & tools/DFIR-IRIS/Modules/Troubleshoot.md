# Commands

## Is the folder correctly pushed on both containers
```bash
# For the app container
sudo docker exec -it iriswebapp_app ls /opt/venv/lib/python3.12/site-packages | grep iris_

# For the worker container
sudo docker exec -it iriswebapp_worker ls /opt/venv/lib/python3.12/site-packages | grep iris_
```

You'll see all the iris modules, if yours appear there, then it worked
If the yappear only in one of the 2 container (I don't remeùber which one), then you probably forgot to add the -a to the buildnpush2iris.sh script, if the folder isn't in both containers, iris can't find it.

## Is the package correctly installed on both containers
```bash
# For the app container
sudo docker exec -it iriswebapp_app pip3 show iris_getrequest_ontag

# For the worker container
sudo docker exec -it iriswebapp_worker pip3 show iris_getrequest_ontag
```

# Hypothesis
