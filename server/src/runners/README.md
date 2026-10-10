# Runners and the RTE

Developer notes on where AnsibleForms runs a job. From v7 on the app runs nothing itself:
every job runs on a **runner**, a row of the `runners` table with a type.

| Type | Runs | What it is |
|---|---|---|
| `rte` | playbooks (`type: ansible` forms) | a runtime environment container: this server started with `AF_ROLE=rte`, image `ghcr.io/ansibleforms/ansibleforms-rte-full` (or `-rte-core`, `-rte-base`) |
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
 browser ──▶ app (AF_ROLE unset or app)                 RTE (AF_ROLE=rte)
             │ Job.launch ─▶ orchestrator                 │
             │               ├─ approval gate             │
             │               └─ runner.launch(ctx)        │
             │                    ├─ rte ─▶ POST /rte/v1/jobs ───▶ runAnsibleJob(jobId)
             │                    └─ awx ─▶ AWX API, output tracked back
             ▼                                                     ▼
        ┌──────────────────────── MySQL (shared) ─────────────────────────┐
        │ jobs (row = the input, status, abort flag, runner, job_log)      │
        │ job_output (lines) ; credentials, secret_stores : read by the app   │
        └──────────────────────────────────────────────────────────────────┘
```

Three choices carry the design:

1. **The RTE is this same server, started in another role** (`AF_ROLE=rte`). It shares the
   models and the database layer, and it holds the only code that runs a playbook
   (`rte/ansible-core.js`). `index.js` loads only the
   modules of its role: an RTE never loads the web app, the app never loads ansible-core.
2. **The database is the bus.** The RTE has the app's database settings. It reads the job row
   and writes the output lines, the job log and the final status into the database. The
   browser polls the job from the database every 2 seconds, so live output needs no
   streaming mechanism.
3. **The app resolves the secrets, the RTE never does.** At hand-over the app resolves the
   job's credential map, its ansible login and its vault password (`lib/jobSecrets.js`, from
   the credentials table and the secret stores) and sends them with the job, sealed with
   AES-256-GCM under a key derived from the RTE's token and the job id
   (`lib/sealedSecrets.js`). The bundle opens for that RTE and that job only, also over plain
   http. The RTE never reads the credentials table nor a secret store, and needs
   `ENCRYPTION_SECRET` only to register itself (its token is stored encrypted).

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
| `/Dockerfile.rte-base`, `/Dockerfile.rte-core`, `/Dockerfile.rte-full`, `/examples/rte` | The RTE images in three layers - the base (no python, no ansible), core (ansible-core and the essentials), full (the ansible package with collections and what the v6 image had) - and examples to build your own on them. |

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
   (`UPDATE jobs SET host=<its name> WHERE id=? AND status='running' AND job_type='ansible' AND
   (host IS NULL OR host=<its name>)` - a repeated call is harmless, an AWX job or a multistep is
   never taken), then runs `runAnsibleJob({ jobId, secrets })`. The app sends its contract and
   the sealed secrets with the job id; an RTE of another contract refuses it, and so does one
   whose bundle does not open (another token, another job) - before it claims anything. When the POST gets no answer, the app follows the job if
   the RTE claimed it, and fails it only if not.
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

Every process writes a heartbeat in `nodes` (RTEs too). A job belongs to the RTE running it
(`jobs.host`), otherwise to the app node or worker that started it (`jobs.tracker`).

- App node or worker start: abandons the jobs it followed itself (`tracker` = its name, no
  `host`). An RTE job carries on when the app restarts.
- RTE start: abandons the jobs carrying its own name. Hourly: those older than a day, except
  what it is running right now.
- The worker, every minute: abandons the jobs of any node (RTE or app) whose heartbeat is two
  minutes old - a pod replaced under a new name included - and releases the repository and
  schedule claims those nodes held. Hourly: jobs older than a day that nobody owns.

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

1. **Start an RTE** (see [Running it](#running-it)) with the app's database settings and a
   token (`RTE_TOKEN`), plus the app's `ENCRYPTION_SECRET` when it registers itself.
2. **It adds itself**: an RTE registers itself under Connections > Runners when it starts
   (`RTE_REGISTER=1`, the default), at `RTE_URL` or else at its own IP address and port, and
   the first one becomes the default. The Runners page shows it as *automatic*, or
   *unresponsive* once it stopped answering ; the worker removes it 10 minutes later. To
   manage runners yourself, set `RTE_REGISTER=0` and add it: Connections > Runners > add,
   type *RTE*, its address and the same token. *Test connection* shows its version and
   ansible version. An AWX/AAP connection is a
   runner of type *AWX* (a token, or *Use credentials* with a username and password); the v7
   upgrade moves the existing AAP connections there.
3. **Point forms at it**: `runner: <name>` on a form or a step (also in the designer's form
   settings), or tick *Default* on the runner.

## Where the token lives

| Side | Where | How |
|---|---|---|
| RTE | the environment variable `RTE_TOKEN` of the RTE container | `-e RTE_TOKEN=...`, a compose `environment:` entry or a Kubernetes secret. The RTE refuses to start without one of at least 16 characters. |
| App | the `token` of the runner row | written by the RTE when it registers itself, typed on the Runners page, or `token: ${SOME_ENV}` in the config seed. Stored encrypted with `ENCRYPTION_SECRET`; the API only ever shows `********`. |

It is not an environment variable of the app: every runner row has its own token, so every
RTE can have a different one. A wrong token fails the job with "the RTE ... refused the token".
In dev the `dev:rte` script uses `dev-rte-token-not-a-secret`; never outside a dev machine.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `AF_ROLE` | RTE | `rte` (set in the image); the app is `all` (unset), `app` or `worker` - see [examples/scale](../../../examples/scale) |
| `RTE_TOKEN` | RTE | the token every call must carry; the app holds the same value on the runner row |
| `RTE_REGISTER` | RTE | 1 (default): the RTE adds itself as a runner ; 0: add it by hand |
| `RTE_URL` | RTE | the address the app reaches it on (`http://rte:8000`) ; unset: its IP address and port |
| `DB_*` | RTE | the app's own values |
| `ENCRYPTION_SECRET` | RTE | the app's own value, to store its token when it registers itself ; not needed with `RTE_REGISTER=0` |
| `ANSIBLE_PATH`, `PROCESS_MAX_BUFFER`, `REPO_PATH`, `HOME_PATH`, `UPLOAD_PATH` | RTE | where its playbooks, repositories, SSH key and uploads are |
| `PORT`, `HTTPS`, `HTTPS_CERT`, `HTTPS_KEY` | RTE | as for the app |
| `AWX_API_PREFIX` | app | the AWX API prefix, added to an awx runner uri without an `/api/` path (a uri may carry it : `https://aap.example.com/api/controller/v2`) |

