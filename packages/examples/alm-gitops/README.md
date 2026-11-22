<!-- Bismillahirrahmanirrahim -->

# EV Battery ALM GitOps Example

Reference ModelScript GitOps workspace demonstrating bidirectional ALM / RM federation across **IBM DOORS Next (OSLC)**, **PTC Codebeamer**, and **Atlassian Jira** using `modelscript.yaml` and GitHub Actions.

## Contents

- [`modelscript.yaml`](./modelscript.yaml) — Declares protocol-prefixed remote dependencies (`oslc+https://...`, `codebeamer+https://...`, `jira+https://...`), baseline/working-set pinning, SysML v2 materialization paths, and outbound push capabilities (`verification`, `links`, `defects-on-fail`).
- [`alm-sync-pr.yml`](./alm-sync-pr.yml) — GitHub Actions workflow that pulls remote ALM deltas (`msx sync pull`), runs workspace lints (`msx lint .`), opens automated review PRs for requirement/lockfile diffs, and publishes verification verdicts (`msx verify --publish-to`).

## Quick Start

```bash
# Pull pinned ALM baselines into materialized SysML v2 files and modelscript.lock
msx sync pull

# Validate requirements traceability and ALM policy rules
msx lint .

# Run offline verification against the locked baseline
msx install --frozen --offline
msx verify --publish-to @reqs/battery-safety
```

See the [ALM / PLM Integration Guide](https://modelscript.org/guide/alm-integration) for authentication environment variables and connector configuration.
