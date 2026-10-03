---
layout: default
title: Config seed
nav_order: 5
---

# Config seed
{: .no_toc }

Declare the admin objects in a file instead of clicking them together, so a whole instance
can be rebuilt from git on an empty database.

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## What it covers

Set `CONFIG_SEED_PATH` to a yaml file and AnsibleForms applies it at startup. The file
declares the objects that until now existed only in the database:

| Section        | What it declares                     |
|----------------|--------------------------------------|
| `awx`          | AWX / AAP connections                |
| `secret_stores` | Secret stores (HashiCorp Vault, ...) |
| `credentials`  | Credentials                          |
| `oauth2`       | OAuth2 providers                     |
| `repositories` | Git repositories                     |
| `ldap`         | The LDAP configuration               |
| `settings`     | The mail settings and the public url |
| `chat`         | The chat assistant's model provider  |

This is **not** the same thing as `config.yaml`, which holds the forms, categories, roles
and constants and has its own `CONFIG_PATH`. The two are separate on purpose: the
repository that *holds* `config.yaml` is one of the objects the seed declares, so it
cannot live inside it.

Users and groups are deliberately out of scope. Identity normally comes from LDAP or
OAuth2, and the first admin is already covered by `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Example

```yaml
version: 1

awx:
  items:
    - name: tower
      uri: https://tower.example.com
      token: ${SEED_AWX_TOKEN}
      is_default: true

secret_stores:
  items:
    - name: vault
      type: vault
      url: https://vault.example.com:8200
      token: ${SEED_VAULT_TOKEN}

credentials:
  items:
    - name: production-db
      user: svc_forms
      password: ${SEED_DB_PW}
      host: db.example.com
      port: 3306
      db_type: mysql
      is_database: true

repositories:
  prune: true
  items:
    - name: forms
      uri: https://git.example.com/forms.git
      branch: main
      use_for_forms: true
      use_for_config: true
      rebase_on_start: true

# ldap and settings are single-row sections, so EVERY field must be declared - see
# "Single-row sections are all or nothing" below. Empty is a perfectly good value.
ldap:
  server: ldap.example.com
  port: 389
  ignore_certs: false
  enable_tls: false
  cert: ""
  ca_bundle: ""
  bind_user_dn: cn=bind,dc=example,dc=com
  bind_user_pw: ${SEED_LDAP_PW}
  search_base: dc=example,dc=com
  username_attribute: uid
  groups_attribute: memberOf
  enable: true
  groups_search_base: ""
  group_class: ""
  group_member_attribute: ""
  group_member_user_attribute: ""
  mail_attribute: mail
  groupfilter: ""            # optional, see below

settings:
  mail_server: smtp.example.com
  mail_port: 587
  mail_secure: false
  mail_username: ""
  mail_password: ""
  mail_from: ansibleforms@example.com
  url: https://forms.example.com

chat:                        # the chat assistant's model provider (6.5)
  provider: anthropic        # see below, or "" (chat off)
  api_key: ${SEED_CHAT_API_KEY}
  base_url: ""               # empty for the provider default ; azure and custom need one
  model: claude-opus-5-5
  max_turns: 20
  max_tool_rounds: 6
  timeout_seconds: 60
  allow_job_status: true
  # optional - for a proxy or a vendor with its own ways
  auth_type: ""              # "" (provider default) | bearer | api-key | x-api-key | none
  api_version: ""            # e.g. 2024-10-21 for Azure OpenAI
  request_user: ""           # sent as user, e.g. for a proxy that requires one
  ignore_certs: false        # true skips the certificate check (a self-signed proxy) - insecure
  extra_headers:             # a mapping of extra request headers
    X-Org: ops