All are in `server/help.yaml`. The RTE ones are kept off the app's settings page on purpose:
they describe the process, not a setting.

## Running it

**On a dev machine:** `npm run dev` (in the repository root) starts the client, the app and an
RTE next to it on port 8010. Both use `server/.env.development`, so they share the
database and the folders. The RTE adds itself as runner `127.0.0.1-8010` (`RTE_URL` is
`http://127.0.0.1:8010`), or keeps a row you made at that address. More RTEs:
`PORT=8011 npm run dev:rte` in another terminal ; each adds itself.

| Script (root) | Starts |
|---|---|
| `npm run dev` | client + app + an RTE on 8010 |
| `npm run dev:local` | client + app only (playbook forms then need another runner) |
| `npm run dev:rte` | the RTE alone |

**As a container:**

```bash
docker run -d --name rte -p 8010:8000 \
  -e DB_HOST=... -e DB_PORT=3306 -e DB_USER=... -e DB_PASSWORD=... \
  -e ENCRYPTION_SECRET=<the app's, to register itself> -e RTE_TOKEN=<token> -e RTE_URL=http://<this host>:8010 \
  -v <playbooks or repositories>:/app/dist/persistent/playbooks \
  -v <the app's .ssh>:/home/node/.ssh:ro \
  ghcr.io/ansibleforms/ansibleforms-rte-full:7
```

