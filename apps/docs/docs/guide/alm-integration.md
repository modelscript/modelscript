# Package Manifest & ALM / API Integration

ModelScript uses a self-contained, Git-native project layout that unifies local engineering libraries, registry packages, and live API/protocol-based ALM systems (**IBM DOORS Next Generation**, **Jama Connect**, **PTC Codebeamer**, **Siemens Polarion**, and **Jira**):

```text
my-ev-battery/
├── modelscript.yaml              # Committed: YAML 1.2 project & dependency manifest
├── modelscript.lock              # Committed: deterministic JSON lockfile + ALM sync state
├── requirements/                 # Committed (optional): ALM deps with `materialize:` set
│   └── doors/
│       └── reqs_battery_safety.sysml
├── models/
│   └── BatteryPack.mo
└── .modelscript/                 # Gitignored (single .gitignore entry)
    ├── packages/                 # Installed Hub, archive & cached ALM dependencies
    ├── connectors/               # Custom third-party protocol connector plugins (.js/.mjs)
    ├── cache/                    # Salsa DB, WASM CST caches, ALM artifact delta cache
    └── tmp/                      # Transient scratch files
```

> **Offline Compiler Invariant:** The ModelScript compiler, LSP, and simulation engine never make live network calls. External ALM systems synchronize into deterministic local `.sysml` or `.ms` files via `msx install` / `msx sync`, guaranteeing fast offline builds, air-gapped reproducibility (`msx install --offline --frozen`), and clean Git PR diffs.

---

## `modelscript.yaml`

Run `msx init` to scaffold `modelscript.yaml` and add `.modelscript/` to `.gitignore`:

```yaml
name: ev-battery-pack
version: "1.2.0"

dependencies:
  # ModelScript Hub & local archives
  "@ms/modelica-stdlib": ^4.0.0
  "@acme/thermal-lib": file:./libs/thermal.zip

  # IBM DOORS Next (OSLC 2.0/3.0 + Global Configuration + TRS)
  "@reqs/battery-safety": oslc+https://elm.corp.com/rm/projects/EV_BAT/modules/MOD-42?config=Release-2.0

  # Jama Connect (REST v1, Git-tracked materialization + verification push)
  "@reqs/thermal-jama":
    source: jama+https://jama.corp.com/rest/v1/projects/84/baselines/19
    format: sysml2
    materialize: requirements/jama
    push: [verification, links]

  # PTC Codebeamer (REST v3, Working-Set mapped to Git branch)
  "@reqs/cb-bms":
    source: codebeamer+https://cb.corp.com/api/v3/trackers/1042
    workingSet: "branch:${git.branch}"
    materialize: requirements/codebeamer
    push: [verification, links]

  # Siemens Polarion (REST v1 JSON:API, SVN revision pin)
  "@reqs/polarion-sys": polarion+https://polarion.corp.com/rest/v1/projects/EV/workitems?rev=48219

  # Jira Cloud / Data Center (REST v3/v2, JQL + auto-file defects on verify failure)
  "@issues/jira-ev":
    source: jira+https://corp.atlassian.net
    query: >
      project = EV
      AND labels = model-tracked
      AND status != Closed
    push: [defects-on-fail, links]
```

JSON Schema for IDE autocomplete is provided at `schemas/modelscript.yaml.schema.json`.

---

## Authentication (Zero Secrets in Git)

Store host-scoped credentials locally (mode `0600` in `~/.modelscript/credentials.json`) or pass via CI environment variables:

```bash
# Interactive or token login per ALM host
msx login --host elm.corp.com --token "$DOORS_PAT"
msx login --host corp.atlassian.net --email eng@corp.com --password "$JIRA_API_TOKEN"

# Or in CI via environment variables (normalized host name)
export MSX_TOKEN_ELM_CORP_COM="..."
export MSX_USER_CORP_ATLASSIAN_NET="eng@corp.com"
export MSX_PASSWORD_CORP_ATLASSIAN_NET="..."
```

---

## Git-Like Sync & Verification Workflows

```bash
# Add a remote ALM dependency (preserves comments in modelscript.yaml)
msx remote add @reqs/battery-safety oslc+https://elm.corp.com/rm/modules/MOD-42 \
  --baseline Release-2.0 \
  --materialize requirements/doors \
  --push verification links

# Pull latest incremental deltas into materialized/cached files + modelscript.lock
msx sync pull

# Inspect local vs. remote drift without mutating files
msx sync status

# Run verification and publish immutable evidence (Git SHA + metrics) back to ALM
msx verify BatteryPack --publish-to @reqs/battery-safety

# Push authorized outbound links, verification runs, or bidirectional artifact edits
msx sync push --only=verification,links,artifacts

# CI / air-gapped hermetic install (zero live network calls, verifies SHA-256)
msx install --frozen --offline
```

---

## ALM Policy Lints (`msx lint`)

When `modelscript.yaml` declares remote ALM dependencies, `msx lint` automatically evaluates:

| Code     | Severity | Description                                                                                                 |
| :------- | :------- | :---------------------------------------------------------------------------------------------------------- |
| `ALM001` | Error    | Workspace references an external ALM ID not found in the synced package.                                    |
| `ALM002` | Warning  | Workspace references a `Deprecated`, `Rejected`, or `Obsolete` requirement.                                 |
| `ALM003` | Warning  | Remote dependency has no `baseline` or `revision` pin on a protected branch (`main`/`master`).              |
| `ALM004` | Warning  | High-priority / safety-critical requirement (`ASIL-D`, `DAL-A`, `Critical`, `High`) has no `verifies` link. |

---

## Custom Connectors, IDE & MCP Integration

- **Custom Connectors:** Drop any `.js` / `.mjs` module exporting an `AlmConnector` (or `register(registry)`) into `.modelscript/connectors/` to support proprietary in-house PLM/ALM APIs.
- **LSP Hover & CodeActions:** Hovering over any `@external`-annotated synced item displays status, priority, revision, and a clickable deep link into the ALM web UI, with CodeActions for **Open in ALM Web UI** and **Sync ALM remote**.
- **MCP Tools (Offline):** AI agents can call `alm_list_requirements`, `alm_trace_coverage`, and `alm_blast_radius` against the local synced workspace without needing live ALM credentials.
- **Web IDE Proxy (`/api/v1/alm`):** Browser workspaces route `discover`, `pull`, and `push` through `apps/api`'s `/api/v1/alm` proxy while keeping in-browser WASM compilation 100% file-based.
