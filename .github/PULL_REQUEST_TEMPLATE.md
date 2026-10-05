<!--
Base branch is `main` - or `release/6.x` for a fix 6.x needs (see CONTRIBUTING.md).
The TITLE must be a Conventional Commit - `feat: ...`, `fix: ...` -
because it becomes the squash commit and the CHANGELOG line. See CONTRIBUTING.md.
Security problem? Do not open a PR or an issue - see SECURITY.md.
-->

## What this changes

<!-- One or two sentences. If it fixes an issue, "Fixes #123" here. -->

## Why

<!-- What breaks without it, or what it makes possible. -->

## How it was verified

<!--
What you actually ran, not what you assume. Reverting the fix and watching the test
fail is worth more than the test passing.
-->

- [ ] `cd client && npm run lint:check && npm run test && npm run build`
- [ ] `cd server && npm run lint:check && npm run test`

## Website

<!--
Changes what users see or configure? Its documentation goes in ansibleforms/ansibleforms.github.io - link
that pull request here, and merge it once this one is released. Otherwise write "not needed".
-->

Website PR:

## Checklist

- [ ] Branch is named `<type>/<description>` and the title is a Conventional Commit that reads well as a changelog line
- [ ] `CHANGELOG.md` is NOT edited - it is generated from the title on release
- [ ] UI strings added to **all six** locale files (`en`, `de`, `fr`, `it`, `es`, `nl`)
- [ ] New page has a router entry with a `beforeEnter` guard, and a matching sidebar `permission:`
- [ ] New database column is in **both** the schema patch and `create_schema_and_tables.sql`, plus `SCHEMA_MANIFEST`
- [ ] A new or changed table or column that holds configuration is covered by the config seed (`server/src/lib/seed-schema.js`, `seed.js`, `seed.md` in ansibleforms/ansibleforms.github.io) - or the PR says why not
- [ ] New environment variable has a `server/help.yaml` entry

<!--
Maintainers: Actions -> Release candidate -> Run workflow with this pull request's number
publishes a test image (<next version>-rc.<pr>.<run> and latest-rc). See RELEASING.md.
-->
