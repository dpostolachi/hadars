# Deployment-time configuration

Set `HADARS_ASSET_BASE_URL` in the server runtime environment to serve one build
from different asset locations, for example `https://static.example/preview` or
`/preview`. Trailing slashes are removed; `/` selects the origin root. The value
must be an absolute HTTP(S) URL or a root-relative path, without credentials,
query, fragment, whitespace, or backslashes. Invalid values produce a console
warning and retain the built `baseURL`. Leaving the variable unset retains the
existing URLs and client public path.

The server reads the process environment or the runtime environment API. An
adapter receiving environment bindings reads the variable from those bindings.
The value is captured when the handler/template initializes; restart the server
or initialize a new deployment after changing it. Bindings use separate template
and response caches, so concurrent deployments cannot share asset URLs.

Generated entry scripts, stylesheets and preload links use the override. Before
entry scripts execute, the HTML publishes the same base for client chunk loading,
including lazy JavaScript, CSS and bundled resources. The original client public
path remains the fallback when no override is emitted. This requires a build
produced with runtime asset metadata; older builds must be rebuilt once. A custom
content security policy must permit the inline initialization script. Upload the
unchanged static output under the selected base and route those asset requests to
it; the override does not move files or add a static server mount.

Pinned module client descriptors follow the same rule: root-relative `publicBase`
paths (including the default `/_builds/`) are placed under the runtime asset base.
Absolute module URLs beneath the shell's built asset base are relocated by
replacing that prefix. Absolute URLs on separately configured asset origins stay
unchanged. The relocated descriptors reach both server-rendered module links and
serialized client props, so browser module loading agrees with the HTML. Module
chunks derive their location from the module entry URL. Publish the complete
module client tree under that location, preserving build identifiers and paths.

Integrity values continue to describe the same bytes and remain unchanged for
both shell and module assets. Cross-origin integrity checks still require the
asset host's existing cross-origin access configuration. Application-authored
markup, navigation URLs, and separately configured module origins are unaffected.