Customers make it their own by building FROM one of the three layers:
- `ansibleforms-rte-base`, with their own python and ansible ;
- `ansibleforms-rte-core`, adding `RUN ansible-galaxy collection install ...` / `pip install ...` ;
- `ansibleforms-rte-full`, ready to run with the ansible package, its collections and what the 6.5 image had.

See [examples/rte](../../../examples/rte).

## Security

- Every call to an RTE carries the runner's token; anything else is 401. Nothing else restricts
  who may call it - no address list, no client certificate - so keep it off the public network.
  The RTE has no users, no login and no web pages; `HTTPS=1` works as for the app (with the
  app's template certificate unless you mount your own: tick *Ignore certificates* on the
  runner, or give it the CA).
- A fake RTE (a runner pointed at another address) receives the jobs, with their secrets: only
  admins can change a runner. The app fails a job once its RTE answers `unknown` twice.
- Even with the token the API can only start a job that already exists and is `running`,
  report its status, cancel it, and answer health. It cannot create jobs, read other jobs'
  credentials or return output.
- The RTE holds the database password, and `ENCRYPTION_SECRET` only when it registers itself.
  It gets the secrets of the jobs it runs, never the others. Every RTE can have its own token,
  and it cleans up only the jobs carrying its own name.
- A runner receives the secrets of every job it runs, so only the admin role adds, changes or
  deletes runners; users with settings access see and test them.

## Known limits

- The RTE uses its own disk for playbooks, repositories, the SSH key and uploads: mount the
  app's folders, or run it on the same machine. (Planned: SSH key and known_hosts in the
  database, the RTE cloning the playbooks repository itself.)
- A form's `playbookSubPath` must exist on the RTE; a missing folder fails the job with the
  folder's name and what to mount.
- A multistep job, and an AWX job, are followed by the app node that started them: when that
  node goes, the job is abandoned (within two minutes on a cluster, at its restart otherwise).
  A step already handed to an RTE still finishes; an AWX job goes on in AWX.

## Later

Semaphore and Rundeck adapters; `findDefault` by capability once a second playbook-capable
type exists; following multistep and AWX jobs from the worker, so they survive the app node that
started them. (The worker role and several app nodes exist since 7: see
[examples/scale](../../../examples/scale).)

## Tests

- `tests/rte-ansible.test.mjs` - a job run from its row (credentials, vault, sub path, failure
  lines, output order, the job log), the ansible arguments, the approval gate, which runner a
  job goes to (per-type default, `runner:`, `awx:` alias, capabilities, no runner).
- `tests/job-abort-remote.test.mjs` - abort through the flag, no shell, process group, vault
  password on stdin, the output limit.
- `tests/awx-workflow.test.mjs` - AWX tracking against a fake AWX, incl. the 405 cancel.
- `tests/runner-model.test.mjs` - per-type validation and default, masked secrets.
- `tests/schema-awx-to-runners.test.mjs` - the awx table moving into runners.
- `tests/rte-server.test.mjs` - the RTE API : the token, which jobs it takes, the contract.
- `tests/rte-handover.test.mjs` - the app's side : a refusal, a lost answer, the contract sent.
- `tests/rte-contract.test.mjs` - an RTE accepted by contract, not by release.
- `tests/worker-lock.test.mjs`, `tests/node-scope.test.mjs` - one worker, who ends whose jobs.
- `tests/health.test.mjs`, `tests/config-seed.test.mjs` - the runners check and seed section.
