# @modelscript/opendrive

ASAM OpenDRIVE roadway network and autonomous vehicle simulation language package for ModelScript.

## Capabilities

- **Zero-Regex XML Parser:** Complete ingestion of ASAM OpenDRIVE v1.6 and v1.7 (`.xodr`, `.xml`) schemas.
- **Analytical Fresnel Clothoid Kernel:** High-precision 16-point Gauss-Legendre quadrature evaluation of Euler spirals, circular arcs, cubic polynomials, and vertical elevation profiles.
- **Pre-Flight Diagnostic Linters:** Codes `M7801`–`M7820` for tangency discontinuities, unlinked lane boundaries, curvature divergence, and excessive elevation grades.
- **Multi-File Workspace Index:** `OpenDriveWorkspaceIndex` implementing `IWorkspaceIndex` for multi-road networks and junctions.
- **Direct Linear DAE Lowering:** Lowers Frenet-Serret road tracking kinematics directly into ModelScript's zero-GC `DAEBuilder` linear memory arena.
- **Projections to GENSYS:** Translates 3D roadway trajectories and superelevation into GENSYS railway/roadway track geometry format.
- **LSP & CLI Suite:** Complete language server integration and `msx opendrive` command-line verbs.

## Diagnostic Codes

| Code    | Rule                            | Severity  | Description                                                                               |
| :------ | :------------------------------ | :-------- | :---------------------------------------------------------------------------------------- |
| `M7801` | `road-tangency-discontinuity`   | `error`   | Discontinuity in position ($C^0$) or heading ($C^1$) between adjacent geometry elements.  |
| `M7802` | `unlinked-lane-boundary`        | `error`   | Lane connection points to a non-existent lane in adjacent section.                        |
| `M7803` | `clothoid-curvature-divergence` | `error`   | Extreme curvature rate $\dot{\kappa}$ or zero-length spiral causing numerical divergence. |
| `M7804` | `overlapping-junction-paths`    | `warning` | Conflicting connecting paths within same junction without priority control.               |
| `M7805` | `elevation-gradient-extreme`    | `warning` | Elevation slope exceeds 15% safety envelope.                                              |
| `M7806` | `negative-lane-width`           | `error`   | Negative or zero width on driving lane.                                                   |
| `M7807` | `duplicate-road-id`             | `error`   | Duplicate road ID detected in roadway network.                                            |
| `M7808` | `missing-center-lane`           | `error`   | Lane section is missing mandatory center lane (ID 0).                                     |
