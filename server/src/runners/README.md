# Runners and the RTE

Developer notes on where AnsibleForms runs a job. From v7 on the app runs nothing itself:
every job runs on a **runner**, a row of the `runners` table with a type.

| Type | Runs | What it is |
|---|---|---|
| `rte` | playbooks (`type: ansible` forms) | a runtime environment container: this server started with `AF_ROLE=rte`, image `ghcr.io/ansibleforms/ansibleforms-rte` |
| `awx` | templates (`type: awx` forms) | AWX / Ansible Automation Platform / Ascender |
| later: `semaphore`, `rundeck` | | one adapter file each |

## Why

Until v6 a playbook ran as a child process of the app container, and AWX was wired into
`job.model.js` in its own way. Customers could not change the runtime (collections, python
packages, ssh setup) without rebuilding the app image, the app could not scale, and every new
target would have been another special case. Now there is one interface for every target,
and a runtime container customers fork and rebuild, which gives **exactly the same result**
as the old local runs: it is the same code.

## The idea in one picture

```
 browser ──▶ app (AF_ROLE=app)                           RTE (AF_ROLE=rte)
             │ Job.launch ─▶ orchestrator                 │
             │               ├─ approval gate             │
             │               └─ runner.launch(ctx)        │
             │                    ├─ rte ─▶ POST /rte/v1/jobs ───▶ runAnsibleJob(jobId)
             │                    └─ awx ─▶ AWX API, output tracked back
             ▼                                                     ▼
        ┌──────────────────────── MySQL (shared) ─────────────────────────┐
        │ jobs (row = the input, status, abort flag, runner, job_log)      │
        │ job_output (lines) ; credentials, secret_stores (ENCRYPTION_SECRET) │
        └──────────────────────────────────────────────────────────────────┘
```

Three choices carry the design:

1. **The RTE is this same server, started in another role** (`AF_ROLE=rte`). It shares the
   models, the database layer, the credential resolver and the secret stores, and it holds
   the only code that runs a playbook (`rte/ansible-core.js`). `index.js` loads only the
   modules of its role: an RTE never loads the web app, the app never loads ansible-core.
2. **The database is the bus.** The RTE has the app's database settings and the same
   `ENCRYPTION_SECRET`. It reads the job row, resolves the credentials itself, and writes the
   output lines, the job log and the final status into the database. The browser polls the
   job from the database every 2 seconds, so live output needs no streaming mechanism, and
   secrets never travel over the RTE API.
3. **A job is fully described by its row.** `runAnsibleJob({ jobId })` needs nothing else:
   extravars and credential *names* are in the row, the rest is resolved at run time.

## Code map

| File | What it does |
|---|---|
| `runners/index.js` | The registry: `RUNNERS = { awx, rte }`, `RUNNER_TYPES`, `getRunner(type)`. |
| `runners/orchestrator.js` | Between "the job may start" and "a runner runs it": the approval gate (the `APPROVE [...]` line, status `approve`, the notification), `resolveRunner`, `dispatch` (writes `jobs.runner`). |
| `runners/rte.js` | App side of an RTE: health/version check, hand-over (`POST /rte/v1/jobs`), wait for the row's status, cancel. |
| `runners/awx/index.js` | The awx runner: launch, cancel, check. |
| `runners/awx/api.js` | The AWX API calls and the output tracking (`Awx.launch`, `launchTemplate`, `trackJob`, `trackWorkflowJob`, `abortJob`, the `find*ByName` lookups), all taking the runner row. |
| `rte/server.js` | The RTE: its API, the job claim, its own clean-up. |
| `rte/ansible-core.js` | The one place a playbook runs: `runAnsibleJob`, `buildAnsibleArgs` (no shell), `executeCommand` (process group, abort flag, output limit, job log). |
| `models/runner.model.js` | The `runners` table: per-type validation, one default per type, masked secrets. |
| `models/job.model.js` | `Job.launch`, `Job.continue` (approval), multistep, notifications, `Job.lastOrder`. |
| `/Dockerfile.rte`, `/examples/rte/Dockerfile.minimal` | The published RTE image (everything the app image had in v6) and a minimal fork template. |

### The runner contract

```js
runner = {
  type: 'rte' | 'awx' | ...,
  capabilities: { playbook: Boolean, template: Boolean },
  check(row) -> Promise<details>,    // the Runners page's Test connection, and the Status page
  launch(ctx) -> Promise<boolean>,   // resolves when the job has ENDED (a multistep waits on it)
  cancel(ctx) -> Promise<void>,      // the fast path ; the abort flag always works too
}
ctx = { jobId, jobType, extravars, credentialMap, runner /* the row, secrets decrypted */ }
```

The approval gate is never a runner's business: a job reaches `launch` only once it may run.
Multistep stays in `job.model.js`; each step is a child job that goes through the same path,
so steps can name different runners.

