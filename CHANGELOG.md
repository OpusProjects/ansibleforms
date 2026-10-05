# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.1.3](https://github.com/ansibleforms/ansibleforms/compare/7.1.2...7.1.3) (2026-10-05)


### Fixed

* **jobs:** abort reaches a playbook on another host ([#578](https://github.com/ansibleforms/ansibleforms/issues/578)) ([137c5c6](https://github.com/ansibleforms/ansibleforms/commit/137c5c60bf03b01ea5b02551f7708e30572b848e))

## [7.1.2](https://github.com/ansibleforms/ansibleforms/compare/7.1.1...7.1.2) (2026-10-04)


### Changed

* help.yaml lives with the server, not in docs ([#600](https://github.com/ansibleforms/ansibleforms/issues/600)) ([b54d95a](https://github.com/ansibleforms/ansibleforms/commit/b54d95a1b396e33062793991d0807eb68e24f7bd))

## [7.1.1](https://github.com/OpusProjects/ansibleforms/compare/7.1.0...7.1.1) (2026-10-04)


### Changed

* shared url helpers instead of slash-trimming regexes ([#575](https://github.com/OpusProjects/ansibleforms/issues/575)) ([e6b57ab](https://github.com/OpusProjects/ansibleforms/commit/e6b57abe552f77398443b95dee09a691e3fb9335))

## [7.1.0](https://github.com/OpusProjects/ansibleforms/compare/7.0.0...7.1.0) (2026-10-04)


### Added

* **credentials:** a CyberArk Central Credential Provider secret store ([#572](https://github.com/OpusProjects/ansibleforms/issues/572)) ([a19ae72](https://github.com/OpusProjects/ansibleforms/commit/a19ae72d37d48d55886c886f2aed30de00688ae7))
* **credentials:** dynamic Vault credentials and inline secrets in dbConfig ([#571](https://github.com/OpusProjects/ansibleforms/issues/571)) ([262154b](https://github.com/OpusProjects/ansibleforms/commit/262154b9c0330a7b3b77fcd238d6472eaa8877c4))
* **credentials:** secret stores with a provider registry (HashiCorp Vault) ([#570](https://github.com/OpusProjects/ansibleforms/issues/570)) ([da3fe6a](https://github.com/OpusProjects/ansibleforms/commit/da3fe6aef0df90b613fb167228cbca77f1725ac3))
* **gui:** column presets, number and yes/no filters and CSV export in admin tables ([#573](https://github.com/OpusProjects/ansibleforms/issues/573)) ([944832c](https://github.com/OpusProjects/ansibleforms/commit/944832c1e82578924d7bb8b89b31ae7c6aba0ba9))


### Fixed

* **credentials:** fnCredentials honours its fallback, one credential resolver ([#569](https://github.com/OpusProjects/ansibleforms/issues/569)) ([ee59299](https://github.com/OpusProjects/ansibleforms/commit/ee592996b3807a88033d3b42541904977efeae68))

## [7.0.0](https://github.com/OpusProjects/ansibleforms/compare/6.5.2...7.0.0) (2026-10-02)


### ⚠ BREAKING CHANGES

Everything 6.x marked as deprecated is removed. What to change while still on 6.5: the [upgrade guide](https://ansibleforms.com/upgrade-7).

* `forms.yaml`, `FORMS_PATH`, `ENABLE_FORMS_YAML_IN_DATABASE` and forms in the base config are removed - every form lives in its own file in the forms folder.
* The `table` field is removed - use a `list` field with a subform.
* Datasources and data schemas are removed and their tables dropped, as is the AnsibleForms Galaxy collection.
* API v1 is removed - use `/api/v2`.
* `disableRelaunch`, `noOutput` and `enableLogin` are removed - use `allowRelaunch: false`, `output: false` and `allowLogin`.
* `latest` now points to 7. To stay on 6, use the image tag `6` ([image tags](https://ansibleforms.com/installation#image-tags)).

### Added

* 7.0.0 - remove everything deprecated in 6 ([#556](https://github.com/OpusProjects/ansibleforms/issues/556)) ([0f4d3a4](https://github.com/OpusProjects/ansibleforms/commit/0f4d3a4ad199db3fc80ce6aab90d8d1bea974d74))


### Fixed

* a form that still uses what 7.0.0 removed says so in one line ([#559](https://github.com/OpusProjects/ansibleforms/issues/559)) ([d68f3e2](https://github.com/OpusProjects/ansibleforms/commit/d68f3e2dbab28c20db52780bfadb96e8a97d04c0))

## [6.5.2](https://github.com/OpusProjects/ansibleforms/compare/6.5.1...6.5.2) (2026-10-01)


### Fixed

* sidebar sections open one at a time, real examples in the chat welcome, scm_branch is sent to AWX ([#549](https://github.com/OpusProjects/ansibleforms/issues/549)) ([1991e63](https://github.com/OpusProjects/ansibleforms/commit/1991e6338940c6ce55fc3328abb8092d1c516c9c))
* the Azure AD login reads the groups from Microsoft Graph on the server ([#552](https://github.com/OpusProjects/ansibleforms/issues/552)) ([79ed42b](https://github.com/OpusProjects/ansibleforms/commit/79ed42b6a5b61bedc69321df4e79d9fc847c8804))

## [6.5.1](https://github.com/OpusProjects/ansibleforms/compare/6.5.0...6.5.1) (2026-09-30)


### Fixed

* **chat:** ignore certificate errors for a self-signed proxy, and say why a provider cannot be reached ([#546](https://github.com/OpusProjects/ansibleforms/issues/546)) ([278f690](https://github.com/OpusProjects/ansibleforms/commit/278f690be1f083ee519bd129620793c911e43d8e))

## [6.5.0](https://github.com/OpusProjects/ansibleforms/compare/6.4.1...6.5.0) (2026-09-30)


### Added

* chat assistant - fill in and launch forms by talking (Anthropic, OpenAI and compatible) ([#544](https://github.com/OpusProjects/ansibleforms/issues/544)) ([255ad8a](https://github.com/OpusProjects/ansibleforms/commit/255ad8a131111a023116c25b9ec0d33416daeed9))

## [6.4.1](https://github.com/OpusProjects/ansibleforms/compare/6.4.0...6.4.1) (2026-09-30)


### Fixed

* an uploaded svg logo without width and height is shown ([#540](https://github.com/OpusProjects/ansibleforms/issues/540)) ([fb56d62](https://github.com/OpusProjects/ansibleforms/commit/fb56d6245a508b6836e14e0cf619bba696d688b0))
* server-side launch validation - server-built extravars, list rows, per-form launchValidation, relaunch with changes ([#537](https://github.com/OpusProjects/ansibleforms/issues/537)) ([81f2f50](https://github.com/OpusProjects/ansibleforms/commit/81f2f505ff5013b182c72ff020e9ae9e8f56f76b))
* the Azure AD login no longer fails on the handoff token ([#543](https://github.com/OpusProjects/ansibleforms/issues/543)) ([af0d7b0](https://github.com/OpusProjects/ansibleforms/commit/af0d7b02eacbc4e60c3d3999f90c97039aa8fd85))

## [6.4.0](https://github.com/OpusProjects/ansibleforms/compare/6.3.1...6.4.0) (2026-09-29)


### Added

* mcp server for ai agents ([#534](https://github.com/OpusProjects/ansibleforms/issues/534)) ([d7520f4](https://github.com/OpusProjects/ansibleforms/commit/d7520f472d9a68fbe0498181ec0301c34b96955b))
* one set of form validation rules for the browser, MCP and the launch API ([#535](https://github.com/OpusProjects/ansibleforms/issues/535)) ([4d429c2](https://github.com/OpusProjects/ansibleforms/commit/4d429c2ea97889bcdd89adf89e2edee245343c04))

## [6.3.1](https://github.com/OpusProjects/ansibleforms/compare/6.3.0...6.3.1) (2026-09-25)


### Fixed

* legacy expression sanitizer no longer logs an abuse error for expressions it runs ([#524](https://github.com/OpusProjects/ansibleforms/issues/524)) ([e3e1814](https://github.com/OpusProjects/ansibleforms/commit/e3e1814d4384d1dfe2c5baca334567f1ef370dac))

## [6.3.0] - 2026-09-25

### Added

-   Declarative config seed (`CONFIG_SEED_PATH`) — rebuild an instance from a yaml file. See `docs/seed.md`
-   An empty database creates its own schema at startup
-   Audit trail (`/admin/audit`) — append-only, and secrets are never stored
-   Status page (`/admin/status`)
-   Job and job output retention (`JOB_RETENTION_DAYS`), off by default
-   Visual editors for Categories, Roles and Constants. Comments and anchors survive a save
-   The config source is switchable from the UI (`config_source`) — file or database
-   A HashiCorp Vault page, with a read-only connection test
-   Environment variables are editable from the settings page, saved to `persistent/.env`
-   Config API — read, write, import, export and convert. See `GET /api/v2/docs`
-   The designer was rebuilt — a file tree, and buttons instead of raw YAML
-   The settings pages were rebuilt — tabbed, with per-field help
-   Server-wide default language and theme, plus a Color theme
-   A visual cron editor with presets and a next-runs preview
-   Schedules can be created from the admin UI
-   `GIT_PUSH_COMMAND` env var added, to customize the command used when pushing git repositories
-   Group filter for LDAP (admin panel > LDAP > Group Filter). A regular expression matched against the group name, the same one Entra ID and OIDC already have — only matching groups are kept, mapped to roles and sent to playbooks. Empty keeps every group, which is what every existing installation does today. A pattern that does not compile is logged and ignored rather than stripping everyone's roles
-   `EXTRAVARS_USER_FIELDS` env var and the `userExtravars` form property, to choose which keys of the launching user are sent to the playbook as `ansibleforms_user`. Empty keeps the whole object, as before; a comma separated list keeps only those keys and `none` sends nothing. The form property overrides the environment variable. The frontend `__user__` object and every permission check are unaffected. See `docs/faq.md`
-   The config seed is re-applied when the file changes (`CONFIG_SEED_RELOAD_SECONDS`, 60s by default), so a seed edited in git reaches a running instance without restarting it. `POST /api/v2/config-seed/apply` and `SIGHUP` force an apply immediately. A failed reload is never fatal: the configuration already in force is kept and the Status page reports it. See `docs/seed.md`
-   `EXPRESSION_SANITIZER` env var, to choose how strictly server expressions (without `runLocal`) are checked: `off` refuses every server expression, `paranoid` allows only direct `fn.`/`fnc.` calls, `strict` (default) also allows methods on their result, and `legacy` restores the 6.2.1 rules. `legacy` lets any authenticated user run code on the server, so it can only be set in the real environment (not from the settings page), logs a warning at startup and for every expression `strict` would refuse, and shows as a warning on the Status page
-   Categories can be moved around the tree — move up, move down, indent and outdent, in the settings Categories page and in the designer, taking the whole subtree along
-   Constants can hold a list or a nested object — the value box in the designer and on the settings page is read as YAML, so a block list, a list of objects and a nested map are stored as such instead of as their source text

### Changed

-   Permission failures answer `403` instead of `401`
-   `PUT /api/v2/settings/` is now a partial update
-   The settings menu has five sections: System, Forms, Access, Connections, Jobs
-   Menu entries your role cannot open are hidden
-   The designer works when the config lives in the database
-   Backup and restore follow the active config source
-   LDAP loses its Advanced toggle — the four group fields always apply

### Removed

-   LDAP `is_advanced` toggle. On upgrade the fields are blanked where it was off, old values logged first

### Fixed

-   A designer save deleted form files the loader had skipped
-   A repository named `forms` treated its whole root as a forms folder, so a save deleted unrelated yaml files
-   Approving a job twice at once launched it twice
-   A multistep step whose status could not be read counted as passed
-   A failed backup listed as a valid restore point
-   Restoring a backup with no usable dump reported success
-   `NIGHTLY_BACKUP_RETENTION=0` deleted every nightly backup
-   The designer could silently overwrite a form — ids were reused
-   Designer saves wrote to the local `config.yaml` while the app read a repository
-   The designer overwrote a ytt-templated config with its rendered output
-   Designer edits were discarded when navigating away or reloading
-   The "Show Extravars" role option never took effect — two spellings
-   A login with no `Authorization: Basic` header hung for ever, leaking a socket
-   A `401` surviving a token refresh looped refresh and retry
-   `LOG_SYSLOG_PROTOCOL` never had any effect — misspelt read, so syslog always used UDP
-   MongoDB datasource queries always failed
-   Query fields inside a wizard step or list row failed for everyone except an admin
-   Query placeholders with dot notation, an index path or `placeholderColumn` stopped working
-   Query values were escaped with MySQL's rules on every datasource, corrupting backslashes and quotes
-   Renaming a repository moved its working tree before the change was written, orphaning it if refused
-   A cron schedule with an inverted range (`0 0 * * 5-1`) saved and never ran
-   An invalid `MASK_EXTRAVARS_REGEX` or `REGEX_FILTER_JOB_OUTPUT` broke job launching and made every job unviewable
-   Bulk delete on Known Hosts removed the wrong entries — rows were keyed by position
-   `OLD_BACKUP_DAYS=0` deleted every config restore point. It now keeps everything
-   `GET /api/v2/repository/<name>` kept answering with the `head` from before a pull for up to an hour. The repositories model is cached and `findByName` reads that cache, while the git operations wrote `status`, `output` and `head` with their own SQL and evicted nothing — so the single record disagreed with `GET /api/v2/repository` and with the database. Anything polling it to learn whether a commit had landed waited on a value that could not change
-   Wizard didn't load varsFiles
-   `target="_blank"` was stripped from links in `html` and `expression` fields, so they opened in the current tab and the form was lost (#480). `rel="noopener noreferrer"` is now forced on any link that opens a new tab
-   Startup failed with `Failed to create the path for the log files` when `LOG_PATH`'s parent folder did not exist — the folder is now created recursively
-   Prefill bug (relaunch and load from form)
-   Designer: while a form's YAML was invalid - halfway through typing any line - the form jumped to a "Parsing issues" group in the tree and the editor was rebuilt, losing the cursor and focus

### Security

-   A user without verbose permission could relaunch a verbose job and get its output
-   Server-side expressions could break out of the evaluator and run commands — the guard only checked how one started
-   A form you had no access to appeared on the home page when two files shared a name
-   A server expression reached banned names through string property keys (`fn.x['constructor']`) — arbitrary code execution for any signed-in user
-   A group name containing HTML ran as script in the users list
-   Opening another user's job answered 200 with an empty body instead of refusing, and approve/reject skipped its role check
-   A `git pull` that could not read its repository record published the stored password
-   `/api/v1/query` accepted arbitrary SQL, bypassing the v2 guard
-   Form load warnings rendered the form name as HTML on the home page
-   A failed login revealed whether the username existed
-   Changing a password needed no proof of the current one
-   The query endpoint ran any SQL from the request body, with only a login required
-   A field value reached a form expression as raw text, so a crafted link ran script
-   Refresh tokens were never verified, re-checked or retired
-   Anyone could sign in as any user, including admin, through the SSO endpoints
-   Reserved extravars from the request beat the form, so any playbook could run with any credential. A `__x__` key is now accepted only when the form declares a field of that name
-   Any authenticated user could abort any other user's job
-   An AWX workflow node name ran as script in the job output
-   Dropdown option values rendered unescaped while the search box was empty
-   The `ansible-vault` password was written to the log in full
-   `VAULT_TOKEN` was returned in clear text to any user with `showSettings`
-   The v2 log endpoints had no permission check
-   A duplicate role name in `config.yaml` granted its rights twice over
-   The backup's environment filter missed `export NAME=value`, shipping `ENCRYPTION_SECRET` beside the dump it decrypts
-   `POST /api/v2/schema` required no authentication and drops every table
-   `PUT /api/v2/settings` accepted `forms_yaml`, bypassing the lock, validation and restore point
-   `/admin/schedules` and `/admin/stored-jobs` were reachable with only `showSettings`
-   A form's `constants` came from the request instead of the configuration, so a caller could rescope a query

## [6.2.1] - 2026-07-07

### Changed

-   Upgraded git actions to v5
-   Enhanced table views
-   Database connection pooling for better performance

### Added

-   Translations (en, de, fr, es, it, nl)
-   new environment var DEFAULT_LANGUAGE (if no client cookie preference is passed)
-   New `wizard:` property on forms: render a sequence of reusable subforms as numbered steps with Back/Next navigation, per-step validation, optional `defaultModel` prefix to namespace each step's output, optional steps with `when:` visibility expressions, and a `summary` step that shows a read-only review of the merged extravars before submit. Cross-step references work via `$(__parent__.<stepname>.<field>)`.
-   Full editor repository integration (#414) - tx to blaipr
-   Custom logo uploader in the admin panel (#457) - tx to blaipr

### Security

-   Fix authentication bypass via hard-coded default JWT signing secret (GHSA-g27f-cjvv-42rf) - tx to blaipr
-   Fix OS command injection in repository git operations (GHSA-56pr-p4x6-mwm6) - tx to blaipr
-   Fix stored cross-site scripting in job output and form fields (GHSA-wcmj-wqvw-6c88) - tx to blaipr

### Fixed

-   Subforms in the designer (#449)
-   a bunch of minor security fixes (injection, try/catch, etc...)
-   evalDefault in subform (#451)
-   mask pw in yaml field (#450)
-   show output for AWX workflow (#420) (huge thanks to blaipr for the fix)
-   run AF under a sub path (#106) (huge thanks to blaipr for the fix)
-   Guard forms-repo write lock against status wedge on transient race (#459) - tx to blaipr
-   Use localhost and env var for Vite dev proxy target (#465) - tx to blaipr
-   Remove dead server build scripts and unused deps (`npm-run-all`, `rimraf`) (#466) - tx to blaipr
-   Make .mjs tests vitest-compatible and fix AWX abort test failures (#467) - tx to blaipr
-   Fix password field validation checking wrong dirty state on login page (#468) - tx to blaipr
-   Redirect to home when router guards deny access instead of blank page (#469) - tx to blaipr
-   Remove unused `jsonwebtoken` from client dependencies (#470) - tx to blaipr
-   Add `unhandledRejection` handler and log uncaught errors via winston (#471) - tx to blaipr

## [6.2.0] - 2026-05-26

### Added

-   New `list` field type: a multi-row collection field where each row is edited via a subform drilldown. Supports nested lists, shared subforms, marker tracking (`insertMarker`, `deleteMarker`, `updateMarker`), column selection, soft-delete with undo, and full output modelling (`noOutput`, `outputObject`, `model`). Replaces the deprecated `table` field. (#379)
-   New `subform` property on `yaml` fields: when set, the field value is edited via a subform drilldown instead of a raw YAML editor, enabling structured single-object editing with full validation.
-   New `subform` form type: define reusable subforms (referenced by `list` and `yaml` fields) in the same forms file.
-   oauth2 swagger
-   build codes as part of the version

### Fixed

-   Dependency bug, field reset not populated to dependent placeholders
-   oauth2 init after create

### Deprecated

-   `table` field type is deprecated since 6.2.0. Existing `table` fields continue to work but show a deprecation warning. Migrate to the `list` field type combined with a `subform`.
-   `tableFields` / `Tablefield` property is deprecated since 6.2.0. Use the `subform` form type with regular `formfields` instead.
-   `disableRelaunch: true` (form property) is deprecated. Use `allowRelaunch: false` instead — positive naming, same effect.
-   `noOutput: true` (field property) is deprecated. Use `output: false` instead — positive naming, same effect.
-   `enableLogin` (role option) is deprecated. Use `allowLogin` instead — consistent with all other `allow*` role options.

## [6.1.5] - 2026-04-23

### Added

-   added role-option allowVerboseMode (#430)
-   added new role-options for jobscheduling and jobstoring (#431)
-   added new actions (schedule job, run later, store, load from store) (#431)
-   all api's have v2 implementations now
-   New YAML field type: A dedicated YAML editor field with syntax highlighting, validation, and file operations
-   Table field enhancements: Added file import/export capabilities

### Changed

-   role options are all defaulted now explicitly
-   api v1 and v2 split up for v1 deprecation
-   fixed a few security issues (block password retrieval over api)

### Deprecated

-   Data Sources and Data Schemas features - These features are currently only disabled in the GUI and will be completely removed in a future version. If you are actively using these features, please contact the maintainer as soon as possible.  The reason is the implementation of an ORM to switch to postgress in the future.
-   api v1 was not using the best rest implementation (let's say I was a rookie back then).

### Fixed

-   Error logging concatenation in token and job controllers (6 locations)
-   encoding in the expression functions
-   Cronschedules now handled with Croner, which should be better (#436)

## [6.1.4] - 2026-03-30

### Added

-   Error border on expression fields
-   Jq expression on expression with query fields so you can manipulate the otherwise always returning array
-   Added a convertToUtc property for datetime field

### Fixed

-   Ampersand bug (#412)
-   DateTime field input allowed (#416)
-   Approval stuck (#413)
-   multistep status (#413)
-   job relaunch response (#422)
-   see full job info with showAllJobLogs option (#426)

### Changed

-   validIf triggers error
-   new docs using just the docs theme
-   vite 8
-   Host and PID aware aborting, faster, cleaner and would allow multi container setup

## [6.1.3] - 2026-02-23

### Added

-   Option to track a live logfile during playbook execution.  See docs FAQ.  Perfect for long lasting custom actions (custom module) where you can write to a logfile and track live.

### Fixed

-   AzureAD redirect

## [6.1.2] - 2026-02-18

### Added

-   New ldap packages and new ldap tester (ldap uses api/v2 now)

### Changed

-   Vue sonner in favor of vue toastification
-   Cleanup and bumps in vue
-   Drop vuescroller
-   Colors (it's personal maybe)

### Fixed

-   Double checkbox dependency bug

### Breaking

-   Dropped bulma class backward compability for the tiles (use bg-danger, bg-success-subtle, ... from bootstrap)

## [6.1.1] - 2026-02-17

### fixed

-   Credential caching when testing
-   Sequential multistep

### Added

-   More Tile icon styling (size, color, overlayicon, overlaytext)
-   Paramiko in base image

## [6.1.0] - 2026-01-24

### Added

-   Job relaunch feature: Relaunch jobs with pre-filled form data from previous submissions : [issue 311](https://github.com/OpusProjects/ansibleforms/issues/311)
-   New role option `allowJobRelaunch` to control which users can relaunch jobs
-   New form option `disableRelaunch` to prevent relaunching specific forms
-   Form name validation prevents loading data from mismatched forms
-   Proper permission checks with detailed error messages
-   fnParseHtmlWithRegex now supports basic authentication via credential parameter with UTF-8 encoding support for special characters
-   fnLs, added metadata option to return more file metadata (size, created, etc...)
-   varsFiles form property: Load YAML files as constants merged with base config constants.  Supports both absolute and relative file paths. New `VARS_FILES_PATH` environment variable.
-   minValue, maxValue, minLength, maxLength, minSize and maxSize now support placeholders for dynamic validation.
-   Validation descriptions (regex, validIf, validIfNot, notIn, in) now support placeholders for dynamic error messages.
-   Field labels, help text, and placeholders now support placeholders for dynamic content (e.g., `$(fieldname)`).
-   Notification system enhancements: [issue 332](https://github.com/OpusProjects/ansibleforms/issues/332).  New `onEvent` property for job lifecycle event notifications (any, launch, relaunch, delete, approve, reject)  Separate `jobevent.html` email template for event notifications (distinct from status notifications)
-   Configuration file migration from forms.yaml to config.yaml.  Introduction of new ENV VARS. `CONFIG_PATH`, `FORMS_FOLDER_PATH` 
-   Automated nightly backup system: New `NIGHTLY_BACKUP_RETENTION` environment variable
-   Multi-repository support for forms, add repo switches "use for config", 'use for varsfiles', 'use for forms', 'use for playbooks'.

### Changed

-   Refactored Job.launch, Job.continue, and Multistep.launch to use object parameters for better maintainability and flexibility
-   Notification system refactored.  Replaced individual event properties (onLaunch, onRelaunch, onDelete, onApprove, onReject) with unified `onEvent` array.  Cleaner separation: `onStatus` for job outcomes, `onEvent` for job lifecycle triggers
-   Configuration architecture modernized.  `forms.yaml` deprecated in favor of `config.yaml` (categories/roles/constants only).  Forms folder path now configurable via `FORMS_FOLDER_PATH` environment variable
-   removed label for html type.  If you want to have some sort of label, excplicitely set a label

### Deprecated

-   `forms.yaml` - use `config.yaml` for configuration (categories, roles, constants)
-   `FORMS_PATH` environment variable - still supported but will be removed in future versions
-   Storing forms in the base config file - forms should be in the forms/ folder

### Breaking

-   to allow user to relaunch, give them the role option `allowJobRelaunch`
-   Deprecated `on` notification property completely removed (use `onStatus` instead)
-   Notification event properties consolidated: use `onEvent: [launch, relaunch, delete, approve, reject]` instead of separate `onLaunch`, `onRelaunch`, etc. properties

### Fixed

-   approval message placeholder
-   small visual job issue
-   OIDC login (kudos to theymademedothat)
-   Password decrypt issue with mail settings
-   fixed credential cache issue

## [6.0.2] - 2025-11-30

### Added

-   MASK_EXTRAVARS_REGEX, to allow extravars masking
-   fnToTable local function, converts array to html table for html info field
-   GIT_CLONE_COMMAND and GIT_PULL_COMMAND env vars added
-   fnLs dir,{recursive,regex}
-   fnParseHtmlWithRegex url,regex,regexflags

### Fixed

-   Several tablefield issues
-   Datetime field didn't bubble changes
-   knownhosts errored on non existing file
-   Recursive checkdependencies
-   check schema for correct dependencies
-   dropdown/enum, working alignment
-   dropdown/enum, refresh and preview
-   readonly and disable props
-   tablefield readonlycolumns (issue 377)
-   on-event-actions fixed
-   fixed abondon jobs loop
-   fnSsh had a bug
-   schedules extravars

### Changed

-   Schema creation in 1 shot
-   lock api to v2
-   knownhosts api to v2

## [6.0.1] - 2025-10-28

### Fixed

-   not, notIn, validIf, validIfNot, all had bugs

### Changed

-   Docker image is moving to debian based.  It's bigger, but alpine was giving dns query issues.

### Added

-   playbooksSubfolder, a subfolder path to launch ansible-playbook from

## [6.0.0] - 2025-10-02

### Fixed

-   multi default in enum field broken
-   verbose was not working well
-   textarea field in table field
-   placeholder (issue 320)
-   scrollbar (issue 318)
-   EntraId groups (issue 316)
-   Add icon not allowed to radio
-   Fixed encryption key length check

## Added

-   updateMarker to table field
-   multi awx (314)
-   backup/restore api (/api/v2/database (get, post/backup, post/restore?folder=))
-   new role option allowDatabaseOps
-   oauth2 table replaces individual azuread, oidc tables
-   integrated backup

### Changed

-   Backend rewritten to ESM (export default / import) -> no more "require" and no more "babel" and no more compiled code
-   Parsing of forms rewritten with individual form validation, should be more stable and faster
-   Backend bumped to Node.js 20
-   Most packages are updated to latest versions
-   Frontend rewritten to work with Vite (still vue2 for now) -> no more "webpack"
-   New sass-dart and bumped bulma framework to 1.0.4
-   Password decryption had a bug in v6beta

### Breaking Changes

-   Since "require" can not be used anymore, the backend code is now ESM only.
    This means that you can not use "require" anymore, but you can use "import" and "export default".  Than means that custom functions must be rewritten to use the new ESM syntax. (/functions/custom.js is an example where this could break)
-   Maybe not breaking, but the old theme is broken for bulma v1, so it might look a bit different here and there. (but note that v6 will have bootstrap)
-   Since many packages are updated, I might have missed some breaking changes like OIDC, packages have been bumped and I don't have an OIDC to test against... any help is appreciated.

## [5.0.10] - 2025-06-05

### Added

-   LOG_TZ env var for timezone (both for logging and returning job logs)  Client convertion is disabled, so the client will always show the time in the timezone of the server.
-   Added new role option `enableLogin` to allow login for this role.  If not set, login is enabled.  Set to false on the public role to disable login overall, and set to true of the roles that should allow login.
-   fn.fnRestAdvanced allows 3 placeholderfunctions (base64, username and password)
-   fn.fnRestAdvanced allows a new "raw" parameter to return the data + the response_headers

### Fixed

-   Enum with multiple and objects were not always selecting correct defaults
-   5.0.9 had awx issues.

### Breaking Changes

-   Removed old deprecated type "query" (is enum now)

## [5.0.9] - 2025-06-04

### Fixed

-   Reduce formConfig by roles // <https://github.com/OpusProjects/ansibleforms/issues/262>
-   User-based roles fix // <https://github.com/OpusProjects/ansibleforms/issues/264>
-   Ldap DN with comma's, are now properly escaped // bump ldap-authentication - ldapjs => ldapts

### Added

-   Added 2 env vars VUE_APP_NAV_HOME_LABEL and VUE_APP_NAV_HOME_ICON and a forms nav link 
-   Datasources and schema see documentation for more info
-   Schedules, allow scheduled forms
-   hvac pip lib for hashi vault integration
-   awxApiPrefix, default to /api/v2, for future AAP changes (<https://github.com/OpusProjects/ansibleforms/issues/279>)
-   Added 2 table field properties tableTitleAdd, tableTitleEdit (<https://github.com/OpusProjects/ansibleforms/issues/277>)
-   Added option showAllJobLogs (<https://github.com/OpusProjects/ansibleforms/issues/273>)
-   Added option to relaunch verbose (<https://github.com/OpusProjects/ansibleforms/issues/280>)

## [5.0.8] - 2025-02-13

### Fixed

-   Regex in repo's
-   Jwt token issuer added (use env variable ACCESS_TOKEN_ISSUER) - credits to le-martre for the fix
-   maxBuffer causing abort by operator, adding PROCESS_MAX_BUFFER variable. // <https://github.com/OpusProjects/ansibleforms/issues/247>

### Changed

-   The admin user can now be removed, and will be recreated automatically if needed at first start.
    use env variables ADMIN_USERNAME and ADMIN_PASSWORD.

### Added

-   YTT extra environment variable (see help)
-   Role options (showDesigner, showLogs, showSettings, ...) allowing for custom semi-admin or designer roles
-   Added branch to repos

## [5.0.7] - 2024-10-03

### Added

-   Added scm branch option to pass to awx

### Fixed

-   AzureAD with more than 100 groups was not working anymore since introduction of OIDC
-   Mysql check during init failed and skipped part of init
-   App now properly waits for mysql to be ready before starting
-   Vuelidate 2+ was not working properly for dependent required fields

## [5.0.6] - 2024-09-20

### Fixed

-   Removed ip lib parts CVE related
-   Updated to vuelidate 2+ (CVE related)

### Added

-   New dockerfile with debian

## [5.0.5] - 2024-09-18

### Fixed

-   Fixed regex for ssh key
-   New version highlight for CVE
-   Bumped several versions

## [5.0.4] - 2024-08-18

### Added

-   If forms.yaml is missing, it will be auto created. This is useful for new installations without docker-compose
-   Same for certificates

### Changed

-   Async await replacements for promises (readability)

### Fixed

-   Some credentials bugfixes

## [5.0.3] - 2024-06-21

### Added

-   Option to disable/enable schema creation (ALLOW_SCHEMA_CREATION)
-   Forms yaml can now be in the database (overriding the local file)
-   Database queries are by default no longer logged, use ENABLE_DB_QUERY_LOGGING to enable it again
-   Mongodb connection test

### Changed

-   Improved schema creation error messages and error handling
-   Schema patching is now done at application initialization
-   Rewrote database connections with await/async

### Fixed

-   Vault credentials, alpine requires decode -d instead --decode
-   Type on jobstatus notification template

## [5.0.2] - 2024-06-10

### Adding

-   Now allowing string (credential name) or array (of names) as dbConfig (dbtype is fetched from the database, with mysql fallback)
    When using array, the resultsets are merged.
-   Added ytt implementation to template yaml files (credits mdaugs)
-   Vault credentials, pass a vault password to ansible playbook.
-   OIDC authentication (credits mdaugs)
-   Ansibleforms will now wait for mysql to be ready before initializing

### Changed

-   job api return objects (extravars, notifications, credentials, ...) instead of json strings
-   awx job id is added to the database

### Fixed

-   radio button errors
-   some issue with the designer when a field without name was added
-   multistep was always successfull (tx to mdaugs)
-   using cookie session instead express session

## [5.0.1] - 2024-04-10

### Fixed

-   login expiryDays didn't work
-   fixed non-ascii codes in ldap
-   fixed approvals, broken since 4.0.19

### Added

-   add a form-reload route
-   added mail attribute ldap
-   improved error message on unevaluated fields
-   allow to model arrays like foo.bar[0].ping.pong[1]
-   allow placeholders in description fields of field validation

## [5.0.0] - 2024-01-25

### Added

-   in remote expression functions, we throw errors so they show up in the form.
-   added valueColumn "\*" and placeholderColumn "\*", to return all column, this also means that valueColumn "\*" results in the same as outputObject: true. 
-   jobid is passed now as extravar and passed to nextform, incase an action exists
-   you can now hide a text field
-   more advanced ldap properties for non active directory ldap servers
-   git repositories generic (for forms and playbook for example)
-   added expiryDays to login api, for longlived tokens (admin only)
-   added jwt tokenPrefix property on jwt functions
-   allow admin role fallback for local/admins group in case no forms are found
-   radio button values property can now have array of objects (label, value)
-   instanceGroups property on forms => choose awx instanceGroups
-   enable verbose checkbox for quick ansible verbose mode

### Removed

-   git repo type, you can no longer target git repo's from a form, this is breaking when you upgrade to 5.0.0 and use the formtype 'git'

### Fixed

-   awx workflow template failed with 404
-   ldap usernameattribute not used
-   fixed database query issue for postgres
-   use ldap-authentication main code (no npm)
-   try ldap group objectName first

## [4.0.19] - 2023-11-22

### Fixed

-   undefined error with json

### Added

-   Added AzureAD group filter to limit the number of groups

## [4.0.18] - 2023-11-10

### Fixed

-   javascript replace error with defaults
-   Newer Netapp collection 22.8.2

## [4.0.17] - 2023-11-07

### Fixed

-   AzureAD only returned first 100 groups.
-   Constants with arrays now work correctly
-   Little ldap test bug
-   model bug, bad merging and weird caching

### Added

-   Expression field can now have property `value` for manual data assignment
-   Added form property ansibleCredentials, allowing to pass ansible_user and ansible_password

## [4.0.16] - 2023-10-07

### Changed

-   Ansible has now default yaml stdout
-   fn.fnCredentials can have regex and a second ballback

### Added

-   New formfield type 'file' to upload files prior to job execution
-   New Database property in credentials, needed for postgres, and can be used for mysql and mssql
-   credentials property on forms => array of credentials to add
-   awxCredentials property on forms => array of awxCredentials to add
-   executionEnvironment property on forms => choose awx executionEnvironment

### Fixed

-   Int64 issues in rest results, new rest parameter 'hasBigInt'
-   Issue with null values in enum fields

## [4.0.15] - 2023-08-09

### Added

-   Installation video to documentation
-   add fnGetNumberedName as local function

### Fixed

-   Table expression issue fixed

## [4.0.14] - 2023-08-03

### Added

-   New documentation, the website ansibleforms is now generated on github pages using jekyll

### Changed

-   Removed environment variable from reference guide (find it in documentation now)

### Fixed

-   Scheme creation bug fixed
-   Typos in help
-   Vue2 bug number fields fall back to emptry string when empty.  fixed to set to undefined.

## [4.0.13] - 2023-07-24

### Added

-   New dependency mechanism isValid
    you can show/hide a field based if another field is valid or not

## [4.0.12] - 2023-07-15

### Changed

-   Modals are now 1024px

### Added

-   Allow enum array-of-objects values.
-   New alias local_out (=> hidden local expression)
-   New alias credential (=> hidden local expression with asCredential true)

## [4.0.11] - 2023-06-08

### Added

-   Allow users in roles

### Fixed

-   app crash on bad rest body
-   errors were not shown in output

## [4.0.10] - 2023-05-23

### Fixed

-   help added
-   fixed sql init
-   set a few columns to utf8mb4 for emoticon issues
-   add interval to cleanup 1 day old running jobs
-   better database check error handling, if the database is offline, no create schema button will be shown

### Added

-   Added alias type 'local' => expression, runLocal, hide, noOutput

## [4.0.9] - 2023-05-07

### Added

-   model can now be an array
-   html field

### Fixed

-   form could be executed while non-required fields were being evaluated

### Changed

-   expression field can have newlines, they will be removed.

## [4.0.8] - 2023-05-03

### Added

-   new function fn.fnCidr // core implementation of ip.subnet() <https://www.npmjs.com/package/ip>
-   new function fn.fnTime // core implementation of dayjs() <https://day.js.org>
-   background image on login screen (that you can overwrite)

## [4.0.7] - 2023-05-01

### Fixed

-   Default dependency bug
-   nested placeholder expressions
-   removed google font uri to local
-   awx retry jobs

### Added

-   Added clean up abandoned jobs at startup

## [4.0.5] - 2023-04-15

### Added

-   Allow awx connection with username and password
-   Added about me for
-   Added new env var with regex to filter job output

### Changed

-   Friendlier schema error messages

### Fixed

-   Non admin can see their own approve jobs
-   Wrong stdout with AWX sometimes

## [4.0.3] - 2023-03-06

### Fixed

-   Add select-all box with single column multiselect enum
-   Required not enforced on multiple enum
-   Log view since date-based logfiles
-   enum dropup correct calculation
-   issues with multistep and key
-   add user profile in steps

### Added

-   Add enum horizontal mode
-   Add azure ad oAuth2 login method
-   Add server fn.fnSsh function
-   Showing env.variables in the settings
-   Showing known_hosts and allow removal
-   Added limit property for ansible playbooks

### Changed

-   Moved form backups to subfolder (new ENV VAR)
-   Made backup age configurable (new ENV VAR)
-   New theme look
-   New settings menu
-   Improved joblog navigation, using url params

## [4.0.2] - 2023-02-10

### Added

-   Userobject is available in form with **user** => $(**user**)
-   New field type datetime (date and time picker)

### Changed

-   An object-expression is now possible => "{foo:'bar'}"
-   Bumped corejs and axios

### Fixed

-   Colons failed in password due to bad passport-http
-   Number field was exported as string

## [4.0.1] - 2023-01-27

### Fixed

-   Saving settings error
-   Table field issues

### Added

-   Ansible Galaxy collection community.general
-   TextArea field

### Changed

-   Designer readonly when locked

## [4.0.0] - 2022-12-31

### Fixed

-   Dependencies are now AND not OR
-   Using mysql2 lib to fix authentication issues
-   Fixed AWX Task issue when failed
-   Auto select current form in designer
-   Placeholder with dash bug
-   UTF8 character in extravars breaks local ansible execution

### Added

-   Added dynamic playbook and template name $(extravar)
-   Designer Locking (env var)
-   Pass external data to form
-   Reference Guide
-   Add verbose logging for ansible (verbose: true)
-   Add keepExtravars property to keep the tmp extravars json file

### Changed

-   Better error messages with remote expressions
-   Running extravars from tmp file (due to utf8 issues)
-   Rolling log file

### Deprecated

-   formfield type query is deprecated, use 'enum'

## [3.1.1] - 2022-11-10

### Fixed

-   Ldap certificate bug
-   Drop quotes on string placeholder
-   Expressions were forced to required field
-   Dropping mssql package to v8 hoping to fix hang up issue
-   Dependency bug fixed with multiple dependencies
-   Preview bug fixed when column was empty

### Added

-   Local selectAttr function
-   Local regexBy function
-   Add wildcard support on filterBy function
-   PostActionsEvents
    -   events: onSubmit, onSuccess, onFailure, onFinish
    -   actions with delay: load (a form), reload (same form), home, clear (reset form), hide/show (form)
-   ifExtraVar property on step for conditional step

## [3.1.0] - 2022-10-28

### Added

-   Search functionality forms
-   Full with html
-   Allow "notIn" and "in" validation in tablefields
-   Add nested categories

## [3.0.9] - 2022-10-21

### Fixed

-   Allow password type in tablefield
-   Fixed sql connection problems
-   Fixed filterColumns bug

### Added

-   Added fnArray runLocal functions (filterBy,distinctBy,sortBy)

## [3.0.7] - 2022-09-26

### Added

-   Allow secure connection for mysql

### Changed

-   Updated nodejs packages

## [3.0.6] - 2022-08-10

### Fixed

-   Fixed multiselect bug

## [3.0.5] - 2022-07-06

### Added

-   Add object-like default value for dropdowns
-   Add email notifications
-   Allow custom git user/email per repo

### Fixed

-   Allow selfsigned certificates in mailserver
-   Auto qdd repo hosts to known_hosts + add gui for manually

## [3.0.4] - 2022-06-09

### Fixed

-   Forgot fs-extra in package

### Added

-   Added 'ansibleforms_user' as object to extravars

## [3.0.3] - 2022-06-02

### Changed

-   Improved gui management (table format with paging and filtering)
-   Updated all packages and no-cache build

### Fixed

-   You cannot remove a group with users

## [3.0.2] - 2022-04-25

### Added

-   More form validations
-   Show expression and query form warnings
-   Allow for expression references to have full object placeholder .e.g. $(settings.servers[0].name)

### Changed

-   Rewrote all callbacks to promises
-   Query filter in dropdown

### Fixed

-   Remove query filter on values change
-   Reset query value when "no data"

## [3.0.1] - 2022-04-01

### Added

-   Syslog integration (use env variables to tune)
-   Relaunch and abort from joblog
-   Override repo clone command
-   Add log filtering and auto refresh
-   Approvals and rejections (using new approval property)

### Changed

-   Logger levels changed (error, warning, notice, info, debug) / debug is lowest (silly is deprecated)
-   Completely reworked job launch process (neater code and more reusable)
-   Swagger job launch is now at job level

### Fixed

-   Allow non rsa ssh key
-   Add job access to own jobs in joblog
-   Repo runs silent

### Removed

-   Ansible launch api (see job post now)
-   Awx launch api (see job post now)
-   Multistep launch api (see job post now)

## [3.0.0] - 2022-03-09

### Added

-   About + GPL License
-   Added new type : push to git
-   Added property `key` : allow extravars to be specific key
-   Added extravars to joblog
-   Added awx to joblog
-   Added new type : multistep
-   Added LogViewer
-   Added SSH key autogen + update
-   Added Git repo gui

### Fixed

-   Allow local expressions for query
-   Wrong timezone timestamp in joblog
-   Referencing (placeholder) multi select will now return array

### Removed

-   Awx and ansible get job api => is now native job api
-   Awx and ansible joboutput => is now native job output
-   Ansible and awx job aboort => is now native job abort

## [2.2.4] - 2022-02-15

### Added

-   Allow field named \_\_inventory\_\_ to have array to launch against multiple inventories (ansible only)
-   Add new validation `validIf` and `validIfNot`.  Use an expression field as validation.
-   Add new `refresh` property to manually or auto refresh expression/query fields.
-   Add table enhancements
    -   prepopulate with `query` and `expression`
    -   insertMarker and deleteMarker (to mark deleted or new records)
    -   allowDelete and allowInsert (to allow insert/delete)
    -   readonlyField
            With this table feature you can now load existing data and use table to modify it.  
            The allowInsert set to false will focus on modification only.  
            The deleteMarker set to value of choice, will allow you to use ansible `absent` for deleted records.  
            Read the wiki for more details.

### Fixed

-   Fixed a bug in notIn and in validation
-   Fixed (dependency + expression) bug
-   Fixed execute bug (read proper exit code)
-   Fixed Warning color to orange
-   Removed constants from new form in designer

### Changed

-   Upgrade from fontawesome 5 to 6
-   Label is no longer a required property

## [2.2.3] - 2022-02-11

### Added

-   function fnCredentials(name) to get credentials
-   function fnRestJwtSecure to pass a credential name, the password of the credentials is assumed the token
-   Add noLog property to field for expression and query fields, no expressions, queries and results will be logged.
-   Add new theme

### fixed

-   A clipping visualization improvement

## [2.2.2] - 2022-02-09

### Fixed

-   Dropdown box gets clipped at the bottom (was new bug since 2.2.1)
-   Dependencies either with valueColumn or dot-notation

## [2.2.1] - 2022-02-07

### Added

-   Toggle hidden fields for admins
-   Allow expression debug for admins

### Fixed

-   Ignore error if no forms subdir exists
-   Allow empty constants in designer (must be object bug)

## [2.2.0] - 2022-02-03

### Added

-   Keydown responsiveness on text fields (property `keydown`)
-   filtering to query fields (tune with `filterColumns` property)
-   view of objects and query results
-   queryfield-option in table field (`type: query` + `from`-property)
-   search-replace-box in editor (`ctrl-f` or `ctrl-h`)
-   Forms.yaml can be extended with more yaml files in `/forms` subdir.
-   auto backup on save (from editor)
-   restore backup (from editor)
-   Editor can now edit a single form
-   Added warnings in editor and form
-   Expression can be html (`isHtml` property)
-   Added constants section in forms.yaml (key-value pairs in yaml format)

### Fixed

-   Bad required validation when expression had default empty object or array
-   Interval kept running in the background

## [2.1.6] - 2022-01-25

### Added

-   Expressions can have defaults
-   Extra form checking and show warnings

### Changed

-   Secured JWT tokens even more

### Fixed

-   Fixed editable expression bug
-   Token issue

## [2.1.5] - 2022-01-20

### Added

-   Start with changelog
-   Start with version releases

## [2.1.4] - 2022-01-20

### Added

-   Start with changelog

### Changed

-   Hide AWX token
-   Add AWX ca-bundle for certificate verification
-   JWT tokens, allow multiple devices
-   Expression field can be `editable`

## [2.1.2] - 2022-01-17

### Added

-   Allow rest api search by name for credentials, users and groups

## [2.1.0] - 2022-01-16

### Added

-   Expression can now do a db query using `dbConfig` and `query`

### Changed

-   Fixed visualization bug

## [2.0.0] - 2022-01-13

### Added

-   Added sticky feature to Query field
-   Added pctColumns to Query field
-   Added now sorting description object on fnRestBasic
-   Added now sorting description object on fnReadJson
-   Added now sorting description object on fnReadYaml
-   Added fnRestJwt, rest with token
-   Added fnRestAdvanced, rest with custom headers
-   Added fnJq function, to do json queries
-   Added default definitions for jq (fnRound,fnRound0,fnRound1,fnRound2, fn2KB, fn2MB, fn2GB)
-   Added jq.custom.definitions to allow custom jq definitions
-   Added notIn and in validation

### Removed

-   Sort & Map on fnRestBasic is removed
-   Sort & Map on fnReadYaml is removed
-   Sort & Map on fnReadJson is removed

## [1.2.2] - 2022-01-12

### Added

-   Add custom.js to allow custom expression
-   Start keeping releases in docker-hub

## [1.2.1] - 2022-01-12

### Fixed

-   Ignore AWX certificate errors

## [1.1.9] - 2022-01-11

### Added

-   Allow check and diff in ansible and awx

## [1.1.8] - 2022-01-11

### Added

-   Allow change password for current local user
-   Start tracking versions

[Unreleased]: https://github.com/OpusProjects/ansibleforms/compare/6.1.5...HEAD

[6.1.5]: https://github.com/OpusProjects/ansibleforms/compare/6.1.4...6.1.5

[6.1.4]: https://github.com/OpusProjects/ansibleforms/compare/6.1.3...6.1.4

[6.1.3]: https://github.com/OpusProjects/ansibleforms/compare/6.1.2...6.1.3

[6.1.2]: https://github.com/OpusProjects/ansibleforms/compare/6.1.1...6.1.2

[6.1.1]: https://github.com/OpusProjects/ansibleforms/compare/6.1.0...6.1.1

[6.1.0]: https://github.com/OpusProjects/ansibleforms/compare/6.0.2...6.1.0

[6.0.2]: https://github.com/OpusProjects/ansibleforms/compare/6.0.1...6.0.2

[6.0.1]: https://github.com/OpusProjects/ansibleforms/compare/6.0.0...6.0.1

[6.0.0]: https://github.com/OpusProjects/ansibleforms/compare/5.0.10...6.0.0

[5.0.10]: https://github.com/OpusProjects/ansibleforms/compare/5.0.9...5.0.10

[5.0.9]: https://github.com/OpusProjects/ansibleforms/compare/5.0.8...5.0.9

[5.0.8]: https://github.com/OpusProjects/ansibleforms/compare/5.0.7...5.0.8

[5.0.7]: https://github.com/OpusProjects/ansibleforms/compare/5.0.6...5.0.7

[5.0.6]: https://github.com/OpusProjects/ansibleforms/compare/5.0.5...5.0.6

[5.0.5]: https://github.com/OpusProjects/ansibleforms/compare/5.0.4...5.0.5

[5.0.4]: https://github.com/OpusProjects/ansibleforms/compare/5.0.3...5.0.4

[5.0.3]: https://github.com/OpusProjects/ansibleforms/compare/5.0.2...5.0.3

[5.0.2]: https://github.com/OpusProjects/ansibleforms/compare/5.0.1...5.0.2

[5.0.1]: https://github.com/OpusProjects/ansibleforms/compare/5.0.0...5.0.1

[5.0.0]: https://github.com/OpusProjects/ansibleforms/compare/4.0.19...5.0.0

[4.0.19]: https://github.com/OpusProjects/ansibleforms/compare/4.0.18...4.0.19

[4.0.18]: https://github.com/OpusProjects/ansibleforms/compare/4.0.17...4.0.18

[4.0.17]: https://github.com/OpusProjects/ansibleforms/compare/4.0.16...4.0.17

[4.0.16]: https://github.com/OpusProjects/ansibleforms/compare/4.0.15...4.0.16

[4.0.15]: https://github.com/OpusProjects/ansibleforms/compare/4.0.14...4.0.15

[4.0.14]: https://github.com/OpusProjects/ansibleforms/compare/4.0.13...4.0.14

[4.0.13]: https://github.com/OpusProjects/ansibleforms/compare/4.0.12...4.0.13

[4.0.12]: https://github.com/OpusProjects/ansibleforms/compare/4.0.11...4.0.12

[4.0.11]: https://github.com/OpusProjects/ansibleforms/compare/4.0.10...4.0.11

[4.0.10]: https://github.com/OpusProjects/ansibleforms/compare/4.0.9...4.0.10

[4.0.9]: https://github.com/OpusProjects/ansibleforms/compare/4.0.8...4.0.9

[4.0.8]: https://github.com/OpusProjects/ansibleforms/compare/4.0.7...4.0.8

[4.0.7]: https://github.com/OpusProjects/ansibleforms/compare/4.0.5...4.0.7

[4.0.5]: https://github.com/OpusProjects/ansibleforms/compare/4.0.3...4.0.5

[4.0.3]: https://github.com/OpusProjects/ansibleforms/compare/4.0.2...4.0.3

[4.0.2]: https://github.com/OpusProjects/ansibleforms/compare/4.0.1...4.0.2

[4.0.1]: https://github.com/OpusProjects/ansibleforms/compare/4.0.0...4.0.1

[4.0.0]: https://github.com/OpusProjects/ansibleforms/compare/3.1.1...4.0.0

[3.1.1]: https://github.com/OpusProjects/ansibleforms/compare/3.1.0...3.1.1

[3.1.0]: https://github.com/OpusProjects/ansibleforms/compare/3.0.9...3.1.0

[3.0.9]: https://github.com/OpusProjects/ansibleforms/compare/3.0.7...3.0.9

[3.0.7]: https://github.com/OpusProjects/ansibleforms/compare/3.0.6...3.0.7

[3.0.6]: https://github.com/OpusProjects/ansibleforms/compare/3.0.5...3.0.6

[3.0.5]: https://github.com/OpusProjects/ansibleforms/compare/3.0.4...3.0.5

[3.0.4]: https://github.com/OpusProjects/ansibleforms/compare/3.0.3...3.0.4

[3.0.3]: https://github.com/OpusProjects/ansibleforms/compare/3.0.2...3.0.3

[3.0.2]: https://github.com/OpusProjects/ansibleforms/compare/3.0.1...3.0.2

[3.0.1]: https://github.com/OpusProjects/ansibleforms/compare/3.0.0...3.0.1

[3.0.0]: https://github.com/OpusProjects/ansibleforms/compare/2.2.4...3.0.0

[2.2.4]: https://github.com/OpusProjects/ansibleforms/compare/2.2.3...2.2.4

[2.2.3]: https://github.com/OpusProjects/ansibleforms/compare/2.2.2...2.2.3

[2.2.2]: https://github.com/OpusProjects/ansibleforms/compare/2.2.1...2.2.2

[2.2.1]: https://github.com/OpusProjects/ansibleforms/compare/2.2.0...2.2.1

[2.2.0]: https://github.com/OpusProjects/ansibleforms/compare/2.1.6...2.2.0

[2.1.6]: https://github.com/OpusProjects/ansibleforms/compare/2.1.5...2.1.6

[2.1.5]: https://github.com/OpusProjects/ansibleforms/compare/2.1.4...2.1.5
