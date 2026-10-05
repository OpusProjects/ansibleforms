# AnsibleForms

[![CI](https://img.shields.io/github/actions/workflow/status/ansibleforms/ansibleforms/ci.yml?branch=main&label=CI)](https://github.com/ansibleforms/ansibleforms/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ansibleforms/ansibleforms?label=release)](https://github.com/ansibleforms/ansibleforms/releases/latest)
[![Image](https://img.shields.io/badge/image-ghcr.io-blue)](https://github.com/ansibleforms/ansibleforms/pkgs/container/ansibleforms)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-ansibleforms.com-informational)](https://ansibleforms.com)

AnsibleForms is a self-hosted web application that turns Ansible playbooks and AWX/AAP templates
into self-service forms: users fill in a form, AnsibleForms builds the extravars and launches the job.
Everything about installing, configuring and writing forms is documented at [ansibleforms.com](https://ansibleforms.com).

## Features

- Cascaded dropdowns fed by databases, REST APIs, files and JavaScript or jq expressions
- Field dependencies, validation, multi-step forms, approvals and email notifications
- Role-based access per form category, with local, LDAP, Azure AD and OIDC logins
- Job history and output, abort and relaunch, plus one-off and recurring schedules
- Forms kept in Git repositories, edited in the built-in designer
- A REST API with interactive docs, an MCP server and an optional chat assistant

## Installation

AnsibleForms ships as one container image, `ghcr.io/ansibleforms/ansibleforms`, next to a MySQL database.
The [installation guide](https://ansibleforms.com/installation) covers every option; the two ready-made setups are:

| Setup | Repository |
|---|---|
| Docker Compose | [ansibleforms/docker](https://github.com/ansibleforms/docker) |
| Kubernetes (Helm) | [ansibleforms/helm-charts](https://github.com/ansibleforms/helm-charts) |

## Release lines

Two major versions are maintained, each on its own branch with its own changelog and image tags.
Coming from 6? Read [Upgrading to 7](https://ansibleforms.com/upgrade-7) before you move over.

| Branch | Version | Status |
|---|---|---|
| `main` | 7.x | new features and fixes |
| `release/6.x` | 6.x | fixes only |

## Deployment topology

AnsibleForms runs as a single instance: schema migrations, the scheduler and the job runner all
assume they are the only writer, so replicas behind a load balancer are not supported. For high
availability, run one instance with restart-on-failure and back up the database and the persistent volume.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and the pull request rules, and
[RELEASING.md](RELEASING.md) for how releases are cut. Report security issues as [SECURITY.md](SECURITY.md) describes.

## License

[GPL-3.0](LICENSE).