## Where a job runs

`resolveRunner`, in this order:

| The form says | A runner of the job's type is *Default* | The job runs |
|---|---|---|
| `runner: <name>` (or the deprecated `awx: <name>`) | (ignored) | on that runner; it must be able to run the job (an rte runs playbooks, an awx runs templates), and a name nobody added fails the job with "No runner named ..." |
| nothing | yes | on the default runner of the matching type (`rte` for playbooks, `awx` for templates) |
| nothing | no | nowhere: the job fails with "No runner to run this playbook : add one of type rte ..." |

`awx: <name>` logs a deprecation warning once per name; it is removed in 8.

## The life of a playbook job

1. `Job.launch` builds the extravars and inserts the `jobs` row (status `running`). From
   here the row is the input.
2. `orchestrator.dispatch`: with an approval and not yet approved, the gate writes the
   `APPROVE` line, sets status `approve` and stops. `Job.approve` → `Job.continue` writes the
   extravars it continues with back to the row, then dispatches again with `approved`.
3. `resolveRunner` picks the runner; `jobs.runner` records it.
4. The app writes `ok: [Running on RTE <name> (<url>)]`, posts the job id, and polls the row
   once a second until the status is final. The RTE claims the job
   (`UPDATE jobs SET host=<its name> WHERE id=? AND status='running' AND host IS NULL`), then runs
   `runAnsibleJob(jobId)`.
5. Output: every chunk becomes a `job_output` row; `order` continues from `MAX(order)` in the
   database (`Job.lastOrder`), so two writers (app then RTE) never collide. A
   `.joblogs/job_log_<id>.log` the playbook writes is stored in `jobs.job_log` every 2 seconds
   and at the end, then removed.
6. End: `Job.endJobStatus` writes the last line, the status and sends the status mail.

### Abort

`Job.abort` sets `jobs.abort_requested` and calls the runner's `cancel` (`jobs.runner` says
which). An RTE stops the playbook's process group at once; AWX cancels its job. The flag is
the fallback: the RTE sees it on the next output line or within 2 seconds, the AWX tracker on
its next poll. When AWX answers the tracker's own cancel with 405 (already cancelling), the job
ends `aborted`.

### Who cleans up what

`jobs.host` holds who runs a job: the RTE's name, `rte-<hostname>-<port>`; nothing for AWX
jobs. The name needs no setting: two RTEs on one machine listen on different ports, and a
restarted RTE keeps its name.

- App start (and hourly): abandons jobs left `running` that no RTE claimed (`host IS NULL`).
  An RTE job carries on when the app restarts.
- RTE start (and hourly for jobs older than a day): abandons only the jobs carrying its own
  name.

## The RTE API

All calls need `Authorization: Bearer <RTE_TOKEN>`.

| Call | Answer |
|---|---|
| `GET /rte/v1/health` | `{ id, version, contract, ansible, running: [jobIds] }` |
| `POST /rte/v1/jobs` `{ jobId }` | `202` accepted; `404` unknown job; `409` not running, or claimed by another runner |
| `GET /rte/v1/jobs/:id` | `running`, `finished` (+ `jobStatus`), or `unknown` |
| `POST /rte/v1/jobs/:id/cancel` | `202`; `409` when this RTE does not run it |

### Updating an RTE

An RTE does not have to follow every app release. The app and the RTE agree on a **contract**
(`server/src/rte/contract.js`): the RTE API and what the RTE reads and writes in the database.
As long as both speak the same contract, an RTE you tested and approved keeps working with newer
app releases; Test connection and the Status page show its release next to the app's, in green.

The contract number goes up only when a change would break older RTEs, and the release notes
then say *RTEs must be updated*. Until you update them, Test connection refuses them with that
reason and the Status page shows them in red. The RTE image is still published with every
release, so its tags always match the app's.

## Using a runner, step by step

