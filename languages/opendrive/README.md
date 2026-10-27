<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/opendrive

ASAM **OpenDRIVE** (v1.6 / v1.7, `.xodr`, `.xml`) roadway network and autonomous vehicle simulation language package for ModelScript. Features zero-regex XML parsing via `@modelscript/dsl/xml`, analytical 16-point Gauss-Legendre Fresnel clothoid evaluation, 8 pre-flight roadway geometry lint rules (`M7801`–`M7808`), Frenet-Serret trajectory lowering to `DAEBuilder`, GENSYS track geometry projection, headless SVG rendering, and multi-file workspace indexing.

---

## Core Capabilities

- **Zero-Regex OpenDRIVE XML Parser (`parseOpenDrive`)**: Complete ingestion of ASAM OpenDRIVE v1.6 and v1.7 `.xodr` schemas, extracting roads, `planView` geometry segments (`line`, `arc`, `spiral`, `poly3`, `paramPoly3`), vertical `elevationProfile`, `lateralProfile` superelevation, `laneSection` hierarchies, and multi-road `junction` connections.
- **Analytical Fresnel Clothoid & 3D Track Kernel (`evaluateGeometry`, `evaluateRoadPoseAtS`, `sampleRoadTrack`)**: High-precision 16-point Gauss-Legendre quadrature evaluation of Euler spirals (clothoids), circular arcs, cubic polynomials, vertical slopes, and superelevation roll angles.
- **Pre-Flight Roadway Geometry Linter (`lintOpenDrive`, `OpenDriveErrorCode`)**: Static geometric and topological verification (`M7801`–`M7808`) checking $C^0$/$C^1$ tangency continuity, lane linkage across sections, clothoid curvature divergence, overlapping junction paths, and extreme elevation grades.
- **Direct Linear-Memory DAE Arena Lowering (`lowerOpenDriveToDae`)**: Lowers Frenet-Serret path-following kinematics ($s, d, \psi_e, \kappa(s)$) directly into `@modelscript/runtime`'s `DAEBuilder` arena.
- **GENSYS Track Geometry Projection (`opendriveToGensys`)**: Translates 3D roadway coordinates, curvature, and superelevation into GENSYS `.geo` track geometry files.
- **Top-Down Roadway SVG Renderer & Workspace Index (`renderOpenDriveSvg`, `OpenDriveWorkspaceIndex`)**: Headless SVG road network visualization and `IWorkspaceIndex` multi-file symbol indexing.

---

## Package Structure

