# Contributing to AnsibleForms

Thanks for helping out. This is the short version of everything you need to know before
opening a pull request.

## Branches and pull requests

There are two long-lived branches, both protected: everything reaches them through a pull
request, and pull requests are **squash-merged**. Your intermediate commits can be as messy
as you like — only the pull request title survives.

| Branch | Holds | Releases |
|---|---|---|
| `main` | the newest major (7) | `7.x.y` |
| `release/6.x` | the current major, fixes only | `6.5.x` patches |

1. Branch from `main`, named `<type>/<short-description>`, for example
   `fix/ldap-group-filter` or `feat/constants-editor`.
2. Open the pull request against `main`.
3. Give it a [Conventional Commits](https://www.conventionalcommits.org/) title — see below.

The branch is deleted automatically once it is merged.

### A fix that 6.x needs too

Fix it on `main` first. Once that is merged, bring the squash commit to the maintenance line:

```bash
git switch -c fix/<short-description>-6x origin/release/6.x
git cherry-pick -x <the squash commit on main>
```

and open a pull request against `release/6.x` with the same `fix:` title. A fix that only
makes sense on 6 (the code is gone on main) goes to `release/6.x` directly. Only fixes go to
`release/6.x` - no features. A schema change there is appended to `patchVersion6` on both
branches; the patches are idempotent, so applying it twice is safe.

### The title is the changelog

The squash commit takes the pull request title as its message, and on release that title
becomes a line in `CHANGELOG.md` and in the release notes. It also decides the next
version:

| Title | Release | Changelog section |
|---|---|---|
| `feat: group filter for ldap logins` | minor (6.3.0 → 6.4.0) | Added |
| `fix: keep target on links in html fields` | patch (6.3.0 → 6.3.1) | Fixed |
| `perf:` / `refactor:` | patch | Changed |
| `security:` | patch | Security |
| `feat!: drop the v1 api`, or a `BREAKING CHANGE:` line in the description | major | Added, flagged breaking |
| `docs:` `test:` `ci:` `chore:` `build:` `style:` | none on its own | not listed |

An optional scope goes in brackets: `fix(ldap): ...`. Write the subject in lowercase, as
it should read in the changelog, describing what a user or an operator notices.

**Do not edit `CHANGELOG.md`.** It is generated; a pull request that touches it fails the
*Changelog untouched* check.

### Required checks

`CI / Client`, `CI / Server`, `CI / Public schema is up to date`, `Security / CodeQL`,
`PR / Title` and `PR / Branch` must be green before a merge. *Docker* and *Docs* run only
when their files change.

## Found a security problem?

**Do not open an issue.** See [SECURITY.md](SECURITY.md) — there is a private channel for
it, because this software holds Ansible credentials, database passwords and Vault tokens.

## Running it locally

```bash
npm run dev          # both halves: server on :3001, client on https://localhost:8443
```

The client uses a self-signed certificate, so the browser will warn on first visit. The
default login is `admin` / `AnsibleForms!123`.

You need a MySQL 8 (or MariaDB) instance and a `server/.env.development` telling the server
how to reach it — `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`. Against an empty database
the schema builds itself at startup.

## Before you push

CI runs exactly these, so running them first saves a round trip:

```bash
cd client && npm run lint:check && npm run format:check && npm run test && npm run build
cd server && npm run lint:check && npm run test
```

`format:check` is the client's Prettier check ; when it fails, `npm run format` in `client`
rewrites the files it names. Both sides are lint-clean and green, and the intent is to keep
them that way. The server
suite needs no database — it runs against the stubs in `server/tests/__mocks__`.

## Things that are easy to get wrong

**Every locale file, always.** Every UI string goes through `t('key')`, and
`client/src/locales/` holds `en`, `de`, `fr`, `it`, `es`, `nl`, `ca`, `pt`, `ja`, `zh` and `pl`. They are at exact
parity: same keys, same `{placeholder}` tokens. Adding a string to one and not the others
ships a missing translation. Server strings live in `server/src/locales/`, same set.

**Adding a page does not add a route.** `client/src/router/index.js` is hand-written, one
entry per page with its own `beforeEnter` guard. The guard has to match the permission the
page's API actually requires, and the sidebar entry in `AppSidebar.vue` needs the same
`permission:` value.

**Permission failures answer `403`, never `401`.** A global axios interceptor treats any
401 as a dead session and logs the user out, so a 401 for "you may not do this" throws the
user to the login page instead of showing an error. Add new permissions through the
`permissionGuard` helper in `server/src/lib/middleware.js`.

**A database column needs two edits.** `server/src/models/schema.model.js` (the patch, for
existing installs) *and* `server/src/db/create_schema_and_tables.sql` (for fresh ones), plus
an entry in `SCHEMA_MANIFEST` or the Status page will report a database as complete when it
is not. Note that SQL file **drops every table** — never run it against anything you care
about.

**Configuration in the database needs the config seed.** A Kubernetes deployment rebuilds its
configuration from the seed file (`CONFIG_SEED_PATH`, see the [seed page](https://ansibleforms.com/seed)). A new table or
column that holds configuration - settings, a connection, a provider - must be declared in
`server/src/lib/seed-schema.js`, applied in `server/src/lib/seed.js` (secrets as
`${ENV_VAR}` references, the `managed` flag for single-row sections) and documented in
`seed.md` of [ansibleforms/website](https://github.com/ansibleforms/website), with a test in `server/tests/config-seed.test.mjs`. If it should not be
seedable, say why in the pull request.

**Environment variables need a `server/help.yaml` entry.** That file is the single
source of truth for the label, the help text, the type and the allowed values. A variable
missing from it appears nowhere in the settings UI.

## Questions

Open a discussion or an issue. A draft PR with a question in it is also fine — it is
usually the fastest way to find out whether an approach fits.
