# The app runs on plain node: it spawns git, ssh, ssh-keyscan, ssh-keygen, mariadb-dump,
# mariadb, ytt, ps and sh, never ansible or python (playbooks run on an RTE, Dockerfile.rte-*).
# Both node images are pinned by DIGEST, not by tag : a new node build moves the tag, and
# without the pin that would silently change what every application build starts from - with
# no commit here to show for it. Dependabot proposes a new pin as a pull request.
#
#   docker pull node:24-bookworm-slim
#   docker inspect --format='{{index .RepoDigests 0}}' node:24-bookworm-slim
#
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS nodebase

# ytt renders forms when USE_YTT=1 ; a static binary, checked against the release checksums
ARG YTT_VERSION=0.55.3
ARG YTT_SHA256_AMD64=15751b45a819edbf22b3d3eadb5fa9a5a2599128d921660a874bd39c47bb41e1
ARG YTT_SHA256_ARM64=fed073d52b780a88ce506e68c44f33cedede2dad3d5f4fbe07a2833e45d996ed
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client mariadb-client procps ca-certificates curl tini \
 && case "$TARGETARCH" in \
      amd64) sum="$YTT_SHA256_AMD64" ;; \
      arm64) sum="$YTT_SHA256_ARM64" ;; \
      *) echo "no ytt for $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/ytt "https://github.com/carvel-dev/ytt/releases/download/v${YTT_VERSION}/ytt-linux-${TARGETARCH}" \
 && echo "$sum  /usr/local/bin/ytt" | sha256sum -c - \
 && chmod +x /usr/local/bin/ytt \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

##################################################
# builder stage
# intermediate build to compile the client application with vite
# can run in parallel with base stage

FROM node:24-bookworm@sha256:22f6fe5f59fb7fed238b19623506d573dffaa932ce33b84ce541a9a2e0eade28 AS tmp_builder

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
COPY ./scripts/generate-build-info.sh /tmp/generate-build-info.sh
RUN chmod +x /tmp/generate-build-info.sh

# Generate the client's build-info.json BEFORE the build, in client/ (not dist/, which vite
# empties) : vite.config.mjs bakes it into the bundle, so the running client knows its own
# build (issue #660). It is no longer served as a file.
RUN /tmp/generate-build-info.sh . "$GIT_SHA" "$BUILD_TIME" "$VERSION"

# build client
RUN npm run build

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
RUN rm -f .env.*
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
      org.opencontainers.image.description="Self-service forms that run Ansible playbooks on runtime environments (ansibleforms-rte-full) and AWX/AAP/Ascender templates" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.version="${VERSION}"

# for now we still run the app under dist..
WORKDIR /app/dist

# copy the server code, no more compiling needed sing ESM
COPY --from=tmp_builder /app/server/. ./


EXPOSE 8000

# server/healthcheck.js : /api/v2/version answers 200 without a login
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "./healthcheck.js"]

# Use js files to run the application
# tini as PID 1 : it hands SIGTERM to node (which stops cleanly, src/lib/shutdown.js) and reaps
# the git and ssh processes the app leaves behind, which node as PID 1 never does
ENTRYPOINT ["/usr/bin/tini", "--", "node", "./index.js"]
