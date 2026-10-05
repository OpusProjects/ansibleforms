# Runners and the RTE

Developer notes on where AnsibleForms runs a job, and on the **RTE** (runtime environment):
a second container that runs playbooks for the app. This is work in progress in 7.x; the
state of each part is listed under [Status](#status).

## Why

Until 7.1 a playbook job ran in exactly one place: `ansible-playbook` as a child process of
the app container. AWX/AAP was the only alternative, and it was wired into `job.model.js`
in its own way. That has three problems:

- Customers cannot change the runtime (collections, python packages, ssh setup) without
  rebuilding the app image.
- The app cannot scale: a running playbook lives inside the app process.
- Every new target (Semaphore, Rundeck) would mean another special case in `job.model.js`.

The goal is one interface for every target, and a runtime container that customers fork
and rebuild, which gives **exactly the same result** as running locally.

| Target | Today | Later |
|---|---|---|
| `local` | default in 7.x | removed in 8 (the app image becomes node-only) |
| `rte` | preview | the replacement for `local`; several RTEs side by side (vmware, network, storage, ...) |
| `awx` | as before, now behind the runner interface | unchanged |
| `semaphore`, `rundeck` | — | one adapter file each |

## The idea in one picture

```
 browser ──▶ app (AF_ROLE=app)                          RTE (AF_ROLE=rte)
             │                                           │
             │ Job.launch ─▶ orchestrator                │
             │               ├─ approval gate            │
             │               └─ runner.launch(ctx)       │
             │                    ├─ local ─▶ runAnsibleJob(jobId) ─┐
             │                    ├─ awx   ─▶ AWX API               │
             │                    └─ rte   ─▶ POST /rte/v1/jobs ───▶│ runAnsibleJob(jobId)
             │                                                      │
             ▼                                                      ▼
        ┌──────────────────────── MySQL (shared) ─────────────────────────┐
        │ jobs (row = the input, status, abort flag)   job_output (lines)  │
        │ credentials, secret_stores (resolved with ENCRYPTION_SECRET)     │
        └──────────────────────────────────────────────────────────────────┘
```

Three choices carry the design:

1. **The RTE is this same server, started in another role** (`AF_ROLE=rte`). It shares the
   models, the database layer, the credential resolver, the secret stores and the code that
   runs a playbook. "100% the same result" is then a property of the code, not of two
   implementations kept in sync by hand.
2. **The database is the bus.** The RTE has the app's database settings and the same
   `ENCRYPTION_SECRET`. It reads the job row, resolves the credentials itself, and writes the
   output lines and the final status straight into `job_output` / `jobs`, exactly like the
   local runner. The browser already polls the job from the database every 2 seconds, so
   live output needs no new streaming mechanism. Secrets never travel over the RTE API.
3. **A job is fully described by its row.** `runAnsibleJob({ jobId })` needs nothing else:
   extravars and credential *names* are in the row, the rest is resolved at run time. That is
   what lets the same function run in the app or in an RTE.

## Code map

| File | What it does |
|---|---|
| `runners/ansible-core.js` | The one place a playbook runs. `runAnsibleJob({ jobId })` reads the row, resolves credentials (`__credentials__`, `__ansibleCredentials__`, `__vaultCredentials__`), writes the extravars files, spawns `ansible-playbook`, streams output to `job_output`, ends the job. Also `buildAnsibleArgs`, `executeCommand`, `lastOrder`, `resolvePlaybookDirectory`, `runnerIdentity`. |
| `runners/orchestrator.js` | Between "the job may start" and "a runner runs it": the approval gate (the `APPROVE [...]` line, status `approve`, the notification), then `resolveRunner` and `runner.launch`. |
| `runners/index.js` | The registry: `RUNNERS = { local, awx, rte }`, `getRunner(type)`. |
| `runners/local.js` | `launch = runAnsibleJob` in the app's own container. |
| `runners/awx.js` | Adapter over the existing `Awx.*` code in `job.model.js`. |
| `runners/rte.js` | App side of the RTE: hands the job over (`POST /rte/v1/jobs`), then waits for the row's status to leave `running`. |
| `rte/server.js` | RTE side: the small API, the job claim, its own clean-up. |
| `models/job.model.js` | Still owns `Job.launch`, `Job.continue` (approval), multistep, notifications and the AWX tracking. |
| `index.js` | `AF_ROLE=rte` starts `rte/server.js` instead of the app. |
| `/Dockerfile.rte` | The RTE image: same base image as the app, server only, `ENV AF_ROLE=rte`. |

### The runner contract

```js
runner = {
  type: 'local' | 'awx' | 'rte' | ...,
  capabilities: { playbook: Boolean, template: Boolean },
  launch(ctx) -> Promise<boolean>,   // resolves when the job has ENDED (a multistep waits on it)
  cancel(ctx) -> Promise<void>,      // optional fast path ; the abort flag always works too
}
ctx = { jobId, jobType, extravars, credentialMap }
```

The approval gate is never a runner's business: a job reaches `launch` only once it may run.
Multistep stays in `job.model.js`; each step is a child job that goes through the same path.

## The life of a playbook job

1. `Job.launch` builds the extravars (`pushForminfoToExtravars`) and inserts the `jobs` row
   (status `running`). From here the row is the input.
2. `orchestrator.dispatch`: with an approval and not yet approved, the gate writes the
   `APPROVE` line, sets status `approve` and stops. `Job.approve` → `Job.continue` writes
   the extravars it continues with back to the row, then dispatches again with `approved`.
3. `resolveRunner` picks the runner (preview: `rte` when `RTE_URL` is set, else `local`).
4. **local**: `runAnsibleJob(jobId)` in the app process.
   **rte**: the app writes `ok: [Running on RTE <url>]`, posts the job id, and polls the row
   once a second until the status is final. The RTE claims the job
   (`UPDATE jobs SET host=<RTE_ID> WHERE id=? AND status='running' AND host IS NULL`), then runs
   `runAnsibleJob(jobId)` - the same function.
5. Output: every chunk becomes a `job_output` row; `order` continues from
   `MAX(order)` in the database, so two writers (app then RTE) never collide.
6. End: `Job.endJobStatus` writes the last line, the status and sends the status mail.

### Abort

`Job.abort` sets `jobs.abort_requested`. The process running the playbook - wherever it
is - sees the flag on its next output line, or within 2 seconds for a quiet playbook, and
stops the playbook's whole process group (`ansible-playbook` runs without a shell, in its own
group). For an RTE the app also calls `POST /rte/v1/jobs/:id/cancel`, which stops it at once;
the flag is the fallback when the RTE is briefly unreachable.

