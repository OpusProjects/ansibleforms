# Your own RTE

Since 7, playbooks run in an RTE (runtime environment) container. It is the
AnsibleForms server started with `AF_ROLE=rte`, next to python and ansible. We publish
it in three layers, each built on the one before. Build your own on the layer that fits.

| Image | What is in it | Use it |
|---|---|---|
| `ghcr.io/ansibleforms/ansibleforms-rte-base` | node and the AnsibleForms server, git, ssh. No python and no ansible, so it runs no playbook by itself. | To build an RTE with **your own** python and ansible version: [Dockerfile.own-ansible](Dockerfile.own-ansible) |
| `ghcr.io/ansibleforms/ansibleforms-rte-core` | the base + python 3.14, ansible-core and a few common libraries (`jmespath`, `netaddr`, `requests`, `paramiko`). No collections. | To build a **smaller** RTE with only the collections and libraries your playbooks use: [Dockerfile.netapp](Dockerfile.netapp), [Dockerfile.vmware](Dockerfile.vmware) |
| `ghcr.io/ansibleforms/ansibleforms-rte-full` | the core + the `ansible` package on the same ansible-core, and what the AnsibleForms image had before 7: the NetApp, AWS and community collections, pandas, pyvmomi, boto3 and more | **The default.** Run it as it is: the Helm chart and the docker setup do, and playbooks from 6.5 find what they used. |

What each layer adds: [Dockerfile.rte-base](../../Dockerfile.rte-base), [Dockerfile.rte-core](../../Dockerfile.rte-core)
(with [docker/rte-core/requirements.txt](../../docker/rte-core/requirements.txt)), and
[Dockerfile.rte-full](../../Dockerfile.rte-full) (with [docker/rte-full/](../../docker/rte-full)).

## Build and run it

```bash
docker build -f examples/rte/Dockerfile.netapp -t my-rte-netapp .
```

Run it like the published image: the app's `DB_*` and `ENCRYPTION_SECRET`, and a
`RTE_TOKEN`. Then add it under Connections > Runners. See
[the runners README](../../server/src/runners/README.md).

## Keep it on the app's release

An RTE runs the app's own server code. Build FROM the same release as the app: `:7` follows
the app's `:7`, and an exact `:7.x.y` pins both. An RTE on an older release keeps working as
long as it speaks the same contract (`server/src/rte/contract.js`). The Status page says when
one must be rebuilt.

## Bake it in, or mount it

- **Bake it in** (the examples above): the image holds everything the playbooks need. It is
  reproducible and starts fast. This is the way for production.
- **Mount it**: collections in `/etc/ansible/collections` and roles in `/etc/ansible/roles`,
  from a volume. You get no rebuild per change, but what runs depends on what is on that
  volume. python libraries cannot be mounted this way: they go into the image.
