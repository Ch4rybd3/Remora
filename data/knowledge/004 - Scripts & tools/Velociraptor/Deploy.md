To get started deploying Velociraptor, you need 3 things : 
- The velociraptor executable that goes with the system you are on
- A server.config.yml file
- A client.config.yml

# Get the corresponding binary
You can download the binary from the Github page : 
https://github.com/Velocidex/velociraptor/releases
Download the one you should go with, but most of the time, you'll need theses ones : 
- velociraptor-version-linux-amd64 
- velociraptor-version-windows-amd64 
- velociraptor-version-linux-arm64 (when using a raspberry py) 

You'll need to download the binary corresponding to your machine, which means that if the server is a linux, and the target endpoint is a windows, the server should have the linux version and the endpoint should have the windows version
On linux, you should make the file an executable by using `chmod +x velociraptor_exec`
# Make the server.config.yml
The server.config.yml is the main config file that will be used by velociraptor to :
- start the gui with our config
- create client.config.yml with all our server configuration already done
![screenshot](/knowledge-assets/b0fac5a327da43f5ac5c79178f4c61ba.png)
You can make one by using the velociraptor binary with the following command : 
```shell
./velociraptor_exec config -i
```
It will prompt you with multiple questions to create the server.config.yml file.
In the older version of velociraptor, it could also create a client.config.yml, but in the more recent version, it is included in the server.config.yml so you can test it out with only one server.

Once done, you'll have a server.config.yml file that you'll be able to use with : 
```shell
./velociraptor_exec --config server.config.yml gui
```

You should be able to connect to the gui on the port `8889`

# Making a client.config.yml
To make a client.config.yml, you'll need the server.config.yml and the velociraptor exec ON the server.
You'll have to run : 
```shell
./velociraptor_exec config client --config server.config.yaml -o client.config.yaml
```
You can then transfer the file on the client and download the corresponding velociraptor exec.
You can do it by : 
- setting up an http server with python, really simple, fast, but only for testing purposes
- deploy it with a GPO
- deploy it with another tool like an EDR, a DFIR-IRIS module, ...

# ports to open
To communicate, they use the port 8000 which should be set up on both side (inbound, outbound rules) so you can receive passive data, but also push commands and VQL