# AnsibleForms

[![CI](https://img.shields.io/github/actions/workflow/status/ansibleforms/ansibleforms/ci.yml?branch=main&label=CI)](https://github.com/ansibleforms/ansibleforms/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ansibleforms/ansibleforms?label=release)](https://github.com/ansibleforms/ansibleforms/releases/latest)
[![Image](https://img.shields.io/badge/image-ghcr.io-blue)](https://github.com/ansibleforms/ansibleforms/pkgs/container/ansibleforms)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-ansibleforms.com-informational)](https://ansibleforms.com)

AnsibleForms is a self-hosted web application that turns Ansible playbooks and AWX/AAP/Ascender templates
into self-service forms: users fill in a form, AnsibleForms builds the extravars and launches the job on a
runner - a runtime environment container (RTE) for playbooks, or AWX/AAP/Ascender for templates.
Everything about installing, configuring and writing forms is documented at [ansibleforms.com](https://ansibleforms.com).

## Features

- Cascaded dropdowns fed by databases, REST APIs, files and JavaScript or jq expressions
- Field dependencies, validation, multi-step forms, approvals and email notifications
- Role-based access per form category, with local, LDAP, Azure AD and OIDC logins
- Job history and output, abort and relaunch, plus one-off and recurring schedules
- Forms kept in Git repositories, edited in the built-in designer
- A REST API with interactive docs, an MCP server and an optional chat assistant

## Installation

AnsibleForms ships as two container images next to a MySQL database: `ghcr.io/ansibleforms/ansibleforms`, the
application, and `ghcr.io/ansibleforms/ansibleforms-rte`, the runtime environment that runs its playbooks
(fork its `Dockerfile.rte` to add your own collections and python packages).
The [installation guide](https://ansibleforms.com/installation) covers every option; the two ready-made setups are:

| Setup | Repository |
|---|---|
| Docker Compose | [ansibleforms/docker](https://github.com/ansibleforms/docker) |
| Kubernetes (Helm) | [ansibleforms/helm-charts](https://github.com/ansibleforms/helm-charts) |

## Release lines

Two major versions are maintained, each on its own branch with its own changelog and image tags.
Coming from 7? 8.0 runs playbooks on runners: read [DEPRECATED.md](DEPRECATED.md) before you move over.

| Branch | Version | Status |
|---|---|---|
| `main` | 8.x | new features and fixes |
| `release/7.x` | 7.x | fixes only |

## Deployment topology

AnsibleForms runs as a single instance (playbooks run on any number of RTEs): schema migrations and the
scheduler assume they are the only writer, so replicas behind a load balancer are not supported. For high
availability, run one instance with restart-on-failure and back up the database and the persistent volume.

## Contributing

Contributions are welcome. Start with these files:

- [CONTRIBUTING.md](CONTRIBUTING.md): the development setup and the pull request rules
- [RELEASING.md](RELEASING.md): how releases are cut
- [SECURITY.md](SECURITY.md): how to report a security issue

## License

[GPL-3.0](LICENSE).
