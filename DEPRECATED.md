# Deprecated Features

Removed in 8.0.0. Each logs a warning when it is used.

| Deprecated | Replacement | Since |
|---|---|---|
| `VAULT_*` environment variables (imported once at the first 7.x start, then ignored) | a secret store named `vault` (Connections > Secret stores) | 7.0.0 |
| `vault_path` on a credential (API, seed) | `secret_store` + `secret_ref` | 7.0.0 |
| `POST /api/v2/config/vault/check`, `GET /api/v2/config/vault/mounts` | `POST /api/v2/secretstore/{id}/check`, `GET /api/v2/secretstore/{id}/mounts` | 7.0.0 |
| `hasApproval` on a form or a step (it has no effect) | `approval` | 7.0.0 |
| `awx: <name>` on a form | `runner: <name>` (an AWX connection is a runner of type `awx`) | 7.0.0 |
| the config seed's `awx:` section | `runners:` items with `type: awx` | 7.0.0 |
| `LOCK_PATH` (no longer read) | nothing: the designer lock is kept in the database | 7.0.0 |

## Upgrading from 6.5 to 7.0.0 - read first

7 runs playbooks on runners: the app no longer runs `ansible-playbook` itself. Together with
the removals below, this is what a 6.5 install changes when it moves to 7.

| What changed | What to do |
|---|---|
| playbooks no longer run inside the AnsibleForms container | start an RTE (the `ansibleforms-rte-runner` image, `AF_ROLE=rte`, `RTE_TOKEN`, the app's `DB_*` and `ENCRYPTION_SECRET`), add it under Connections > Runners and mark it as default - or declare it in the config seed's `runners:` section - or name it on the form with `runner:` |
| the app image is node only: no ansible, python or collections | the RTE comes in three layers ([examples/rte](examples/rte)). Your playbooks use the collections and python libraries the 6.5 image had : run `ansibleforms-rte-legacy` (ansible 12 with ansible-core 2.19, as 6.5 ; python 3.13, so the long-dead `boto` 2 no longer imports - `amazon.aws` uses boto3). Starting clean : `ansibleforms-rte-runner` (ansible-core and the essentials) plus your own, baked into an image built FROM it or mounted (`/etc/ansible/collections`, `/etc/ansible/roles`) |
| `ANSIBLE_PATH`, `PROCESS_MAX_BUFFER` are read by the RTE, not the app | set them in the RTE container's environment |
| the `awx` table, `/api/v2/awx` and the A.A.P. page are gone | nothing : the upgrade moves every AWX/AAP connection to Runners (type `awx`) ; forms with `awx:` keep working |
| HashiCorp Vault through `VAULT_*` | nothing : the first start imports them once as the secret store `vault` |
| images are on `ghcr.io/ansibleforms` only | pull `ghcr.io/ansibleforms/ansibleforms:7` (and `ansibleforms-rte-runner:7` or `ansibleforms-rte-legacy:7`) |
| optional : several app nodes | `AF_ROLE=app` nodes plus one `AF_ROLE=worker`, sharing the database and the persistent volume - see `examples/scale` |

## Removed in 7.0.0

Everything 6.x marked as deprecated was removed in 7.0.0. The upgrade guide
([Upgrading to 7](https://ansibleforms.com/upgrade-7) on the site) says what
replaces each item and how to move over while still on 6.5.

| Removed | Replacement | Deprecated since |
|---|---|---|
| `forms.yaml`, forms in the base config | `config.yaml` + one file per form in `forms/` | 6.0.0 |
| `FORMS_PATH` | `CONFIG_PATH` + `FORMS_FOLDER_PATH` | 6.0.0 |
| `ENABLE_FORMS_YAML_IN_DATABASE` | `ENABLE_CONFIG_IN_DATABASE` | 6.0.0 |
| the `table` field type (`tableFields`, `insertColumns`, `readonlyColumns`, `tableTitleAdd/Edit`) | a `list` field with a `subform` | 6.2.0 |
| API v1 (`/api/v1/*`) | API v2 | 6.2.x |
| `disableRelaunch` | `allowRelaunch: false` | 6.3.0 |
| `noOutput` | `output: false` | 6.3.0 |
| `enableLogin` (role option) | `allowLogin` | 6.3.0 |
| datasources and data schemas (their tables are dropped), the AnsibleForms Galaxy collection | none - an import runs as a playbook of your own | 7.0.0 |


## Deprecating something

Mark it here with its replacement and the version, log a warning when it is used, and
remove it in the next major.
