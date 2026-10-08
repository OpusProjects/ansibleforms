# Security Policy

## Supported versions

Security fixes go into the newest release of 7 and of 6.5. Older releases are not patched — the fixes for [GHSA-g27f-cjvv-42rf](https://github.com/ansibleforms/ansibleforms/security/advisories/GHSA-g27f-cjvv-42rf),
[GHSA-56pr-p4x6-mwm6](https://github.com/ansibleforms/ansibleforms/security/advisories/GHSA-56pr-p4x6-mwm6)
and [GHSA-wcmj-wqvw-6c88](https://github.com/ansibleforms/ansibleforms/security/advisories/GHSA-wcmj-wqvw-6c88)
all shipped in 6.2.1 and were not backported.

| Version | Supported |
| ------- | --------- |
| 7.x     | ✅        |
| 6.5.x   | ✅        |
| < 6.5   | ❌        |

If you are running an older version, upgrading is the fix.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** A public report tells
everybody running AnsibleForms about the hole at the same moment it tells us, and this is
software that holds Ansible credentials, database passwords and Vault tokens.

Use **[Report a vulnerability](https://github.com/ansibleforms/ansibleforms/security/advisories/new)**
on the Security tab. That opens a private advisory visible only to you and the
maintainers, and it is the same mechanism the three advisories above went through.

If that page is not available to you, open a normal issue saying only that you have a
security report and asking for a private channel — **no details, no reproducer, no
version numbers**. A maintainer will open a private advisory and invite you to it.

## What to include

The more of this you can give, the faster it gets fixed:

- what an attacker achieves — read another user's data, run a playbook they may not run,
  reach the host, escalate to admin
- the version, and how it is deployed (docker, kubernetes, bare node)
- a reproducer, or the request that triggers it
- whether authentication is needed, and with which role options

## What to expect

- an acknowledgement that the report arrived, and whether it is reproducible
- if it is accepted, a fix in the next release and a published advisory crediting you
  unless you would rather not be named
- if it is declined, the reasoning — usually that the behaviour needs a permission the
  reporter already had

## Scope

In scope: anything reachable by an authenticated user beyond the permissions their role
grants, anything reachable with no authentication at all, stored credentials becoming
readable or loggable, and injection into the shell, the database or the browser.

Out of scope: findings that need the admin account to already be compromised (an admin can
run arbitrary playbooks by design — that is the product), and reports produced by a
scanner with no demonstrated impact.
