---
layout: default
title: Secret stores
nav_order: 5.5
---

# Secret stores
{: .no_toc }

Read credentials from an external secret manager instead of storing the password in
AnsibleForms.

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## How it works

A **secret store** is a connection to a secret manager, added under
**Connections > Secret stores**. A **credential** can then name a store and a place in it
(the *secret reference*). When a form, a playbook or an expression uses that credential:

- **user** and **password** are read from the store, every time (within the store's cache time);
- **host**, **port** and **database** stay those of the credential row. When the row leaves
  one of them empty and the secret carries it, the value from the secret is used.

Forms keep referring to the credential by name, so moving a password into a store changes
nothing in your forms.

| Store type | Status |
|---|---|
| HashiCorp Vault (KV v1 and v2, token authentication) | available |

## Adding a store

| Field | Meaning |
|---|---|
| Name | How credentials refer to the store. |
| Type | The secret manager. |
| URL | Base URL, e.g. `https://vault.example.com:8200`. |
| Cache (seconds) | How long a secret that was read is reused. `0` reads it on every use. Default 60. |
| Ignore certificates / CA bundle | TLS verification. Leave the bundle empty to trust the system CAs. |
| Extra options | Options specific to the type, as a JSON object. |

**Test connection** proves the store answers and accepts AnsibleForms, without reading a
secret. The **Status** page checks every store, and for a Vault warns when its token
expires within 7 days.

### HashiCorp Vault

| Field | Meaning |
|---|---|
| Token | A token with read access to the paths your credentials use. Nothing renews it. |
| Namespace | Vault Enterprise namespace, sent as `X-Vault-Namespace`. |
| KV version | `2` (default) or `1`. |
| Default mount | Used for a reference without a slash, e.g. `myapp` becomes `secret/data/myapp`. |

The secret reference is the path, e.g. `secret/myapp/prod`. For KV v2 the `/data/` segment
is inserted when you leave it out.

#### Dynamic database credentials

A reference of the form `<mount>/creds/<role>`, e.g. `database/creds/readonly`, reads from a
dynamic secrets engine such as Vault's database engine. Vault then creates a new database
account for each read, valid for the lease.

- AnsibleForms reuses the account for 80% of its lease rather than for the store's cache
  time, so it does not create an account on every query. A store with cache `0` still reads
  every time.
- Vault returns only `username` and `password`. Put host, port, database type and database
  name in the credential row, and point the row at the store with `database/creds/<role>`.
- Nothing revokes the lease early; the account expires when Vault ends the lease.

## Using a store

### In a credential

Under **Connections > Credentials**, pick the **Secret store** and fill in the **Secret
reference**. Leave user and password empty.

### Inline, without a credential row

Anywhere a credential name is accepted: `fnCredentials`, `fnRestBasic`, the `credentials:`
of a form, and the `dbConfig` of a query.

```javascript
fn.fnCredentials('secret:vault:secret/myapp/prod')   // secret:<store>:<reference>
fn.fnCredentials('vault:secret/myapp/prod')          // the store named `vault`
```

```yaml
- name: servers
  type: enum
  query: SELECT name FROM servers
  dbConfig: secret:vault:secret/cmdb/db
```

Without a credential row the secret must carry the whole connection. For a database that
means `db_type` (`mysql`, `mssql`, `postgres`, `oracle` or `mongodb`) and a host, under the
key names below, e.g.:

```json
{ "username": "forms", "password": "...", "host": "cmdb.example.com", "port": 3306,
  "db_type": "mysql", "database": "cmdb" }
```

A secret without `db_type` is treated as a plain credential: user and password, with the
other keys passed through. A query on it assumes `mysql`, like a credential row without a type.

### Key names

A secret is mapped to a credential with these aliases. Other keys are passed through.

| Credential field | Accepted keys in the secret |
|---|---|
| `user` | `user`, `username`, `login` |
| `password` | `password`, `token`, `api_key`, `apikey`, `secret` |
| `host` | `host`, `address` |
| `port` | `port` |
| `db_name` | `db_name`, `database` |
| `db_type`, `secure` | same name (inline secrets only) |

For a credential row, host, port and database name from the secret are used only where the
row leaves them empty.

A secret with another shape can be reshaped with a `jq` expression, the third argument of
`fnCredentials`:

```javascript
// secret: { "creds": { "u": "admin", "p": "Netapp12" } }
fn.fnCredentials('vault:secret/weird', '', '.creds | { user: .u, password: .p }')
```

## In the config seed

```yaml
secret_stores:
  items:
    - name: vault
      type: vault
      url: https://vault.example.com:8200
      token: ${SEED_VAULT_TOKEN}

credentials:
  items:
    - name: production-db
      secret_store: vault
      secret_ref: secret/forms/production-db
      host: db.example.com
      port: 3306
      db_type: mysql
      is_database: true
```

See [Config seed](seed.md).

## Upgrading from the VAULT_* variables

Before 7.1 the only store was a HashiCorp Vault configured with `VAULT_*` environment
variables, and a credential pointed at it with **Vault path**.

- **The first 7.x start that finds them imports the variables once** as a secret store named
  `vault`, with the token encrypted in the database, and records that it did. From then on the
  variables are ignored: change the Vault on the Secret stores page, and remove the variables
  from your environment. As long as they are still set, each start logs a warning. A store you
  delete later is not imported again. If a store named `vault` already exists, it is kept and
  the variables are not imported.
- **Credentials with a `vault_path`** are pointed at the store `vault` by the upgrade.
  `vault_path` is still accepted by the API and the seed in 7.x and is removed in 8.
