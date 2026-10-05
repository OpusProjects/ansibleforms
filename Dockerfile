# The base image, base-server, is built in ansibleforms/base-images and pinned here by
# DIGEST, not by :latest. A rebuild of the base moves :latest, and without the pin that would
# silently change what every application build starts from - with no commit here to show
# for it. Updating the pin is a deliberate, reviewable act : Dependabot proposes it as a
# pull request.
#
#   docker pull ghcr.io/ansibleforms/base-server:latest
#   docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/ansibleforms/base-server:latest
#
FROM ghcr.io/ansibleforms/base-server:latest@sha256:e7b859d2c855c0ca9841d7cba68aaeefabf570347482fc8f756fac89454e3406 AS nodebase

##################################################
# builder stage
# intermediate build to compile the client application with vite
# can run in parallel with base stage

FROM ghcr.io/ansibleforms/base-server:latest@sha256:e7b859d2c855c0ca9841d7cba68aaeefabf570347482fc8f756fac89454e3406 AS tmp_builder

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

# OCI image labels. image.source is what links the image on ghcr.io to this repository
# (and what Dependabot and Renovate read to find release notes); the rest shows on the
# registry pages. The version label comes from the same VERSION build argument the
# builder stage uses, empty for a local build.
ARG VERSION=
LABEL org.opencontainers.image.source="https://github.com/ansibleforms/ansibleforms" \
      org.opencontainers.image.url="https://ansibleforms.com" \
      org.opencontainers.image.documentation="https://ansibleforms.com" \
      org.opencontainers.image.title="AnsibleForms" \
      org.opencontainers.image.description="Self-service forms that run Ansible playbooks and AWX/AAP templates" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.version="${VERSION}"

# for now we still run the app under dist..
WORKDIR /app/dist

# copy the server code, no more compiling needed sing ESM
COPY --from=tmp_builder /app/server/. ./

# Copy the ansible.cfg file to /etc/ansible/ directory
COPY ./server/ansible.cfg /etc/ansible/ansible.cfg

# Use js files to run the application
ENTRYPOINT ["node", "./index.js"]
