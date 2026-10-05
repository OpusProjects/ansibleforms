# Releasing AnsibleForms

For maintainers. Contributors only need [CONTRIBUTING.md](CONTRIBUTING.md).

Everything below runs in GitHub Actions. Nothing is built or pushed from a laptop, and no
version number or changelog line is ever typed by hand.

There are two release lines: `main` (the newest major, 7) and `release/6.x` (patches of
the previous one). Everything below works the same on both; each
branch has its own release pull request, manifest and `CHANGELOG.md`.

## How a release happens

```
feature PR ──squash──▶ main ──▶ release-please updates the open "chore: release x.y.z" PR
                                              │
                           you merge it ──────┘
                                              ▼
                     tag x.y.z + GitHub release + image x.y.z and latest
```

1. Every pull request merged into `main` has a Conventional Commit title
   (`feat: ...`, `fix: ...`). See CONTRIBUTING.md for what each type does to the version.
2. After each merge, the **Release** workflow (`.github/workflows/release.yml`) runs
   release-please. It keeps **one** pull request open, titled `chore: release x.y.z`, that:
   - bumps `server/package.json` and `server/package-lock.json` to the next version
   - adds the section for that version at the top of `CHANGELOG.md`
   - updates `.release-please-manifest.json`
3. That open pull request is the "unreleased" list: its diff shows exactly what the next
   release contains.
4. **Merging it is the release.** The same workflow then creates the tag `x.y.z` (no `v`, like
   the tags before it), the GitHub release with the changelog section as notes, and calls
   **Publish**, which pushes the image to GHCR (Docker Hub is no longer published to).

### The image tags

The tags and what they point to are listed once, for users, under
[Image tags](https://ansibleforms.com/installation#image-tags) (`installation.md` in
[ansibleforms/website](https://github.com/ansibleforms/website)). Do not repeat or change them elsewhere.
publish.yml implements that list: `latest`, `<major>` and `<major>.<minor>` only move when
the release is the highest of its kind, so a patch on an older line never moves them
backwards. The release workflow also keeps GitHub's "Latest release" badge on the highest
version.

### Changing the changelog wording before a release

Edit `CHANGELOG.md` on the release pull request's branch (`release-please--branches--main`,
or `release-please--branches--release/6.x`) and push. Once the release exists, you can also edit the GitHub release notes directly.

### Forcing a specific version

Set `"release-as"` in `release-please-config.json`, in a pull request with a `feat:` or `fix:`
title, and merge it. release-please then proposes exactly that version. Remove the setting
again in the next pull request after the release, or every later release is proposed as that
same version.

```json
  "release-type": "simple",
  "release-as": "7.0.0",
```

A `Release-As:` line in the pull request description does **not** work reliably: GitHub
appends `Co-authored-by` lines after it when it squashes, so it is no longer read as a
footer. And a pull request with a hidden type (`ci:`, `docs:`, `chore:`) never opens a
release on its own, whatever it says.

## Release candidates

To test a pull request before it is merged: Actions → **Release candidate** → Run workflow →
enter the pull request number. That publishes:

- `ghcr.io/ansibleforms/ansibleforms:<next>-rc.<pr>.<run>`, for example `6.4.0-rc.512.7`
- `ghcr.io/ansibleforms/ansibleforms:latest-rc`

A comment on the pull request lists the tags. The UI and the Status page of that image
show the rc version.

`<next>` is the version the pull request would release. On the release pull request it is
exactly the upcoming version, so a candidate of that pull request tests the whole release.
Run the workflow again after new pushes to get a newer candidate.

Only pull requests from branches of this repository publish. A fork's code never runs with
the registry credentials.

## Publishing an existing release again

Actions → **Publish** → Run workflow → enter the tag (for example `6.3.1`). The workflow
refuses when `server/package.json` at that tag names another version.

## The base image

`ghcr.io/ansibleforms/base-server` holds node, python, ansible and the os packages. It is
built in [ansibleforms/base-images](https://github.com/ansibleforms/base-images) and
versioned by date (`2026.10.05`, plus `latest`), independent of the application.

- **Build it:** in base-images, a merged change to `base-server/` publishes a new build, or
  Actions → **Build** → Run workflow rebuilds it with fresh packages.
- **Use it:** the application `Dockerfile` pins the base by digest, so a new base changes
  nothing until the pin moves. Dependabot opens a `build(deps): bump base-server` pull
  request for that. Build a release candidate of it to test the app on the new base, then
  merge it. Retitle it `fix(base): ...` if the update should appear in the changelog.

## A patch release of 6.x

Open the fix against `release/6.x` (see CONTRIBUTING.md: fix on main first, then
cherry-pick). release-please keeps a "chore: release 6.5.x" pull request open on that
branch; merging it releases and publishes, exactly like on main. Its config bumps the patch
only, so a stray `feat:` cannot make a 6.6.0.

## Local scripts

- `publish-local.sh` builds the application image on your machine, without pushing.

A test server does not need an image copied to it: it can pull `latest-rc`.

## Setup this depends on

| What | Where | Used by |
|---|---|---|
| GitHub App `ansibleforms-release` (contents and pull requests: read and write) | installed on this repository, on `ansibleforms/website` (the release rebuilds the site) and on `ansibleforms/helm-charts` (the release moves the chart's default image) | release.yml |
| `RELEASE_APP_ID` | repository variable | release.yml |
| `RELEASE_APP_PRIVATE_KEY` | repository secret | release.yml |
| ruleset on `main` and `release/*` | pull request required, squash only, required checks, no force push | everything |

The App token is needed because a pull request opened with the default `GITHUB_TOKEN`
starts no workflows, so the release pull request would never get its required checks.
