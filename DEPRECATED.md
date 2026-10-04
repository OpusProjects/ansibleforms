# Deprecated Features

Removed in 8.0.0. Each logs a warning when it is used.

| Deprecated | Replacement | Since |
|---|---|---|
| `VAULT_*` environment variables (imported once at the first 7.x start, then ignored) | a secret store named `vault` (Connections > Secret stores) | 7.1.0 |
| `vault_path` on a credential (API, seed) | `secret_store` + `secret_ref` | 7.1.0 |
| `POST /api/v2/config/vault/check`, `GET /api/v2/config/vault/mounts` | `POST /api/v2/secretstore/{id}/check`, `GET /api/v2/secretstore/{id}/mounts` | 7.1.0 |

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

6.x keeps getting patch releases from the `release/6.x` branch.

## Deprecating something

Mark it here with its replacement and the version, log a warning when it is used, and
remove it in the next major.
