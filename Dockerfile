# The base image is pinned by DIGEST, not by :latest. A rebuild of the base (the Base
# image workflow) moves :latest, and without the pin that would silently change what every
# application build starts from - with no commit here to show for it. Updating the pin
# is a deliberate, reviewable act : Dependabot proposes it as a pull request.
#
#   docker pull ansibleguy/ansibleforms-base:latest
#   docker inspect --format='{{index .RepoDigests 0}}' ansibleguy/ansibleforms-base:latest
#
FROM ansibleguy/ansibleforms-base:latest@sha256:8ef4726163817e5648d625f21bfefc67f9c29e5a49bd26c2ae68f5be8ae349bd AS nodebase

##################################################
# builder stage
# intermediate build to compile the client application with vite
# can run in parallel with base stage

FROM ansibleguy/ansibleforms-base:latest@sha256:8ef4726163817e5648d625f21bfefc67f9c29e5a49bd26c2ae68f5be8ae349bd AS tmp_builder

# Build arguments for git SHA, build time and version. VERSION is empty for a local build,
# which leaves server/package.json as the version shown ; CI passes the release or
# release candidate version (see .github/workflows/publish.yml)
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG VERSION=

########## prep client ###########

# Use /app/client
WORKDIR /app/client

# Copy client package.json and package-lock.json to /app/client
COPY ./client/package*.json ./

# install node modules for client
RUN npm ci

# copy all
COPY ./client ./

# the form engine shared with the server - the client imports it as @engine
# (../server/src/lib/formEngine), and the server itself is only copied further down
COPY ./server/src/lib/formEngine /app/server/src/lib/formEngine

# Copy build info generator script
COPY ./generate-build-info.sh /tmp/generate-build-info.sh
RUN chmod +x /tmp/generate-build-info.sh

# build client
RUN npm run build

# Generate client build-info.json in dist folder
RUN /tmp/generate-build-info.sh ./dist "$GIT_SHA" "$BUILD_TIME" "$VERSION"

######### prep server ##########

# Use /app/server
WORKDIR /app/server

# Copy package.json and package-lock.json to /app/server
COPY ./server/package*.json ./

# install node modules
RUN npm ci --omit=dev

# Copy the rest of the code
COPY ./server .

# Generate server build-info.json
RUN /tmp/generate-build-info.sh . "$GIT_SHA" "$BUILD_TIME" "$VERSION"

# Copy the docs help file to /app/server
COPY ./docs/_data/help.yaml .

# clean files
RUN rm .env.*
RUN rm -rf ./views
RUN mkdir ./views

# Copy built client files to server views directory
RUN cp -r ../client/dist/. ./views


##################################################
# final build
# take base and install production app dependencies
# copy built app from intermediate

FROM nodebase AS final

# for now we still run the app under dist..
WORKDIR /app/dist

# copy the server code, no more compiling needed sing ESM
COPY --from=tmp_builder /app/server/. ./

# Copy the ansible.cfg file to /etc/ansible/ directory
COPY ./server/ansible.cfg /etc/ansible/ansible.cfg

# Use js files to run the application
ENTRYPOINT ["node", "./index.js"]