| Path                                     | Description                                                                                       |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `src/index.ts`                           | Public package exports                                                                            |
| `src/language.ts`                        | `opendriveLanguage` definition and LSP actions (`opendrive_lint`, `opendrive_sample_track`, etc.) |
| `src/types.ts`                           | Core TypeScript interfaces (`OpenDriveDocument`, `OpenDriveRoad`, `OpenDriveGeometry`, etc.)      |
| `src/parser/opendrive-parser.ts`         | `parseOpenDrive` zero-regex XML parser for `.xodr` and `.xml` road networks                       |
| `src/parser/index.ts`                    | Parser module re-exports                                                                          |
| `src/geometry/clothoid.ts`               | `evaluateGeometry`, `evaluateRoadPoseAtS`, and `sampleRoadTrack` Gauss-Legendre clothoid kernel   |
| `src/geometry/index.ts`                  | Geometry module re-exports                                                                        |
| `src/lints/rules.ts`                     | `lintOpenDrive` and `OpenDriveErrorCode` (`M7801`–`M7808`) pre-flight roadway linter              |
| `src/lints/index.ts`                     | Linter module re-exports                                                                          |
| `src/dae/opendrive-to-dae.ts`            | `lowerOpenDriveToDae` Frenet-Serret kinematic lowering to `DAEBuilder`                            |
| `src/dae/index.ts`                       | DAE module re-exports                                                                             |
| `src/projections/opendrive-to-gensys.ts` | `opendriveToGensys` translator to GENSYS track geometry format                                    |
| `src/projections/index.ts`               | Projections module re-exports                                                                     |
| `src/diagram/opendrive-svg.ts`           | `renderOpenDriveSvg` headless vector SVG roadway map renderer                                     |
| `src/diagram/index.ts`                   | Diagram module re-exports                                                                         |
| `src/workspace-index.ts`                 | `OpenDriveWorkspaceIndex` implementing `IWorkspaceIndex`                                          |
| `src/lsp.ts`                             | LSP diagnostics, document symbols, and hover providers                                            |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                            | Severity  | Description                                                                                                             |
| :------ | :------------------------------ | :-------- | :---------------------------------------------------------------------------------------------------------------------- |
| `M7801` | `road-tangency-discontinuity`   | `error`   | Discontinuity in position ($C^0 > 0.05\text{ m}$) or heading ($C^1 > 0.05\text{ rad}$) between adjacent segments.       |
| `M7802` | `unlinked-lane-boundary`        | `error`   | Lane connection link points to a non-existent successor/predecessor lane ID in the adjacent section.                    |
| `M7803` | `clothoid-curvature-divergence` | `error`   | Clothoid spiral curvature rate of change $\lvert\dot{\kappa}\rvert$ diverges ($> 10\text{ m}^{-2}$) or has zero length. |
| `M7804` | `overlapping-junction-paths`    | `warning` | Duplicate/conflicting connecting path in junction between the same incoming and connecting roads.                       |
| `M7805` | `elevation-gradient-extreme`    | `warning` | Roadway vertical elevation gradient exceeds the standard $15\%$ safety threshold.                                       |
| `M7806` | `negative-lane-width`           | `error`   | Driving lane defines a negative or zero width polynomial coefficient ($a \le 0.0\text{ m}$).                            |
| `M7807` | `duplicate-road-id`             | `error`   | Duplicate road `id` detected in the OpenDRIVE roadway network.                                                          |
| `M7808` | `missing-center-lane`           | `error`   | Lane section in road is missing the mandatory center reference lane (`id="0"`).                                         |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint an ASAM OpenDRIVE network for C0/C1 tangency and lane continuity
npx msx opendrive lint highway_interchange.xodr

# Sample 3D clothoid trajectory and lower to DAE arena
npx msx opendrive flatten highway_interchange.xodr

# Export OpenDRIVE roadway geometry to GENSYS track format
npx msx opendrive to-gensys highway_interchange.xodr
```

### Programmatic API

```typescript
import {
  lintOpenDrive,
  lowerOpenDriveToDae,
  opendriveToGensys,
  parseOpenDrive,
  renderOpenDriveSvg,
  sampleRoadTrack,
} from "@modelscript/opendrive";

// 1. Parse ASAM OpenDRIVE .xodr XML document
const doc = parseOpenDrive(xodrXml);

// 2. Run pre-flight geometric linter (M7801–M7808)
const diagnostics = lintOpenDrive(doc);

// 3. Sample 3D analytical clothoid road trajectory at 0.5 m intervals
const points = sampleRoadTrack(doc.roads[0]!, 0.5);

// 4. Lower Frenet-Serret kinematics to WebAssembly DAEBuilder
const dae = lowerOpenDriveToDae(doc);

// 5. Project to GENSYS track geometry or render SVG map
const gensysGeo = opendriveToGensys(doc, 1.0);
const svgMap = renderOpenDriveSvg(doc);
```

---

## Scripts

| Command             | Description                                                    |
| :------------------ | :------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript sources to `dist/` (`tsc`)                  |
| `npm run clean`     | Remove `dist/` build artifacts (`rimraf dist`)                 |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                          |
| `npm test`          | Run unit and integration test suite via `test-runner.js`       |
| `npm run typecheck` | Run TypeScript type checking without emitting (`tsc --noEmit`) |
