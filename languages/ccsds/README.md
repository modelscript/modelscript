<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ccsds

CCSDS space mission astrodynamics, orbit ephemeris, and OMG XTCE satellite telemetry & telecommand language package (`.oem`, `.opm`, `.omm`, `.xtce`) for ModelScript. Features dual KVN and XTCE XML parsers (`parseCcsds`, `parseKvn`, `parseXtce`), multi-file workspace indexing (`CcsdsWorkspaceIndex`), a 6-DOF Cowell perturbed orbit propagator (`propagateOrbit`, `keplerianToCartesian`, `cartesianToKeplerian`), direct linear-memory `DAEBuilder` lowering (`lowerCcsdsToDae`), 8 pre-flight astrodynamic and bit-packing lint rules (`M8201`–`M8208`), Modelica and SysML v2 projections (`ccsdsToModelica`, `ccsdsToSysml`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **CCSDS KVN & OMG XTCE Parser (`parseCcsds`, `parseKvn`, `parseXtce`)**:
  - **Orbit Ephemeris, Parameter & Mean-Elements Messages (`.oem`, `.opm`, `.omm`)**: Parses CCSDS 502.0-B-2/B-3 Key-Value Notation (KVN) metadata (`OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `TIME_SYSTEM`), Cartesian state vectors ($x, y, z, v_x, v_y, v_z$), classical & mean Keplerian elements ($a, e, i, \Omega, \omega, \nu / M$), spacecraft physical parameters (mass, solar radiation pressure area/coefficient, drag area/$C_D$), and timestamped ephemeris state blocks.
  - **OMG XTCE Satellite Telemetry & Telecommand Dictionaries (`.xtce`)**: Parses `<SpaceSystem>` hierarchies, `<TelemetryMetaData>` parameter types and bit lengths, `<SequenceContainer>` bit-offset packet layouts, and `<CommandMetaData>` `<MetaCommand>` argument lists.
- **6-DOF Cowell Perturbed Orbit Propagator (`propagateOrbit`, `computeOrbitalAcceleration`, `keplerianToCartesian`, `cartesianToKeplerian`)**: High-precision RK4 numerical integrator modeling central WGS-84 Earth point-mass gravity ($\mu = 398600.4418\text{ km}^3/\text{s}^2$), $J_2$ zonal harmonic Earth oblateness ($J_2 = 1.08263 \times 10^{-3}$), exponential scale-height atmospheric drag, and solar radiation pressure (SRP), with bidirectional Keplerian/Cartesian state transformations and sub-satellite geodetic latitude/longitude/altitude tracking.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerCcsdsToDae`)**: Emits 6-DOF Cowell perturbed orbital differential equations ($\dot{\mathbf{r}} = \mathbf{v}$, $\dot{\mathbf{v}} = -\frac{\mu}{r^3}\mathbf{r} + \mathbf{a}_{J_2}$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena (`ExprId`, `EqId`, `VarId`).
- **8 Pre-Flight Astrodynamic & Telemetry Lint Rules (`M8201`–`M8208`, `lintCcsds`)**: Static verification of pericenter impact trajectories ($r_p < R_\oplus$), XTCE `<SequenceContainer>` bit-packing overlaps, hyperbolic/parabolic escape eccentricity ($e \ge 1$), non-inertial reference frames, missing or non-monotonic OEM ephemeris epochs, duplicate telemetry parameters, and non-physical spacecraft mass.
- **Modelica & SysML v2 Mission Architecture Projections (`ccsdsToModelica`, `ccsdsToSysml`)**: Translates orbital state vectors into continuous Modelica 3.x astrodynamics models and projects XTCE telemetry/telecommand dictionaries into SysML v2 `part def`, `port def`, and packet container definitions.
- **Multi-File Workspace Indexing & LSP (`CcsdsWorkspaceIndex`, `getCcsdsHover`, `getCcsdsCompletions`)**: Implements `IWorkspaceIndex` across multi-satellite constellations and telemetry dictionaries with hover inspection and completion providers.

---

## Package Structure

| Path                                     | Description                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                             |
| `src/language.ts`                        | `ccsdsLanguage` definition and LSP actions (`ccsds_lint`, `ccsds_to_dae`, `ccsds_to_modelica`, `ccsds_to_sysml`)                   |
| `src/types.ts`                           | `CcsdsDocument` (`CcsdsOemDocument`, `CcsdsOpmDocument`, `CcsdsOmmDocument`, `XtceDocument`), Keplerian, and XTCE type definitions |
| `src/parser/index.ts`                    | `parseCcsds` unified dispatcher for KVN and XTCE XML formats                                                                       |
| `src/parser/kvn-parser.ts`               | `parseKvn` parser for CCSDS `.oem`, `.opm`, and `.omm` files                                                                       |
| `src/parser/xtce-parser.ts`              | `parseXtce` parser for OMG XTCE `.xtce` satellite telemetry & command XML dictionaries                                             |
| `src/astrodynamics/orbital-mechanics.ts` | `propagateOrbit`, `computeOrbitalAcceleration`, `keplerianToCartesian`, and `cartesianToKeplerian`                                 |
| `src/astrodynamics/index.ts`             | Astrodynamics barrel exports                                                                                                       |
| `src/lints/rules.ts`                     | `lintCcsds` and `CcsdsErrorCode` (`M8201`–`M8208`) pre-flight astrodynamics and bit-packing linter                                 |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                              |
| `src/dae/ccsds-to-dae.ts`                | `lowerCcsdsToDae` direct lowering of 6-DOF orbital mechanics into `DAEBuilder` linear memory                                       |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                                        |
| `src/projections/ccsds-to-modelica.ts`   | `ccsdsToModelica` translator to Modelica 3.x orbital mechanics models                                                              |
| `src/projections/ccsds-to-sysml.ts`      | `ccsdsToSysml` translator to SysML v2 mission & telemetry architecture models                                                      |
| `src/projections/index.ts`               | Projections barrel exports                                                                                                         |
| `src/workspace-index.ts`                 | `CcsdsWorkspaceIndex` implementing `IWorkspaceIndex` across spacecraft ephemeris and XTCE files                                    |
| `src/lsp.ts`                             | LSP hover, completion, and diagnostic providers                                                                                    |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                             | Severity  | Description                                                                                                                               |
| ------- | -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `M8201` | `sub-orbital-impact-trajectory`  | `error`   | Sub-orbital pericenter radius $r_p = a(1 - e)$ is below Earth radius ($6378.137\text{ km}$), resulting in atmospheric re-entry or impact. |
| `M8202` | `telemetry-bit-packing-overlap`  | `error`   | Telemetry bit packing overlap in XTCE container `'containerName'`: entry `'entryName'` starts before previous entry `'prevEntry'` ends.   |
| `M8203` | `hyperbolic-unbounded-orbit`     | `warning` | Orbit eccentricity $e \ge 1.0$ indicates a hyperbolic or parabolic escape trajectory.                                                     |
| `M8204` | `unrecognized-reference-frame`   | `error`   | Unrecognized or non-inertial reference frame `'refFrame'` (expected `EME2000`, `GCRF`, `ITRF`, `TEME`, `TOD`, `J2000`, `ICRF`, or `TDR`). |
| `M8205` | `missing-epoch-timestamp`        | `error`   | Ephemeris point is missing a valid timestamp at the given index.                                                                          |
| `M8206` | `non-monotonic-ephemeris-epochs` | `error`   | Ephemeris timestamp `'epoch'` is not strictly greater than previous timestamp `'prevEpoch'`.                                              |
| `M8207` | `duplicate-parameter-name`       | `error`   | Duplicate telemetry parameter declaration for `'paramName'` in XTCE `<ParameterSet>`.                                                     |
| `M8208` | `negative-spacecraft-mass`       | `error`   | Spacecraft mass must be strictly positive ($> 0\text{ kg}$).                                                                              |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect CCSDS ephemeris (.oem, .opm, .omm) or OMG XTCE telemetry dictionary (.xtce)
npx msx ccsds inspect satellite.opm

# Run pre-flight astrodynamics and telemetry bit-packing checks (M8201-M8208)
npx msx ccsds lint satellite.opm telemetry.xtce

# Propagate spacecraft orbit using Cowell 6-DOF perturbed dynamics (with J2 oblateness)
npx msx ccsds propagate satellite.opm --duration 5400 --step 30

# Lower 6-DOF orbital equations of motion to the linear-memory DAE arena
npx msx ccsds to-dae satellite.opm

# Project to Modelica 3.x astrodynamics model or SysML v2 mission architecture
npx msx ccsds to-modelica satellite.opm --out OrbitModel.mo
npx msx ccsds to-sysml telemetry.xtce --out TelemetryArchitecture.sysml
```

### Programmatic Usage

```typescript
import {
  ccsdsToModelica,
  ccsdsToSysml,
  lintCcsds,
  lowerCcsdsToDae,
  parseCcsds,
  propagateOrbit,
} from "@modelscript/ccsds";

const opmSource = `
CCSDS_OPM_VERS = 2.0
OBJECT_NAME = SENTINEL-6A
OBJECT_ID = 2020-086A
CENTER_NAME = EARTH
REF_FRAME = GCRF
TIME_SYSTEM = UTC
EPOCH = 2026-03-30T00:00:00Z
X = 7714.0
Y = 0.0
Z = 0.0
X_DOT = 0.0
Y_DOT = 5.120
Z_DOT = 5.120
MASS = 1192.0
`;

// 1. Parse CCSDS OPM and run M8201-M8208 pre-flight diagnostics
const doc = parseCcsds(opmSource, "sentinel6a.opm");
const diagnostics = lintCcsds(doc);

// 2. Propagate orbit for 1 orbital period (5400 s) with J2 oblateness and atmospheric drag
if (doc.format === "OPM") {
  const trajectory = propagateOrbit(doc.stateVector, doc.spacecraft, {
    durationSeconds: 5400,
    stepSeconds: 60,
    includeJ2: true,
    includeDrag: true,
  });
  console.log(trajectory[trajectory.length - 1]?.altitudeKm);
}

// 3. Lower to DAEBuilder linear memory or project to Modelica / SysML v2
const dae = lowerCcsdsToDae(doc);
const modelicaCode = ccsdsToModelica(doc);
const sysmlCode = ccsdsToSysml(doc);
```

---

## Scripts

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                   |
| `npm test`          | Run KVN/XTCE parser, Cowell orbit propagator, linter, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                           |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                            |
| `npm run clean`     | Remove `dist/` build artifacts                                                  |
