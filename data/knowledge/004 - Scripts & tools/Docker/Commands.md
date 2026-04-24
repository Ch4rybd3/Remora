---
Date: <% tp.date.now("Do MMMM YYYY") %>
Template: "[[Documentation - Template]]"
tags: 
Linked: "[[Docker]]"
---

# Basic commands
```Shell
# List all active containers
sudo docker ps

# Connect to the shell of a container
sudo docker exec -it $containerName /bin/bash
```

Sometimes, containers output logs in stderr, since piping into grep only works for stdout, you can use this command to output the logs into the stdout for piping
```bash
docker logs nginx 2>&1 | grep "127."
```