```

`provider` is one of `anthropic`, `openai`, `azure`, `gemini`, `grok`, `mistral`,
`deepseek`, `groq`, `openrouter`, `ollama`, `custom` (any other OpenAI-compatible endpoint).

The chat section is a single row like `ldap`, so every field is required, except the optional
ones - an omitted one is left as it is. The chat also
needs `ENABLE_CHAT=1`; see the [Chat assistant](chat) page.

## Single-row sections are all or nothing

`awx`, `credentials`, `oauth2` and `repositories` are lists, and each item is its own record.
`ldap` and `settings` are different: they are **one row**, so the read-only flag is one flag
covering the whole row. Declaring only part of such a section would freeze fields the seed
never writes — a seed setting just `url` made the Mail page answer 403 for SMTP changes that
nothing would ever revert, and a seed omitting `enable` produced a managed, disabled LDAP that
could not be switched on from anywhere.

`ldap.groupfilter` is the single exception. It arrives after seed files are already in use,
so requiring it would reject every seed written before it existed. Omit it and the
column is left alone, exactly like a field of a list section the seed does not mention.

So both sections require **every** other field, and a seed that omits one refuses to start naming it:

```
Config seed failed, refusing to start : Seed file validation failed :
/settings must have required property 'mail_server'
```

It is verbose, deliberately. The file is then the complete truth about that row, the refusal in
the UI is honest, and nothing is silently defaulted behind your back. `""` and `false` are
valid declarations — say so explicitly rather than leaving a field out.

The `settings` section still only owns the mail fields and the url. `forms_yaml`, the logo and
the theme defaults are not seed material and stay editable.

## The file holds no secrets

Any `${VARIABLE}` in a string is replaced with that environment variable when the seed is
applied, so the file itself can live in git next to the rest of the deployment. On
Kubernetes that means a `Secret` consumed with `envFrom`, which you can in turn feed from
a real secret store.

A reference that cannot be resolved is a **fatal error**. It is not left as-is and it is
not blanked: storing the literal string `${SEED_LDAP_PW}` as a bind password produces
something that authenticates against nothing while looking perfectly configured.

Credentials can also take their user and password from a [secret store](secret-stores.md)
instead, with `secret_store` and `secret_ref`. `vault_path` still works in 7.x and is removed in 8.

## Managed objects

An object that comes from the seed is flagged **managed**:

- It is enforced on **every** start, so the file stays authoritative.
- The API refuses to change or delete it (**403**), and the interface shows it with a
  *Config seed* badge, its Edit and Delete actions greyed out. Read-only actions such as
  *Test connection* stay available.
- The flag itself cannot be set or cleared through the API — only the seed owns it.

Anything created by hand in the interface is **never touched** — with one exception. If
the seed declares a name that already exists, that record is **adopted**: the declared
fields are enforced on it and it becomes read-only. The file is authoritative, so this is
the intended outcome, but it does overwrite what somebody typed, so it is logged as a
warning and named in the audit entry rather than happening quietly. In a **list** section,
fields the seed does not mention are left as they are; `ldap` and `settings` cannot omit a
field at all (see above).

Applying the seed is idempotent. A record that already matches what is declared is left
completely alone, which is why a restart normally reports `0 updated`.

One exception is deliberate: a declared repository whose working tree is missing on disk is
**cloned again** on every start. The first clone runs in the background, so a failure there —
bad credentials, DNS, or a pod killed mid-clone — would otherwise never be retried, and a
repository marked `use_for_config` would leave the instance serving no forms at all with
nothing saying why. The Status page's *Repositories* row reports any repository with no
working tree, so a clone that keeps failing is visible rather than silent.

### Removing an object

Dropping an object from the file **releases** it: the record stays and becomes editable
again. Deleting a whole section behaves the same way as leaving it empty.

Add `prune: true` to a list section to **delete** undeclared managed records instead:

```yaml
credentials:
  prune: true
  items:
    - name: production-db
      # anything else the seed used to manage is deleted
