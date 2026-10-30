# Deploying to Bunny

`hadars deploy` takes an exported build (`hadars export bunny`, or a split release directory) to bunny.net Edge Scripting
and keeps the history it needs for rollback and cleanup in a state file.

```sh
export BUNNY_API_KEY=...        # management API
export BUNNY_STORAGE_KEY=...    # storage zone password

hadars deploy setup --project shop --env staging      # creates the storage zone, assets pull zone and public zone; writes deploy.target.json
hadars deploy bunny out --env staging --dry-run       # offline plan: files, sizes, runtime config, routing rules
hadars deploy bunny out --env staging                 # stage, verify, activate
hadars deploy rollback --env staging                  # back to the previous live deployment
hadars deploy rollback --env staging --to 41     # back to a retained earlier revision
hadars deploy gc --env staging --delete               # remove static files no retained deployment references
```

`deploy.target.json` holds zone ids only (no secrets) and is meant to be committed. Runtime variables and secrets come from
`--config deploy.config.json` and `--var NAME=VALUE`; secret values are never printed or stored, only their names and a digest.

## How a deploy runs

1. The output is verified against its seal (`verifyOutput`) before anything is sent.
2. Each revision gets immutable scripts named `<project>-<env>-r<N>` (`-c<N>` for another runtime config of the same revision).
   Static files are uploaded under content-hashed paths and read back; existing identical files are reused.
3. Staged scripts are probed on their own hostnames. Only then does the public pointer move, followed by a cache purge.
4. A split release also installs native edge rules; the default group's pointer moves last, and a failure restores the previous rules.
5. The deployment is recorded as `live`; the previous one becomes `superseded` (or `rolled_back`).

Re-running a live revision (`--revision N`) with the same output and config only re-verifies it.

## State

`.hadars/deploy-state.json` (override with `--state`) lists deployments. Changes are guarded by a lock file next to it; if a
deploy was killed, remove `<state>.<env>.lock`. In CI, persist or cache the state file between runs, or the first deploy of
each run cannot see what is live and GC protects nothing.

Programmatic use: `import { deployEnvironment, fileStore } from 'hadars/deploy'`. Any object with the `DeployStore`
interface (`list`, `listAll`, `record`, `exclusive`) can replace the file, for example one backed by a database.

## Limits

Bunny only. Static GC never deletes outside `_builds/` and `_shell/` on shared storage, and refuses when a retained
deployment has no static inventory.