### Who cleans up what

`jobs.host` holds who runs a job: the app's hostname for local jobs, `RTE_ID` for RTE jobs.

- App start (and hourly): abandons jobs left `running` with `host` empty or its own hostname.
  An RTE job carries on when the app restarts.
- RTE start (and hourly for jobs older than a day): abandons only jobs with its own `RTE_ID`.
  Give every RTE a different `RTE_ID` (default `rte-<hostname>`).

## The RTE API

All calls need `Authorization: Bearer <RTE_TOKEN>`.

| Call | Answer |
|---|---|
| `GET /rte/v1/health` | `{ id, version, ansible, running: [jobIds] }` |
| `POST /rte/v1/jobs` `{ jobId }` | `202` accepted; `404` unknown job; `409` not running, or claimed by another runner |
| `GET /rte/v1/jobs/:id` | `running`, `finished` (+ `jobStatus`), or `unknown` |
| `POST /rte/v1/jobs/:id/cancel` | `202`; `409` when this RTE does not run it |

Prefix `/rte/v1`, not `/api/v1`: the app's API v1 was removed in 7.0, and the RTE API is
versioned on its own.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `AF_ROLE` | both | `app` (default) or `rte` |
| `RTE_TOKEN` | both | the shared bearer token (at least 16 characters); the RTE refuses to start without it |
| `RTE_ID` | RTE | its name in `jobs.host`; default `rte-<hostname>` |
| `RTE_URL` | app | **preview**: when set, every playbook job runs on this RTE |
| `RTE_IGNORE_CERTS` | app | **preview**: `1` accepts a self-signed RTE certificate |
| `DB_*`, `ENCRYPTION_SECRET` | RTE | the app's own values - the RTE resolves credentials with them |
| `PORT`, `HTTPS`, `HTTPS_CERT`, `HTTPS_KEY` | RTE | as for the app |

