# Registry commands

The `hadars` CLI can publish modules to a registry, pin what a project consumes, and move environments
such as `dev`, `staging` and `production`. The hosted registry is the default. You can run your own
registry, as long as it implements the same HTTP API.

## Configuration

| Setting | Where | Used for |
| --- | --- | --- |
| `HADARS_REGISTRY` | environment | Registry origin, for example `https://registry.example.com` |
| `--registry <url>` | flag | Same as `HADARS_REGISTRY`, for one command |
| `HADARS_TOKEN` | environment | Bearer token for the registry. Keep it out of git. |
| `HADARS_TEAM` | environment | Team to act on, when your token belongs to several |
| `HADARS_TRUSTED_KEYS` | environment | Path to a trusted keys file, instead of `hadars.trust.json` |
| `--trusted-keys <file>` | flag | Same as `HADARS_TRUSTED_KEYS`, for one command |

Without `--registry` or `HADARS_REGISTRY`, a project with a `hadars.lock` uses the registry that lock
pins. A project without a lock uses `https://registry.hadars.xyz`.

## Rules that protect your credentials and your builds

- **Credentials go only to the registry you chose.** Requests never follow a redirect. Plain `http` is
  allowed only for `localhost`, `127.0.0.1` and `[::1]`, for local development.
- **A lock file pins its registry.** A command that names a different registry is refused before any
  request is sent. To move a project, remove `hadars.lock` and pull again.
- **Pulls are verified.** `hadars pull` needs trusted keys: commit a `hadars.trust.json` to the
  project, pass `--trusted-keys`, or set `HADARS_TRUSTED_KEYS`. Without them, pull stops before it
  contacts the registry. `--allow-unsigned` pulls a channel that is not signed; use it only when you
  know the channel is not signed.
- **Nothing is installed until it verifies.** Every downloaded file is checked against its declared
  hash. Pulls write to a staging folder and replace the project's files only after every check passes.

`hadars.trust.json` maps key IDs to public keys:

```json
{ "sk_0123456789abcdef": "<base64url public key>" }
```

## Commands

### Signing in

```sh
hadars login            # opens the browser; the token is printed to stdout
hadars login --device   # for machines without a browser
hadars whoami           # who the token belongs to, and its teams
```

In CI, exchange the job's identity token for a short-lived token:

```sh
hadars ci-login --team <team> --audience <audience>
```

### Publishing

```sh
hadars publish --project . --out ./out            # publish a module build
hadars publish --project . --out ./out --to dev   # publish and move dev to it
hadars publish --project . --out ./out --dry-run  # describe the build, send nothing
hadars types --project . --out ./out              # emit declarations only
```

A module is published as a content-addressed build: the same files give the same build ID, and a
build that already exists is not uploaded again.

### Pulling and checking

```sh
hadars pull --env production        # verify, download and write hadars.lock
hadars outdated                     # compare hadars.lock with its channel (read-only)
hadars verify                       # check hadars.lock's signature against the trusted keys
```

`pull` writes `hadars.lock`, the generated `.hadars/` files and a `tsconfig` fragment for type checking.

### Versions and environments

```sh
hadars versions catalog --query "fix cart"
hadars set dev catalog@42                          # one package
hadars set dev shell@7 catalog@42 checkout@3       # several packages, one revision
hadars promote staging production --only catalog   # copy rows between environments
hadars history production
hadars go-back production 12                       # restore an earlier revision
```

Each move creates a numbered revision. Pass `--expected-revision <n>` so a move fails if someone else
moved the environment first.

### Previews

```sh
hadars preview create pr-123 --from staging --set catalog=#57 --ttl 7d
hadars preview rebase pr-123            # review what changes if the base moved
hadars preview rebase pr-123 --apply
hadars preview extend pr-123 --ttl 7d
hadars preview promote pr-123 staging
hadars preview delete pr-123
```

### Signing environment moves

Once a team has a signing key, moves to a protected environment (`production` by default) must be
signed. Create a key outside the repository:

```sh
hadars signing keygen --out ~/.config/hadars/release-signing.json   # mode 600
```

Register the public key with the registry, then sign moves with it:

```sh
hadars set production shell@7 --sign-key ~/.config/hadars/release-signing.json
hadars promote staging production --sign-key ~/.config/hadars/release-signing.json
```

The client asks the registry what the move would create, signs exactly that, and applies it. A move
signed with a different key, or an unsigned move to a protected environment, is refused.

Keep the private key out of git and out of CI logs. In CI, store it as a secret and write it to a file
only for the duration of the job.

## Exit codes and errors

- `0`: success.
- `1`: the registry refused the command, or a check failed. The message says which check.
- `2`: a usage error, such as a missing argument or an environment variable that isn't set.

Errors print a short message and never the token, the private key or a full response body.
