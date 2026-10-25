<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/lps

High-Performance Continental Gas & Liquid Pipeline Network Simulation Package (`.lps`, `.tgx`, `.tlx`, `.tgn`, `.tln`) for ModelScript. Features zero-GC in-WASM 1D transient gas Euler dynamics lowered to `DAEBuilder`, high-accuracy AGA-8 (ISO 20765-1) and Peng-Robinson equations of state, line pack storage analytics, multi-product liquid batch tracking, water hammer surge evaluation, formal SysML v2 requirements & operational state machine projections, and pre-flight safety linting (`M8001`–`M8012`).

---

## Core Capabilities

- **PipelineStudio Project & Keyword Ingestion (`parseLps`, `parseLpsXml`, `parseLpsKeyDeck`)**:
  - High-performance XML parser built on `@modelscript/dsl/xml` for `.lps`, `.tgx`, and `.tlx` studies.
  - Full keyword parser and serializer for legacy TGNET and TLNET ASCII input decks (`.tgn`, `.tln`, `.psg`, `.psl`).
  - Automatic extraction of supply sources, delivery city gates, pipes, multi-stage compressor stations, pumps, regulators, and valves.
- **High-Accuracy Real-Gas Thermodynamics (`Aga8Eos`, `PengRobinsonEos`)**:
  - Detailed Characterization AGA-8 (ISO 20765-1) calculating compressibility $Z(P, T)$, molar density, mass density, speed of sound, and Joule-Thomson coefficients.
  - Native support for **Hydrogen Blending** ($H_2$ in natural gas from 0% to 100%).
  - Peng-Robinson cubic equation of state for heavier hydrocarbons and dense-phase supercritical $CO_2$ transport.
- **Steady-State Nodal Network Solver (`SteadyNetworkSolver`)**:
  - Solves simultaneous nodal mass balances and pipe hydraulic equations with Colebrook-White friction and elevation head.
  - Compressor operating maps with pressure-ratio and discharge-pressure control modes, power consumption, and driver efficiency.
  - Pressure reducing regulators with Joule-Thomson throttling temperature drop evaluation.
- **Line Pack & Storage Reserves Engine (`LinePackEngine`)**:
  - Numerical integration of pipeline gas mass inventory and standard volume ($Sm^3$).
  - Deliverable line pack reserve analysis above contractual minimum city gate pressures.
  - Buffer exhaustion time calculations during peak demand drafting and curtailment events.
- **In-WASM Transient Gas Dynamics (`GasEulerDaeSolver`)**:
  - 1D staggered-grid discretization of mass and momentum conservation equations lowered into `DAEBuilder`.
  - Simulates dynamic line packing, transient pressure waves, and rapid decompression events.
- **Liquid Water Hammer & Surge Analysis (`LiquidSurgeSolver`)**:
  - Solves Joukowsky acoustic wave propagation ($\Delta P = \rho a \Delta v$) during emergency shutdown (ESD) valve closures and pump trips.
  - Automated ASME B31.4 transient overpressure ($1.1 \times \text{MAOP}$) and cavitation column separation screening.
- **Multi-Product Liquid Batch Tracking (`BatchTracker`)**:
  - Propagates discrete fuel batches (Diesel, Jet-A, Regular Gasoline) along pipeline lines.
  - Solves Austin-Palfrey interface mixing length and transmix volume at delivery manifolds.
- **SysML v2 Polyglot Projections (`lpsToSysml2`)**:
  - Translates pipeline network models into formal SysML v2 textual architecture:
    - Structural parts (`part def PipeSegment`, `port def PipelineFluidPort`).
    - Formal safety requirements (`PipelineMaopIntegrityRequirement`, `MinimumCityGateDeliveryRequirement`, `HydrogenBlendingLimitRequirement`).
    - Operational state machines (`PipelineOperationalProcedure`: SteadyTransmission, LinePacking, PeakDemandDrafting, ControlledCurtailment, EmergencySectionalizing).
- **Formal Verification Engine (`PipelineVerifier`)**:
  - Automated ASME B31.8 / B31.4 MAOP verification, contractual delivery pressure checks, and API RP 14E erosional velocity validation.

---

## Pre-Flight Pipeline Diagnostic Linter (`M8001`–`M8012`)

| Code    | Rule                          | Severity  | Description                                                                              |
| :------ | :---------------------------- | :-------- | :--------------------------------------------------------------------------------------- |
| `M8001` | `maop-exceeded`               | `error`   | Operating or transient surge pressure exceeds Maximum Allowable Operating Pressure.      |
| `M8002` | `compressor-surge-hazard`     | `warning` | Operating point is below compressor surge limit or exceeds maximum pressure ratio.       |
| `M8003` | `compressor-stonewall-limit`  | `warning` | Throughput flow rate exceeds maximum compressor choke/stonewall capacity.                |
| `M8004` | `unconnected-pipeline-node`   | `error`   | Topological node is isolated with 0 connecting links or active boundary conditions.      |
| `M8005` | `delivery-pressure-deficit`   | `error`   | Delivery node is hydraulically unreachable from any supply or storage cavern.            |
| `M8006` | `erosional-velocity-hazard`   | `warning` | Gas velocity exceeds API RP 14E erosional guideline ($v > 20 \text{ m/s}$).              |
| `M8007` | `liquid-column-separation`    | `error`   | Pressure drops below liquid vapor pressure, risking vapor cavities & water hammer surge. |
| `M8008` | `hydrogen-embrittlement-risk` | `warning` | Hydrogen blend fraction exceeds 10% on steel without fracture toughness verification.    |
| `M8009` | `batch-transmix-excess`       | `warning` | Liquid batch volume is below minimum threshold or excessive interface transmix volume.   |
| `M8010` | `joule-thomson-freezing`      | `warning` | Pressure drop across regulator exceeds 25 bar without preheater, risking ice/hydrates.   |
| `M8011` | `pump-npsh-deficit`           | `error`   | Available Net Positive Suction Head is below required NPSH ($NPSHA < NPSHR$).            |
| `M8012` | `line-pack-depletion-risk`    | `warning` | Total continuous delivery demand exceeds supply; line pack storage buffer will deplete.  |

---

## Programmatic Usage

```typescript
import {
  parseLps,
  lintLpsModel,
  SteadyNetworkSolver,
  LinePackEngine,
  GasEulerDaeSolver,
  lpsToSysml2,
  PipelineVerifier,
} from "@modelscript/lps";

// 1. Ingest PipelineStudio XML or ASCII keyword deck
const model = parseLps(sourceText);

// 2. Run Pre-Flight Diagnostic Linter
const diagnostics = lintLpsModel(model);
console.log(`Diagnostics found: ${diagnostics.length}`);

// 3. Solve Steady-State Network Hydraulics
const steady = SteadyNetworkSolver.solve(model);

// 4. Evaluate Line Pack Storage & Deliverability Reserves
const linePack = LinePackEngine.analyze(model, steady);
console.log(`Total Line Pack: ${(linePack.totalLinePackSm3 / 1e6).toFixed(2)} MMSm3`);
console.log(`Energy Stored: ${linePack.totalEnergyStoredGWh.toFixed(1)} GWh`);

// 5. Verify Formal Safety & MAOP Compliance
const report = PipelineVerifier.verifySteady(model, steady);
console.log("Verification passed:", report.passed);

// 6. Simulate 1D Transient Dynamics
const trajectory = GasEulerDaeSolver.simulate(model, {
  durationSeconds: 7200,
  timeStep: 10,
});

// 7. Generate Formal SysML v2 Architecture
const sysmlCode = lpsToSysml2(model);
```
