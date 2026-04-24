Install of docker engine

hello
```shell
# Check if WSL is installed
wsl --install
wsl --set-default-version 2

# Install a linux distro (Ubuntu there)
wsl --install -d Ubuntu

# Update Ubuntu
sudo apt update && sudo apt upgrade -y

# Install the dependencies of docker
sudo apt install -y ca-certificates curl gnupg

# Add the docker key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install the docker engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow docker to work without sudo
sudo groupadd docker
sudo usermod -aG docker $USER

# Reload the env
newgrp docker

# Create the service
sudo mkdir -p /etc/docker

# Start the docker engine
sudo service docker start

# Test the deployment
docker run hello-world

# Make the docker engine start with the WSL
sudo nano /etc/wsl.conf

# Add this to your config file
[boot]
command="service docker start"

# Restart WSL
wsl --shutdown

# Then prepare the architecture
mkdir dfir-lab
cd dfir-lab
mkdir dfir-tools
mkdir dfir-web
nano dfir-tools/Dockerfile # Add the content for tools here - see in the later sections
nano dfir-web/Dockerfile # Add the content for web apps here - see in the later sections
nano docker-compose.yml # Add the content for the docker-compose.yml orchestration file

# Before running it all, check your config if you need things, like 
/mnt/c/Users/fsali/Documents/DFIR/Workspace


# Build it all up
docker compose up -d --build # Build it all
```
# Commands
```Bash
docker exec -it dfir-tools bash # Connect to a docker shell
docker compose up -d # start the docker compose process (containers, networks, volume mounting, ...)
docker compose up -d --build # After you made changes to docker file, to rebuild it all clean
docker compose down # Destroy the containers (but vomumes are on the host so they don't get killed)
```

# Tips
Use this architecture for a simple configuration
```
$ tree
.
├── dfir-tools
│   └── Dockerfile
├── dfir-web
│   └── Dockerfile
└── docker-compose.yml
```
# Samples
## Sample of dfir-tools
```
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y software-properties-common
RUN add-apt-repository universe

RUN apt update && apt install -y \
    python3 python3-pip \
    sleuthkit \
    yara \
    curl wget git vim tmux \
    iputils-ping net-tools \
    && apt clean

WORKDIR /data
CMD ["/bin/bash"]
```
## sample of dfir-web
```
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    python3 python3-pip \
    nginx \
    curl wget git \
    && apt clean

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
## sample of docker-compose.yml
```
version: "3.9"

services:
  dfir-tools:
    build: ./dfir-tools
    container_name: dfir-tools
    networks:
      - dfir_net
    volumes:
      - /:/host
      - /mnt/c/Users/fsali/Documents/DFIR/Workspace:/Workspace
    tty: true
    stdin_open: true

  dfir-web:
    build: ./dfir-web
    container_name: dfir-web
    ports:
      - "8080:80"
    networks:
      - dfir_net

networks:
  dfir_net:
```