```

`prune` only ever considers managed records. It cannot delete something somebody made by
hand.

## Changing the file without restarting

The seed is re-read every `CONFIG_SEED_RELOAD_SECONDS` (60 by default, `0` turns it off)
and re-applied when its content has changed. A change committed to git therefore reaches a
running instance on its own: on Kubernetes a `ConfigMap` is remounted under the pod within
about a minute and the next check picks it up. Nothing is rolled, nothing restarts, and no
hook has to call anything.

An unchanged file costs one hash and stops there, so the poll never rewrites a row it has
already applied.

Two ways to ask for it immediately rather than waiting:

```
POST /api/v2/config-seed/apply     # settings admin ; answers with what it did
kill -HUP 1                        # inside the container, no credentials needed
```

Both **force** an apply even when the file has not changed, which is the point of asking:
it re-asserts a managed record somebody edited straight in the database, and re-clones a
declared repository whose working tree has gone missing.

{: .note }
> A reload is **never fatal**, unlike the apply at startup. An instance that is already
> serving keeps the configuration it has, the reason is logged, and the *Config seed* row on
> the Status page turns red naming it. A typo pushed to git must not be able to take a
> running instance down with no operator action at all.
>
> The same broken content is not retried on every tick either, or one bad edit would write
> the same error to the log for ever. Fix the file, or call the endpoint to retry it now.

## A broken seed refuses to start

An unreadable file, invalid yaml, an unknown field, a duplicate name or an unresolved
`${VARIABLE}` makes the server **exit** rather than start. This is the **startup** path
only: see the note above for what the same file does to an instance that is already up.

That is deliberate. Carrying on with the previous configuration means an instance whose
behaviour no longer matches the manifest that is supposed to describe it, and nothing
saying so out loud. The reason is written to standard error as well as to the log file, so
`kubectl logs` and `docker logs` show it.

Validation is strict — unknown fields are rejected rather than ignored, and the error names
the offending key:

```
Config seed failed, refusing to start : Seed file validation failed :
/awx/items/0 must NOT have additional properties 'tokenn'
```

## An empty database provisions itself

With `ALLOW_SCHEMA_CREATION` on (the default), a database that holds **no AnsibleForms
tables at all** gets its schema created at startup. A fresh deployment therefore comes up
without anybody calling the `/schema` endpoint by hand.

The precondition is strict on purpose: creating the schema **drops every table first**, so
it only ever runs against a database that is completely empty. A database that is missing
one column, or that has tables but no user accounts, is *not* empty and is left alone —
the schema patches handle those.

## Kubernetes

Mount the seed from a `ConfigMap` and its secrets from a `Secret`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ansibleforms
spec:
  # AnsibleForms is single-instance. See the warning below.
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: ansibleforms }
  template:
    metadata:
      labels: { app: ansibleforms }
    spec:
      # long enough for the longest playbook run to finish at shutdown
      terminationGracePeriodSeconds: 120
      containers:
        - name: ansibleforms
          image: ansibleguy/ansibleforms:latest
          env:
            - name: CONFIG_SEED_PATH
              value: /seed/seed.yaml
            # a ConfigMap edited in git is remounted here within about a minute and
            # applied from there, so changing the seed does not roll the pod
            - name: CONFIG_SEED_RELOAD_SECONDS
              value: "60"
            # the environment is declared here, so the settings pages must not
            # write persistent/.env behind this manifest's back
            - name: ALLOW_ENV_EDIT
              value: "0"
          envFrom:
            - secretRef:
                name: ansibleforms-seed-secrets   # SEED_AWX_TOKEN, SEED_LDAP_PW, SEED_CHAT_API_KEY, ...
            - secretRef:
                name: ansibleforms-secrets        # DB_PASSWORD, ENCRYPTION_SECRET, ...
          volumeMounts:
            - name: seed
              mountPath: /seed
              readOnly: true
            - name: persistent
              mountPath: /app/dist/persistent
          livenessProbe:
            httpGet: { path: /api/v2/version, port: 8000 }
          readinessProbe:
            # queries the database, so it also covers "the schema is there"
            httpGet: { path: /api/v2/schema, port: 8000 }
      volumes:
        - name: seed
          configMap:
            name: ansibleforms-seed
        - name: persistent
          persistentVolumeClaim:
            claimName: ansibleforms-persistent
```

{: .warning }
> **AnsibleForms is single-instance.** Scheduled tasks run in-process, the designer lock is
> a file, and playbooks run as child processes of the pod. Two overlapping pods means two
> nightly backups, a lock file on a volume the second pod may not be able to mount, and
> running jobs killed at cutover. Use `replicas: 1` with the `Recreate` strategy — a
> rolling update is not safe here.

`ENCRYPTION_SECRET` must be set before any credential is entered. Once credentials come
from the seed the database is effectively a cache, so rotating it means re-applying the
seed rather than re-entering everything by hand.

## Turning off environment editing

`ALLOW_ENV_EDIT=0` makes the settings pages read-only. Every variable is still shown with
the value in force and the reason it cannot be changed, and the save endpoint refuses with
403.

Use it wherever the environment is declared elsewhere. Otherwise the settings page writes
`persistent/.env`, which on an ephemeral volume is silently lost at the next restart, and on
a durable one drifts away from the manifest that is meant to be authoritative.

{: .note }
> Backups include `persistent/.env` as `managed.env`, so a rebuild gets the database, Vault
> and path settings back. **`ENCRYPTION_SECRET` and `ACCESS_TOKEN_SECRET` are stripped out**:
> the dump beside it holds every stored credential as AES ciphertext, and writing the key that
> decrypts it into the same folder would make a copied backup enough to read them all. Set
> those two on the target host instead — a comment in the file says so.
>
> What remains can still hold credentials (`VAULT_TOKEN`, a mail password), so the file is
> written `0600`. Restoring it is a separate opt-in step rather than part of a normal restore,
> because the database host and paths in it describe the machine the backup came from — the
> restore dialog lists the file and offers its own *Restore environment* button
> (`POST /api/v2/backup/:folder/restore-env`), which keeps the previous file as `.env.bak`.

## What is recorded

Each apply that changes something writes one `seed.apply` entry to the audit log, naming
the objects created, updated, released and pruned. Values are never recorded, because most
of them are secrets. A no-op apply writes nothing, so the trail stays meaningful, and a
poll that finds the file unchanged is a no-op - the trail does not gain a row per minute.

An apply asked for through the endpoint is recorded twice on purpose, and the two rows say
different things: `config-seed.apply.create` is **who** asked for it, `seed.apply` is
**what** it changed.

The Status page reports the seed twice: a **check** that the file is still readable, parses,
and that the last reload succeeded, and an **information** row saying how many records it
currently owns. The check is the only place that says the file on disk and the configuration
in force have parted company, since a failed reload leaves the instance running.