1. **Start an RTE** (see [Running it](#running-it)) with the app's database settings, the
   app's `ENCRYPTION_SECRET` and a token (`RTE_TOKEN`).
2. **Add it**: Connections > Runners > add, type *RTE*, its address and the same token.
   *Test connection* shows its version and ansible version. An AWX/AAP connection is a
   runner of type *AWX* (a token, or *Use credentials* with a username and password); the v7
   upgrade moves the existing AAP connections there.
3. **Point forms at it**: `runner: <name>` on a form or a step (also in the designer's form
   settings), or tick *Default* on the runner.

## Where the token lives

| Side | Where | How |
|---|---|---|
| RTE | the environment variable `RTE_TOKEN` of the RTE container | `-e RTE_TOKEN=...`, a compose `environment:` entry or a Kubernetes secret. The RTE refuses to start without one of at least 16 characters. |
| App | the `token` of the runner row | typed on the Runners page, or `token: ${SOME_ENV}` in the config seed. Stored encrypted with `ENCRYPTION_SECRET`; the API only ever shows `********`. |

It is not an environment variable of the app: every runner row has its own token, so every
RTE can have a different one. A wrong token fails the job with "the RTE ... refused the token".
In dev the `dev:rte` script uses `dev-rte-token-not-a-secret`; never outside a dev machine.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `AF_ROLE` | RTE | `app` (default) or `rte` |
| `RTE_TOKEN` | RTE | the token every call must carry; the app holds the same value on the runner row |
| `DB_*`, `ENCRYPTION_SECRET` | RTE | the app's own values |
| `ANSIBLE_PATH`, `PROCESS_MAX_BUFFER`, `REPO_PATH`, `HOME_PATH`, `UPLOAD_PATH` | RTE | where its playbooks, repositories, SSH key and uploads are |
| `PORT`, `HTTPS`, `HTTPS_CERT`, `HTTPS_KEY` | RTE | as for the app |
| `AWX_API_PREFIX` | app | the AWX API prefix for the awx runners |

All are in `server/help.yaml`. The RTE ones are kept off the app's settings page on purpose:
they describe the process, not a setting.

## Running it

**On a dev machine:** `npm run dev` (in the repository root) starts the client, the app and an
RTE next to it on port 8010. Both use `server/.env.development`, so they share the
database and the folders. Then once: Connections > Runners > add a runner `rte-dev`, type RTE, uri
`http://127.0.0.1:8010`, token `dev-rte-token-not-a-secret`, tick *Default*. More RTEs:
`PORT=8011 npm run dev:rte` in another terminal, and another row.

| Script (root) | Starts |
|---|---|
| `npm run dev` | client + app + an RTE on 8010 |
| `npm run dev:local` | client + app only (playbook forms then need another runner) |
| `npm run dev:rte` | the RTE alone |

**As a container:**

```bash
docker run -d --name rte -p 8010:8000 \
  -e DB_HOST=... -e DB_PORT=3306 -e DB_USER=... -e DB_PASSWORD=... \
  -e ENCRYPTION_SECRET=<the app's> -e RTE_TOKEN=<token> \
  -v <playbooks or repositories>:/app/dist/persistent/playbooks \
  -v <the app's .ssh>:/root/.ssh:ro \
  ghcr.io/ansibleforms/ansibleforms-rte:7
```

Customers make it their own by forking `Dockerfile.rte` (the full flavour) or
`examples/rte/Dockerfile.minimal` (ansible-core only) and adding
`RUN ansible-galaxy collection install ...` / `pip install ...`.

## Security

- Only the app talks to an RTE: every call carries the runner's token, anything else is 401.
  The RTE has no users, no login and no web pages; `HTTPS=1` works as for the app. Keep it off
  the public network.
- Even with the token the API can only start a job that already exists and is `running`,
  report its status, cancel it, and answer health. It cannot create jobs, read credentials or
  return output.
- The RTE holds the database password and `ENCRYPTION_SECRET`: it is as trusted as the app.
  Every RTE can have its own token, and it cleans up only the jobs carrying its own name.

## Known limits

- The RTE uses its own disk for playbooks, repositories, the SSH key and uploads: mount the
  app's folders, or run it on the same machine. (Planned: SSH key and known_hosts in the
  database, the RTE cloning the playbooks repository itself.)
- A form's `playbookSubPath` must exist on the RTE; a missing folder shows as
  `ENOENT ... extravars_<id>.json`.
- A different `ENCRYPTION_SECRET` on the RTE is not detected yet: credentials would decrypt to
  garbage (aes-256-ctr has no integrity check).
- A multistep job whose app restarts mid-run is abandoned (the step loop lives in the app); a
  step already handed to an RTE still finishes.

## Later

Semaphore and Rundeck adapters; `findDefault` by capability once a second playbook-capable
type exists; a worker role (`AF_ROLE=worker`: scheduler, repository sync, job tracking) so the
app can run replicas, with the designer lock moved to the database. No Redis: access tokens are
stateless JWTs (`ACCESS_TOKEN_SECRET` identical on every node), refresh tokens are in the
`tokens` table, sessions are `cookie-session`.

## Tests

- `tests/rte-ansible.test.mjs` - a job run from its row (credentials, vault, sub path, failure
  lines, output order, the job log), the ansible arguments, the approval gate, which runner a
  job goes to (per-type default, `runner:`, `awx:` alias, capabilities, no runner).
- `tests/job-abort-remote.test.mjs` - abort through the flag, no shell, process group, vault
  password on stdin, the output limit.
- `tests/awx-workflow.test.mjs` - AWX tracking against a fake AWX, incl. the 405 cancel.
- `tests/runner-model.test.mjs` - per-type validation and default, masked secrets.
- `tests/schema-patch8.test.mjs` - the awx table moving into runners.
- `tests/health.test.mjs`, `tests/config-seed.test.mjs` - the runners check and seed section.
