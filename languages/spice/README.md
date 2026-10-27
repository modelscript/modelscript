<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/spice

High-performance, zero-regex **SPICE 2G6 / 3F5 / HSPICE / LTspice** (`.cir`, `.sp`, `.net`, `.lib`) analog & mixed-signal simulation language package for ModelScript. Features multi-file workspace indexing (`SpiceWorkspaceIndex`), 10 pre-flight electrical & topological lint rules (`M7101`–`M7110`), Modified Nodal Analysis (MNA) DC/AC/Transient numerical solvers, direct lowering to WebAssembly `DAEBuilder`, and bidirectional projections to `Modelica.Electrical.Analog` and `@modelscript/cad` ECAD `NetlistGraph`.

---

## Core Capabilities

- **Zero-Regex SPICE Netlist Parser (`parseSpice`, `parseSpiceNumber`)**: Handles line continuations (`+`), multi-dialect comments (`*`, `;`, `$`, `//`), SPICE engineering scale factors (`T`, `G`, `MEG`, `K`, `M`, `MIL`, `U`, `N`, `P`, `F`), parameter expressions (`{2*pi*1k}`), `.SUBCKT` definitions and `X` instances, `.MODEL` cards (`D`, `NPN`, `PNP`, `NMOS`, `PMOS`), controlled sources (`E`, `F`, `G`, `H`, `B`), and simulation directives (`.OP`, `.TRAN`, `.AC`, `.DC`, `.PARAM`, `.IC`).
- **Pre-Flight Electrical & Topological Linter (`lintSpiceCircuit`, `SPICE_ERROR_CODES`)**: 10 diagnostic rules (`M7101`–`M7110`) detecting floating nodes, ideal voltage source loops, current source cutsets, unresolved subcircuits, non-positive passives, invalid transient timesteps, duplicate device identifiers, missing `.MODEL` definitions, and subcircuit pin mismatches with 1-click LSP quick-fixes.
- **Native Modified Nodal Analysis (MNA) Solvers (`solveOp`, `solveTran`, `solveAc`, `buildMnaSystem`)**:
  - `.OP` (`solveOp`): Non-linear DC operating point via damped Newton-Raphson iteration with analytical device companion models (Shockley diode, Ebers-Moll BJT, Shichman-Hodges Level-1 MOSFET)
  - `.TRAN` (`solveTran`): Time-domain transient integration using Trapezoidal and Backward Euler companion models for reactive elements (`C`, `L`) and time-varying sources (`PULSE`, `SIN`, `EXP`, `PWL`)
  - `.AC` (`solveAc`): Small-signal complex frequency response solving $(\mathbf{G} + j\omega\mathbf{C})\mathbf{V}(\omega) = \mathbf{I}(\omega)$ across `DEC`, `OCT`, or `LIN` sweeps.
- **Direct Linear-Memory DAE Arena Lowering (`lowerSpiceToDae`)**: Lowers KCL nodal conservation equations and constitutive branch relationships directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot & ECAD Projections (`spiceToModelica`, `spiceToNetlistGraph`, `synchronizeModelicaToSpice`)**: Projects SPICE circuits to `Modelica.Electrical.Analog`, exports `@modelscript/cad` ECAD `NetlistGraph` topologies for PCB layout/DRC, and synchronizes tuned parameters back from Modelica via 7 TGG rules.

---

## Package Structure

