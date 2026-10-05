# Releasing AnsibleForms

For maintainers. Contributors only need [CONTRIBUTING.md](CONTRIBUTING.md).

Everything below runs in GitHub Actions. Nothing is built or pushed from a laptop, and no
version number or changelog line is ever typed by hand.

There are two release lines: `main` (the next major, released as `7.0.0-beta.N`) and
`release/6.x` (patches of the current one). Everything below works the same on both; each
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

| Release | Tags |
|---|---|
| `6.5.3` | `6.5.3`, and `6.5`, `6`, `latest` - each only while it is the highest of its kind |
| `7.0.0-beta.2` | `7.0.0-beta.2`, `7-beta`, `next` - never `latest` |
| release candidate | `6.5.3-rc.551.1`, `6-rc`, `latest-rc` |

So a patch on 6 after 7.0.0 is out moves `6.5` and `6` but not `latest`, and re-publishing an
old tag never moves anything backwards. `latest` reaches 7 with the final 7.0.0. The release
workflow also keeps GitHub's "Latest release" badge on the highest final version.

### Changing the changelog wording before a release

Edit `CHANGELOG.md` on the release pull request's branch (`release-please--branches--main`,
or `release-please--branches--release/6.x`) and push. Once the release exists, you can also edit the GitHub release notes directly.

### Forcing a specific version

Merge any pull request whose **description** ends with a `Release-As:` line. The squash
commit carries the description as its body, and release-please then proposes that version:

```
Release-As: 7.0.0
```

## Release candidates

To test a pull request before it is merged: Actions → **Release candidate** → Run workflow →
enter the pull request number. That publishes:

- `ghcr.io/ansibleforms/ansibleforms:<next>-rc.<pr>.<run>`, for example `6.4.0-rc.512.7`
- `ghcr.io/ansibleforms/ansibleforms:latest-rc`

and a comment on the pull request lists the tags. The UI and the Status page of that image
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

`ghcr.io/ansibleforms/ansibleforms-base` holds node, python, ansible and the os packages. It is
versioned by date (`2026.10.01`, plus `latest`), independent of the application.

- **Build it:** Actions → **Base image** → Run workflow. It also runs by itself when a
  change to `Dockerfile.base` (a new python or ansible version) is merged into main. Nothing
  else rebuilds it.
- **Use it:** the application `Dockerfile` pins the base by digest, so a new base changes
  nothing until the pin moves. Dependabot opens a `build(deps): bump ansibleforms-base`
  pull request for that. Build a release candidate of it to test the app on the new base, then
  merge it. Retitle it `fix(base): ...` if the update should appear in the changelog.

## A patch release of 6.x

Open the fix against `release/6.x` (see CONTRIBUTING.md: fix on main first, then
cherry-pick). release-please keeps a "chore: release 6.5.x" pull request open on that
branch; merging it releases and publishes, exactly like on main. Its config bumps the patch
only, so a stray `feat:` cannot make a 6.6.0.

## Starting and ending the 7 betas

- The first 7 pull request on main sets `"prerelease": true`, `"versioning": "prerelease"`
  and `"prerelease-type": "beta"` in `release-please-config.json`, and ends its description
  with `Release-As: 7.0.0-beta.0`. Every later merge into main counts the beta up.
- When 7 is ready: remove those three settings and merge a pull request ending with
  `Release-As: 7.0.0`. Its publish moves `latest` to 7.

## Local scripts

- `publish-local.sh` builds the application image on your machine, without pushing.

A test server does not need an image copied to it: it can pull `latest-rc`.

## Setup this depends on

| What | Where | Used by |
|---|---|---|
| GitHub App `ansibleforms-release` (contents and pull requests: read and write) | installed on this repository only | release.yml |
| `RELEASE_APP_ID` | repository variable | release.yml |
| `RELEASE_APP_PRIVATE_KEY` | repository secret | release.yml |
| `PAT_TOKEN` | repository secret, used by release.yml until `RELEASE_APP_ID` is set | release.yml |
| `github-pages` environment | deployment branch `main` (it also builds the frozen `release/6.x` docs under `/v6/`) | pages.yml |
| ruleset on `main` and `release/*` | pull request required, squash only, required checks, no force push | everything |

The App token is needed because a pull request opened with the default `GITHUB_TOKEN`
starts no workflows, so the release pull request would never get its required checks.
