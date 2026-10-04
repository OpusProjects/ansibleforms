---
layout: default
title: Installation
nav_order: 2
---

# Installation
{: .no_toc }

How to install AnsibleForms
{: .fs-6 .fw-300 }

---

AnsibleForms can be installed in a few ways.  

* **Native install** : You install everything manually, install all dependencies, build the code, start the code
* **Use Docker** : Use the pre-built docker image
  * **Single container** : Install MySql and spin-up the docker image with the correct environment variables
  * **Docker Compose** : [Download the docker-compose project](https://github.com/ansibleforms/ansibleforms-docker-v6) and use docker-compose to start both MySql and AnsibleForms.  
  * **Kubernetes** : [Download the helm project](https://github.com/ansibleforms/ansibleforms-helm) and use Kubernetes to start AnsibleForms

{: .note }
> **Recommendation** Out of experience, I recommend the use of the docker-image. It has all (many) dependencies installed and can be setup very quickly. For the old v5, use the old docker-compose project.

## Install using K8s

To install AnsibleForms on Kubernetes using Helm, refer to the [ansibleforms-helm GitHub repository](https://github.com/ansibleforms/ansibleforms-helm).  Just git clone, change the values.yaml or create your own values.yaml and overwrite.

## Install using Docker-Compose 

The [docker-compose](https://github.com/ansibleforms/ansibleforms-docker-v6), together with the environment variables should get you started.

{: .warning }
> **Note** You can also use Podman and Podman-Compose. The commands are similar (docker-> podman and docker-compose -> podman-compose)

{: .warning }
> **Note** Using docker and docker-compose for the first time, requires some basic linux skills and some knowledge about containers

### Prerequisites

* **Linux machine** : Any flavour should do, The need of CPU and memory is not very high, but, of course can grow if you start a lot of playbooks simultaniously. When using Podman, I recommand Debian (ubuntu has some issues with Podman)
* **Github access** : The easiest way is to download or clone the docker-compose project on Github
* **Install Docker** : You need to have a container environment, and in this example we use Docker
* **Install Docker Compose** : To spin-up AnsibleForms and MySql with docker, using a few simple configuration-files, we need Docker Compose

{: .warning }
> **Linux Flavour** The examples below are for Redhat/CentOs and Ubuntu/Debian, use apt-get or other package managers for your flavour of linux.

**VIDEO**: [How to install AnsibleForms](https://www.youtube.com/watch?v=IHGIggmtTuA)

### Choose a location to install

```bash
sudo mkdir /srv/apps
cd /srv/apps
```

### Clone the docker-compose project

```bash
# ubuntu or debian
sudo apt-get install -y git

‌sudo ‌git init
sudo git clone https://github.com/ansibleforms/ansibleforms-docker-v6.git

cd ansibleforms-docker-v6
```

### Set proper permissions

```bash
# write access will be needed on the datafolder
sudo chmod -R 664 ./data
```

### Install Docker and docker-compose

[Docker installation manuals](https://docs.docker.com/engine/install)

```bash
# ubuntu / debian
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-compose

# the below is to ensure dns works properly inside the dockerimages
sudo mkdir -p /etc/docker
echo "{\"dns-opts\":[\"ndots:15\"]}" | sudo tee /etc/docker/daemon.json

# start docker permanently as a service
sudo systemctl start docker
sudo systemctl enable docker
```

### Install Podman and podman-compose

```bash
# ubuntu / debian
sudo apt-get install -y podman podman-compose
```

### Customize

Feel free to look at the variables in the `.env` file and `docker-compose.yaml` file.  
[Learn more about the environment variables](customization)

### Start docker-compose project

```bash
sudo docker-compose up -d
# note, with some plavors and versions, it's `docker compose` (with a space)
# or
sudo podman-compose up -d
# note that podman is service-less.  You can run it as any user.  Your choice to use sudo or not.
```

### Test the application

* Surf to : https://your_ip:8443
* Login with admin / AnsibleForms!123 (or password you chose in the .env file)
* Next steps :
  * Start creating your forms by changing the config.yml file or using the built-in designer
  * Add your own playbooks under the data/playbooks/ folder
  * Add ldap connection
  * Add users and groups
  * Add AWX connection
  * Add credentials for custom external connections such as other mysql servers or credentials for rest api's or tho pass to ansible playbooks
  * Connect to git repositories and choose whether you want you forms and/or playbooks to sync with a repository

### File structure

The docker-compose project comes with the following folder structure :

```bash
.
├── data
│   ├── certificates # folder that contains sample self-signed certificates - replace with your own
│   ├── forms # folder that contains 1 or more yaml files with forms
│   ├── forms_backups # folder to hold form backups
│   ├── functions # folder for custom javascript functions
│   ├── git # folder for git repos
│   ├── images # folder for custom images
│   ├── logs # folder that holds the logfiles
│   ├── mysql
│   │   ├── db # folder that holds the database files
│   │   └── init # contains the sql files to initialize the database
│   ├── playbooks # folder for your ansible playbooks and roles
│   ├── ssh # folder for the client sshkey
│   ├── config.yml # the master forms file 
├── k8s # sample files to deploy on Kubernetes
```

## Install docker-image without Docker-Compose

Installing AnsibleForms natively will need good Linux skills and knowledge about Nodejs

### Prerequisites

* **Docker** : Install docker and have it running
* **MySql** : Install Mysql and have it running

### Install MySql

Below is just an example of how you could install MySql

```bash
wget https://dev.mysql.com/get/mysql57-community-release-el7-9.noarch.rpm
sudo rpm -ivh mysql57-community-release-el7-9.noarch.rpm
sudo yum install mysql-server
sudo systemctl start mysqld
sudo grep 'temporary password' /var/log/mysqld.log
sudo mysql_secure_installation
# the above will be interactive
# do NOT disallow remote access
# set new password of choice
```

### Get image from docker hub
If you don't want to go through the hassle of a dockerbuild.  Run a docker image directly from docker hub.  
  
If you want, you can use the latest build from docker hub (https://hub.docker.com/repository/docker/ansibleguy/ansibleforms)
Note that we have deployed the solution in the `/app` folder inside the docker.  So if you want your `config.yml`, logs, certificates and playbooks reachable from within the docker image, you have to use a mount path or persistent volume and make sure it's mounted under `/app/dist/persistent`.  
Make sure you have your environment variables set.  Most variables fall back to defaults, but the MySQL database connection is mandatory.  The image contains ansible and python3.  The below command is merely an example. An example of a config.yml you can find here (https://github.com/ansibleforms/ansibleforms/tree/main/server/persistent).

```bash
docker run -p 8000:8000 -d -t --mount type=bind,source=/srv/apps/ansibleforms/server/persistent,target=/app/dist/persistent --name ansibleforms -e DB_HOST=192.168.0.1 -e DB_USER=root -e DB_PASSWORD=password ansibleguy/ansibleforms
```

Once started :

```bash
docker ps
CONTAINER ID   IMAGE                     COMMAND                  CREATED         STATUS         PORTS                                       NAMES
d91f7b05b67e   ansibleguy/ansibleforms   "node ./dist/index.js"   7 seconds ago   Up 6 seconds   0.0.0.0:8000->8000/tcp, :::8000->8000/tcp   ansibleforms
```

### Test the application

* Surf to : https://your_ip:8000
* Login with admin / AnsibleForms!123 (or password you chose in the .env file)
* Next steps :
  * Start creating your forms by changing the config.yml file or using the built-in designer
  * Add your own playbooks under the data/playbooks/ folder
  * Add ldap connection
  * Add users and groups
  * Add AWX connection
  * Add credentials for custom external connections such as other mysql servers or credentials for rest api's or tho pass to ansible playbooks

## How to run a custom build

If you are familiar with Node js, you can download the code and build and run this locally, using PM2 for example.
This project has 2 node applications

* A client app in vue
* A server app in express

The client app will dynamically build the forms (vue.js v2) for ansible/awx, based on one or more yaml files (config.yml).
The server app (express.js) will cover authentication, background database connections and executing the ansible playbooks or awx templates.

### Prerequisites

* **Ansible or AWX** : Native installation does not cover Ansible, you must have this installed manually

### Project download

```bash
# remove nodejs if needed
sudo yum remove -y nodejs
# get repro
sudo yum install -y gcc-c++ make
curl -sL https://rpm.nodesource.com/setup_14.x | sudo -E bash -

# install nodejs
sudo yum install -y nodejs

# create holder folder (can be custom)
sudo mkdir /srv/apps
cd /srv/apps

# grab the code from github
sudo yum install -y git
sud o‌‌git init
sudo git clone https://github.com/ansibleforms/ansibleforms.git

# enter the app project
cd ansibleforms

# verify that you have 2 subfolder
```

### Project init

First we install all nodejs dependencies for both client & server

```bash
cd server
sudo npm install

cd ..
cd client
sudo npm install

cd ..
```

Second we prep our environment variables.  An environment variable file contains the configuration of this application, such as http(s) settings, ldap settings, database connections, log settings, ...
This application comes with an `.env.example` file that you must copy to `.env.development` or `.env.production` and adjust to your needs.  You can maintain both development and production file to test if you have different dev & prod environments and settings.

```bash
cd client
sudo cp .env.example .env.development

cd ..
cd server
sudo cp .env.example .env.development
sudo cp ./persistent/config.yml.example ./persistent/config.yml
```

### Modify the .env.development (or .env.production) to your needs

* enable https if needed and set the certificates (the code comes with self signed certficates)
* update forms path and log path
* set mysql server connection details

### Modify the config.yml to your needs

The `config.yml` file describes all your forms in a yaml format.  It must be available in the server application.  By default the webapp will search under `/server/persistent` 

* add categories
* add roles
* add constants
* add forms

### How to run

#### In development

First of all one must understand that this application has both a client and server side.
The client side is build with vue2 and compiles in a single html, css & js script file.
The server side is build with express (must also be compiled) and runs the api's and database connections.

All behavior and how things are started using the `npm run command` is in the `package.json` file (one for client and one for server).  There are several methods like 'build, bundle, start, ...' depending on what you want to do.

##### Run both server and client for development

When you test a vue2 application (client application), it typically spins up a temporary Express webserver, which is useless if you also have a server application, which would not be running in this case.  Therefor we have added a `vue.config.js` file which also starts our server code in that temp express server.  Now we start our client app in development, along with the server code.  We also use nodemon to auto rebuild if the code changes.

```bash
cd client
sudo npm run start
```

##### Run compiled in development

If you are done testing, you can compile the client code and have it embedded into the server code.  And then spin up the server application.  the command `npm run bundle` will compile the client code and copy it under `/views` in the server application.  You can then start the server application with `npm run dev`, and as you will see in the `package.json`, it will build, copy the environment file and start the server application in dev mode.

First we compile the client code, and bundle it in the server code

```bash
cd client
sudo npm run bundle
```

Then we run the server code in development mode.  `npm run dev` will also copy the `.env.development` file into the `./dist` folder, so make sure it's there !

```bash
cd ..
cd server
sudo npm run dev
```

#### Run in production with PM2

Running the application in the commandline, makes it fragile when something goes wrong.  We need an environment where the nodejs application can run when logged of, where it can be monitored and even restarted in case of a crash.  That's were PM2 comes in. (https://pm2.keymetrics.io/)

```bash
sudo npm install -g pm2
```

We again compile the client code and bundle it in the server code

```bash
cd client
sudo npm run bundle
```

We now compile the server code, but don't start it.

```bash
cd ..
cd server
sudo npm run build
```

Then we copy a production ready environment file. (change it to fit your production environment)

```bash
sudo cp .env.example ./dist/.env.production
```

Then we start it in PM2.  

```bash
cd dist
sudo pm2 start ecosystem.config.js --env production
```

Once started

```bash
# pm2 status
┌─────┬─────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id  │ name            │ namespace   │ version │ mode    │ pid      │ uptime │      │ status    │ cpu      │ mem      │ user     │ watching │
├─────┼─────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0   │ ansibleforms    │ default     │ 1.0.0   │ fork    │ 3104     │ 8s     │ 0    │ online    │ 0%       │ 57.1mb   │ root     │ enabled  │
└─────┴─────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
```

### First time run

The first time you surf to the webapplication, it will ask you if it should create the AnsibleForms schema.  
The default admin user is :

* username : admin
* password : AnsibleForms!123
  
## Image tags

The image is published as `ansibleguy/ansibleforms` on Docker Hub and as
`ghcr.io/ansibleforms/ansibleforms` from the release after 7.1.1 on. Releases up to and
including 7.1.1 stay at `ghcr.io/opusprojects/ansibleforms`. Both use these tags:

| Tag | Points to |
|---|---|
| `latest` | the newest release of the newest major version |
| `7`, `6` | the newest release of that major version |
| `7.0`, `6.5` | the newest release of that minor version |
| `7.0.1`, `6.5.3` | exactly that release |
| `7.1.0-rc.560.1` | a release candidate, built from a pull request to test it |
| `latest-rc` | the newest release candidate - or `latest`, when that is newer |

`latest` only ever moves forward: a patch for an older major version (say 6.5.3, released
after 7.0.0) moves `6` and `6.5`, never `latest`. To stay on a major version, use its
number (`6`) instead of `latest`. A release candidate is for testing only: once its fix is
released, move to `latest` (or the version) yourself.

## Upgrade

Upgrading is as simple as

```bash
cd /srv/apps/ansibleforms-docker
sudo docker-compose down
sudo docker pull ansibleguy/ansibleforms:latest
sudo docker-compose up -d
```

**VIDEO**: [How to upgrade AnsibleForms](https://www.youtube.com/watch?v=5ZDJ8CcUx5c)