| Path                           | Description                                                                                         |
| :----------------------------- | :-------------------------------------------------------------------------------------------------- |
| `src/index.ts`                 | Public package exports                                                                              |
| `src/language.ts`              | `spiceLanguage` definition, LSP simulation/export actions, and 7 SPICE ◄► Modelica/SysML TGG rules  |
| `src/types.ts`                 | Core TypeScript interfaces (`SpiceCircuit`, `SpiceComponent`, `OpResult`, `TranResult`, `AcResult`) |
| `src/grammar/spice-grammar.ts` | SPICE grammar combinators                                                                           |
| `src/grammar/index.ts`         | Grammar module re-exports                                                                           |
| `src/parser/spice-parser.ts`   | `parseSpice` and `parseSpiceNumber` zero-regex netlist parser                                       |
| `src/lints/rules.ts`           | `lintSpiceCircuit` and `SPICE_ERROR_CODES` (`M7101`–`M7110`) electrical linter                      |
| `src/lints/index.ts`           | Linter module re-exports                                                                            |
| `src/solvers/mna.ts`           | `buildMnaSystem` Modified Nodal Analysis matrix assembly and LU linear solver                       |
| `src/solvers/op.ts`            | `solveOp` non-linear Newton-Raphson DC operating point solver                                       |
| `src/solvers/tran.ts`          | `solveTran` Trapezoidal / Backward Euler time-domain transient solver                               |
| `src/solvers/ac.ts`            | `solveAc` complex admittance small-signal AC frequency sweep solver                                 |
| `src/solvers/index.ts`         | Solvers module re-exports                                                                           |
| `src/dae/dae-lower.ts`         | `lowerSpiceToDae` direct lowering of SPICE netlists to `DAEBuilder`                                 |
| `src/projections/modelica.ts`  | `spiceToModelica` translator to `Modelica.Electrical.Analog`                                        |
| `src/projections/ecad.ts`      | `spiceToNetlistGraph` translator to `@modelscript/cad` ECAD `NetlistGraph`                          |
| `src/projections/index.ts`     | Projections module re-exports                                                                       |
| `src/tgg/spice-sync.ts`        | `synchronizeModelicaToSpice` bidirectional parameter synchronizer                                   |
| `src/tgg/types.ts`             | TGG synchronization types                                                                           |
| `src/tgg/index.ts`             | TGG module re-exports                                                                               |
| `src/diagram/spice-diagram.ts` | `buildSpiceDiagram` and `renderSpiceSvg` analog circuit schematic renderer                          |
| `src/diagram/index.ts`         | Diagram module re-exports                                                                           |
| `src/workspace-index.ts`       | `SpiceWorkspaceIndex` implementing `IWorkspaceIndex`                                                |
| `src/lsp.ts`                   | LSP diagnostics, document symbols, and hover providers                                              |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                          | Severity  | Description                                                                                            |
| :------ | :---------------------------- | :-------- | :----------------------------------------------------------------------------------------------------- |
| `M7101` | `spice-floating-node`         | `error`   | Floating node has only a single connection or no DC reference path to ground (`0` / `GND`).            |
| `M7102` | `spice-voltage-loop`          | `error`   | Ideal voltage source forms a closed loop of parallel voltage sources without series resistance.        |
| `M7103` | `spice-current-cutset`        | `error`   | Node is connected strictly to ideal current sources with no conductive exit path (cutset).             |
| `M7104` | `spice-unresolved-subcircuit` | `error`   | Subcircuit instance `X` references a `.SUBCKT` definition that is not declared.                        |
| `M7105` | `spice-invalid-passive-value` | `error`   | Passive component (`R`, `L`, `C`) specifies a non-positive value ($\le 0$).                            |
| `M7106` | `spice-timestep-violation`    | `error`   | `.TRAN` transient analysis directive specifies an invalid timestep (`tstep <= 0` or `tstop <= tstep`). |
| `M7107` | `spice-duplicate-device`      | `error`   | Duplicate component identifier detected within the same circuit scope.                                 |
| `M7108` | `spice-missing-model`         | `error`   | Active semiconductor device (`D`, `Q`, `M`, `J`) references an undefined `.MODEL` card.                |
| `M7109` | `spice-pin-count-mismatch`    | `error`   | Subcircuit instance `X` node count does not match the port count of its `.SUBCKT` definition.          |
| `M7110` | `spice-malformed-directive`   | `warning` | Malformed or unsupported SPICE dot-directive card.                                                     |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a SPICE netlist for floating nodes, voltage loops, and cutsets (M7101–M7110)
npx msx spice lint lowpass_filter.cir

# Run DC operating point (.OP), transient (.TRAN), or AC (.AC) simulation
npx msx spice simulate lowpass_filter.cir

# Project SPICE netlist to Modelica.Electrical.Analog or ECAD NetlistGraph
npx msx spice to-modelica lowpass_filter.cir
npx msx spice to-ecad lowpass_filter.cir
```

### Programmatic API

```typescript
import {
  lintSpiceCircuit,
  lowerSpiceToDae,
  parseSpice,
  solveAc,
  solveOp,
  solveTran,
  spiceToModelica,
} from "@modelscript/spice";

const netlist = `
* RC Low-Pass Filter
V1 in 0 DC 0 AC 1 PULSE(0 5 0 1u 1u 10u 20u)
R1 in out 1k
C1 out 0 100n
.TRAN 0.1u 50u
.AC DEC 10 10 100k
.END
`;

// 1. Parse and lint SPICE netlist
const circuit = parseSpice(netlist);
const diagnostics = lintSpiceCircuit(circuit);

// 2. Solve DC Operating Point (.OP), Transient (.TRAN), and AC Sweep (.AC)
const op = solveOp(circuit);
const tran = solveTran(circuit, { tstep: 1e-7, tstop: 5e-5 });
const ac = solveAc(circuit, { type: "DEC", points: 10, fstart: 10, fstop: 1e5 });

// 3. Lower to WebAssembly DAEBuilder and project to Modelica 3.x
const dae = lowerSpiceToDae(circuit);
const modelicaCode = spiceToModelica(circuit);
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
