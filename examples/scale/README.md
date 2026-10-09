# AnsibleForms on several nodes

One image, started in different roles (`AF_ROLE`):

| Role | Runs | How many |
|---|---|---|
| unset | the web app **and** the worker, in one process: the default | 1 |
| `app` | the web interface and the API | as many as you like, behind a load balancer |
| `worker` | the background work: the database bootstrap and the config seed, the schedules, the nightly backup, the repository syncs, the cleanups | 1 at work; more wait and take over |
| `rte` | the playbooks (the `ansibleforms-rte-runner` image) | as many as you like |

[compose.yaml](compose.yaml) runs two app nodes behind nginx, two workers, one RTE and a database.

## What the nodes share

- **The database.** It holds everything the nodes must agree on: the jobs, the worker lock, the
  designer lock, the list of nodes (Status page) and the change notices that keep every node's
  caches current (a credential, a runner or a schedule edited on one node is in force on all of
  them within 5 seconds).
- **The persistent volume** (`/app/dist/persistent`): forms, the config, repositories, uploads,
  backups and the managed `.env`. Every app node and the worker mount the same one, read-write.
- **`~/.ssh`**: the key and the known hosts used for git over ssh. The worker creates the key on
  the first start.
- **`ACCESS_TOKEN_SECRET`**, the same on every app node, or a token signed by one node is refused
  by the next. An app node refuses to start without it.
- **`ENCRYPTION_SECRET`**, the same on every container, or a credential stored by one cannot be
  read by another.

## How it behaves

- **One worker at a time.** The worker holds the database lock `ansibleforms_worker`. When it
  stops, the database releases the lock and a waiting worker takes it within 10 seconds. When its
  host dies without a goodbye (power, a crashed node), the database would keep the lock for hours:
  a waiting worker ends that session once no worker has written a heartbeat for two minutes, and
  takes over. A worker that loses the lock to another one stops, and its container restarts as
  the one waiting. A worker whose start fails stops too, so it never holds the lock doing nothing.
- **The schema is the worker's.** On an empty database the worker creates it, and on an upgrade it
  patches it; app nodes wait until both are done, and say in their log what is still missing.
- **Every container names itself** `<role>-<hostname>-<port>`: nothing to set. The Status page
  lists them all, RTEs included.
- **Jobs belong to a container.** A job running on an RTE belongs to that RTE; it carries on when
  the app node that started it goes. Any other job (an AWX job, the steps of a multistep form)
  belongs to the app node that started it. A container that restarts ends its own unfinished
  jobs; one that disappears (a replaced pod) has them ended by the worker after two minutes
  without a heartbeat.
- **SIGHUP** on any node re-applies the config seed: an app node asks the worker to do it.
- **Status** shows every node, its role and version, which one is the worker, and warns when the
  nodes run different versions.

## Upgrading

Upgrade the **worker first**, then the app nodes. The worker patches the schema; an app node of
the new version waits until the schema is patched (it logs what it is waiting for), so app nodes
upgraded first stay unready until the worker follows - the old ones keep serving meanwhile. RTEs
can follow at any time while they speak the same contract (`server/src/rte/contract.js`).

## Limits

- The **chat assistant** keeps its conversations in the memory of one app node: use sticky
  sessions (nginx `ip_hash` here), or a single app node.
- **Logs** stay in each container (`LOG_PATH` off the shared volume, as in `.env.example`):
  several processes rotating one file lose lines. The log viewer shows the log of the node that
  answers; send the logs somewhere central for the whole picture (`docker logs`, a log collector).
- **Galera and group replication** do not share the worker lock between database nodes: point
  every worker at the same database node.
- Settings changed on the settings page are written to the managed `.env` on the shared volume
  and applied on every node; the ones that need a restart need it on every node.
