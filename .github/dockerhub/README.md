# AnsibleForms

A web application to create pretty advanced forms that run Ansible playbooks or AWX/AAP
templates.

> **This Docker Hub repository is a mirror.** The canonical image is
> [`ghcr.io/ansibleforms/ansibleforms`](https://github.com/ansibleforms/ansibleforms/pkgs/container/ansibleforms).
> Both get every release with the same tags, so nothing breaks if you stay here, but new
> installs should pull from ghcr.io: it belongs to the AnsibleForms project and does not
> rate-limit anonymous pulls.
>
> ```bash
> docker pull ghcr.io/ansibleforms/ansibleforms:7
> ```

## Tags

| Tag | Points to |
|---|---|
| `latest` | the newest release of the newest major version |
| `7`, `6` | the newest release of that major version |
| `7.1`, `6.5` | the newest release of that minor version |
| `7.1.2`, `6.5.2` | exactly that release |
| `latest-rc` | the newest release candidate, for testing only |

Use a major version tag (`7`) rather than `latest`, so a new major version never lands
without you choosing it.

## Getting started

- **Docker Compose:** [ansibleforms/docker](https://github.com/ansibleforms/docker) starts
  AnsibleForms with its MySQL database (`main` for 7, the `v6` branch for 6).
- **Kubernetes:** the [helm chart](https://github.com/ansibleforms/helm-charts).
- **Documentation:** [ansibleforms.com](https://ansibleforms.com), including the
  [installation guide](https://ansibleforms.com/installation) and
  [Upgrading to 7](https://ansibleforms.com/upgrade-7).

## Source

[github.com/ansibleforms/ansibleforms](https://github.com/ansibleforms/ansibleforms),
GPL-3.0.
