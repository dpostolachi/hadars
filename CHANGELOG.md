# Changelog

## 2.0.0-rc.1 (release candidate)

Second major version. Release candidates are published under the `next` npm tag, so `npm install hadars` keeps the 1.x release until 2.0.0 is out.

### Breaking changes

- **`hadars export bunny` now emits the composition shell by default.** Pass `--no-emit-shell` to get the 1.x output.

### New

- **Registry client.** `hadars login`, `ci-login`, `whoami`, `publish`, `types`, `pull`, `outdated`, `verify`, `versions`, `set`, `promote`, `history`, `go-back`, `preview`, `signing keygen`. See `docs/registry-client.md`.
- **Signed environment moves.** `set` and `promote` take `--sign-key`; the registry checks the signature against the team's keys.
- **Trusted pulls.** `pull` needs trusted keys (`hadars.trust.json`, `--trusted-keys` or `HADARS_TRUSTED_KEYS`) unless `--allow-unsigned` is given. Nothing is installed until every file verifies.
- **Registry protocol.** Build manifests, content-derived build IDs, validators, blob sealing and channel-move signing, shared by the client and any registry.
- **`hadars deploy`** (`setup`, `bunny`, `rollback`, `gc`) for Bunny Edge deployments of split releases.
- **Composition.** Module manifests (`hadars.manifest.ts`), emitted declarations, typed `getModule`, and lazy modules that preload the chunks the server render used.

### Configuration

| Variable | Replaces | Purpose |
| --- | --- | --- |
| `HADARS_REGISTRY` | (new) | Registry origin. Defaults to `https://registry.hadars.xyz`. |
| `HADARS_TOKEN` | (new) | Registry token. |
| `HADARS_TEAM` | (new) | Team to act on. |
| `HADARS_TRUSTED_KEYS` | (new) | Trusted keys file. |

### Compatibility notes

- The channel-move signing prefix stays `hadars-platform/channel-move/v1`, so existing signatures keep verifying.
- A project's `hadars.lock` pins the registry it was pulled from. To move a project to another registry, remove the lock file and pull again.

### Stability

- Stable within 2.x: the registry protocol (manifest format, build IDs, signing and sealing) and the command names listed above.
- Still moving: the deploy command options and the composition APIs, which may change before 2.0.0.