All are documented in `server/help.yaml`. They are kept off the app's settings page on
purpose: they describe the process, not a setting.

## Running it

**On a dev machine:** `npm run dev` (in the repository root) starts the client, the app and
an RTE next to it (`rte-dev` on port 8010), and points the app at that RTE - every playbook
job runs there. Both use `server/.env.development`, so they share the database and the
folders (playbooks, SSH key). `npm run dev:local` is the old setup, without an RTE.

| Script (root) | Starts |
|---|---|
| `npm run dev` | client + app (with `RTE_URL=http://127.0.0.1:8010`) + RTE on 8010 |
| `npm run dev:local` | client + app, playbooks run in the app |
| `npm run dev:rte` | the RTE alone |

The dev token in these scripts (`dev-rte-token-not-a-secret`) is for a dev machine only.
A job's output starts with `ok: [Running on RTE http://127.0.0.1:8010]` when the RTE ran it.

**As a container:**

```bash
docker build -f Dockerfile.rte -t ansibleforms-rte .
docker run -d --name rte -p 8010:8000 \
  -e DB_HOST=... -e DB_PORT=3306 -e DB_USER=... -e DB_PASSWORD=... \
  -e ENCRYPTION_SECRET=<the app's> -e RTE_TOKEN=<token> -e RTE_ID=rte-1 \
  -v <playbooks or repositories>:/app/dist/persistent/playbooks \
  -v <the app's .ssh>:/root/.ssh:ro \
  ansibleforms-rte
```

Customers make it their own by forking `Dockerfile.rte` and adding
`RUN ansible-galaxy collection install ...` / `pip install ...` after the final `FROM`.

## Status

| Part | State |
|---|---|
| (a) Abort through the database; `ansible-playbook` without a shell, in its own process group | merged (#578) |
| (b) `ansible-core.js`, runner interface, orchestrator | this branch, PR to follow |
| RTE preview: role, API, adapter, `Dockerfile.rte` | this branch, **not for merge** |
| (d) SSH key and known_hosts in the database; the `.joblogs` file stored on the job | planned - until then an RTE container needs the app's `.ssh` mounted |
| (c) `runners` table and Runners page, form property `runner:` (with `awx:` as alias), AWX tracking that survives an app restart | planned - replaces `RTE_URL` / `RTE_IGNORE_CERTS` |
| (e) The RTE for real: own clone of the playbooks repository, uploads check, version and `ENCRYPTION_SECRET` check on connect, image published as `ansibleforms-rte` | planned |
| Semaphore, Rundeck adapters; a worker container (scheduler, tracking) so the app can run replicas | later |

### Known limits of the preview

- One RTE, chosen by `RTE_URL`; every playbook job goes there.
- The RTE uses its own disk for playbooks, repositories, the SSH key and uploads: mount the
  app's folders, or run it on the same machine.
- A different `ENCRYPTION_SECRET` on the RTE is not detected yet: credentials would decrypt
  to garbage (aes-256-ctr has no integrity check). Use the app's value.
- A multistep job whose app restarts mid-run is abandoned (the step loop lives in the app);
  a step already handed to an RTE still finishes.

## Tests

- `tests/job-abort-remote.test.mjs` - abort through the flag, no shell, process group,
  vault password on stdin, the output limit.
- `tests/runner-local.test.mjs` - a job run from its row (credentials, hidden credentials,
  vault, sub path, failure lines, output order), the ansible arguments, the approval gate.
- `tests/awx-workflow.test.mjs` - unchanged; AWX tracking still passes through `Awx.*`.

`ansible-playbook` is replaced by a fake process in these tests; the real thing was run by
hand (vault variable, two inventories, a value with quotes and spaces, abort of a real
process group).
