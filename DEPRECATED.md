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
| playbooks no longer run inside the AnsibleForms container | start an RTE (the `ansibleforms-rte-full` image, `AF_ROLE=rte`, `RTE_TOKEN`, the app's `DB_*` (and `ENCRYPTION_SECRET` when it registers itself), and `RTE_URL` - its address, e.g. `http://rte:8000`) and move the ansible mounts (`ansible.cfg`, roles, collections) from the app to it. It adds itself under Connections > Runners and the first one is the default ; with `RTE_REGISTER=0` you add it there yourself, or in the config seed's `runners:` section |
| the app image is node only: no ansible, python or collections | the RTE comes in three layers ([examples/rte](examples/rte)). Your playbooks use the collections and python libraries the 6.5 image had : run `ansibleforms-rte-full`, which has them on ansible 14 with ansible-core 2.21 (6.5 had ansible 12 with 2.19 : check the [ansible-core porting guides](https://docs.ansible.com/ansible/latest/porting_guides/porting_guides.html) for 2.20 and 2.21 ; python 3.14, and the long-dead `boto` 2 is gone - `amazon.aws` uses boto3). Smaller : `ansibleforms-rte-core` (ansible-core and the essentials) plus your own, baked into an image built FROM it or mounted (`/etc/ansible/collections`, `/etc/ansible/roles`) |
| `ANSIBLE_PATH`, `PROCESS_MAX_BUFFER` are read by the RTE, not the app | set them in the RTE container's environment |
| the `awx` table, `/api/v2/awx` and the A.A.P. page are gone | nothing : the upgrade moves every AWX/AAP connection to Runners (type `awx`) ; forms with `awx:` keep working |
| HashiCorp Vault through `VAULT_*` | nothing : the first start imports them once as the secret store `vault` |
| images are on `ghcr.io/ansibleforms` only | pull `ghcr.io/ansibleforms/ansibleforms:7` (and `ansibleforms-rte-full:7` or `ansibleforms-rte-core:7`) |
| launch validation is on : `LAUNCH_VALIDATION` defaults to `enforce` (6.5 : `off`). Every launch is checked against the form's rules and runs the extravars and credentials the server builds ; a REST launch must send `rawFormData` (the raw field values, as the browser does) | REST callers that send only `extravars` : add `rawFormData`. To see what would be refused first, set `LAUNCH_VALIDATION=log` and read the warnings ; `off` restores 6.5's behaviour |
| a playbook no longer inherits AnsibleForms' own environment variables (`ENCRYPTION_SECRET`, `DB_*`, `ACCESS_TOKEN_SECRET`, `RTE_TOKEN`, `VAULT_*` and every other documented one) ; the rest of the RTE's environment is passed | a playbook that read one of them with `lookup('env', ...)` : pass the value as an extravar or a credential, or set it under another name on the RTE |
| the images run as the user `node` (uid 1000), not root ; the ssh folder is `/home/node/.ssh` (was `/root/.ssh`) | give uid 1000 the volumes once, e.g. `docker run --rm -v <volume>:/v alpine chown -R 1000:1000 /v` for the persistent and ssh volumes (Kubernetes : `fsGroup: 1000`), and mount the ssh volume at `/home/node/.ssh`. An image built FROM an RTE layer switches to `USER root` for its installs and back to `USER node` (examples/rte) |
| the app resolves a playbook job's credentials and hands them to the RTE sealed for it (RTE contract 2) ; the RTE no longer reads the credentials table nor a secret store | run the RTE images of the same release as the app (an RTE of contract 1 is refused). An RTE needs `ENCRYPTION_SECRET` only to register itself : with `RTE_REGISTER=0` and the runner in the config seed or under Connections > Runners, leave it out |
| only the admin role adds, changes or deletes a runner (a runner receives the credentials of the jobs it runs) ; settings users see and test them | give the admin role to whoever manages runners |
| only the admin role grants admin : a user with settings access cannot put an account in a group the admin role names, nor change, reset or delete an admin account or such a group ; a designer without the admin role cannot change the roles (a save or a restore whose roles differ is refused) | give the admin role to whoever manages admins and roles |
| a login with the public default password (`AnsibleForms!123`) must change it first : every other API call answers 403 `password_change_required` until then | sign in once and choose a new password, or set `ADMIN_PASSWORD` before the first start ; scripts that log in with the default password must use another one |
| tokens end at a logout (that session) and at a password change (every session of the user) ; an api token (`?expiryDays=`) lives `API_TOKEN_MAX_DAYS` (90) at most | after changing a password, sign in again ; scripts with long api tokens get a new one every 90 days at least |
| Entra ID (Azure AD) signs in with OpenID Connect (PKCE, state, nonce) against your tenant only : an empty tenant id (the common endpoint) is refused, and a user of another tenant cannot sign in. The login asks for `openid profile email User.Read GroupMember.Read.All` | set the tenant id on the SSO provider (its GUID or a domain), give the app registration the delegated Graph permissions `User.Read` and `GroupMember.Read.All` with admin consent ; prefer `azuread/<object id>` over the group's name in roles |
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
