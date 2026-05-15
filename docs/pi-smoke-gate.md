# Pi smoke gate

AnthroClaw includes a manual GitHub Actions workflow for running the real Pi aggregate smoke suite in an environment that has Pi credentials.

The workflow is intentionally `workflow_dispatch` only. It is a decision gate for maintainers, not a default pull-request check, because unauthenticated forks and regular CI runners should not need Pi credentials.

## Required secret

Configure this repository secret:

- `PI_AUTH_JSON_B64`: base64-encoded contents of the Pi auth storage file.

Optional repository secret:

- `PI_MODELS_JSON_B64`: base64-encoded contents of the Pi models storage file.

The workflow writes these values into temporary runner files and passes their paths to `pnpm smoke:pi-all` through `--auth-path` and, when present, `--models-path`. Credential material is not stored in AnthroClaw config.

## Prepare secrets

Use the Pi storage files from the machine where Pi auth already works. For example:

```bash
base64 < /secure/pi-auth.json
base64 < /secure/pi-models.json
```

Store each command's output in the matching GitHub secret. If the local `base64` wraps lines, GitHub secrets can still store the multiline value; the workflow decodes it before running the smoke suite.

## Run

Open **Actions -> Pi smoke -> Run workflow** and choose:

- `model`: defaults to `anthropic/claude-sonnet-4-6`.
- `timeout_ms`: forwarded to the workspace and Gateway probes.
- `allow_skip`: defaults to `false`; keep it false for the real decision gate.

The workflow runs:

```bash
pnpm smoke:pi-all -- --json --model <model> --timeout-ms <timeout> --auth-path <tmp-auth-path> [--models-path <tmp-models-path>]
```

A passing run proves the Pi package imports, the selected provider/model has auth, the workspace edit + rewind smoke passes, and the Gateway channel dispatch + approval smoke passes in one runner.
