# @modelscript/spice

High-performance, zero-regex SPICE 2G6 / 3F5 / HSPICE / LTspice analog & mixed-signal simulation language package for the ModelScript polyglot compiler.

Provides full parsing, multi-file workspace indexing, pre-flight linting, Modified Nodal Analysis (MNA) DC/AC/Transient numerical solvers, direct lowering to ModelScript's WebAssembly linear-memory DAE arena (`DAEBuilder`), and bidirectional projections to `Modelica.Electrical.Analog` and `@modelscript/cad/ecad` `NetlistGraph`.

---

## Features

- **Robust Zero-Regex Parser**: Line continuation (`+`), multi-flavor comments (`*`, `;`, `$`, `//`), SPICE engineering unit multipliers (`MEG`, `K`, `U`, `N`, `P`, `F`, `MIL`), parameter expressions (`{2*pi*1k}`), `.SUBCKT` definitions and calls (`X`), `.MODEL` cards, and simulation controls (`.TRAN`, `.AC`, `.DC`, `.OP`, `.PARAM`, `.IC`).
- **Pre-Flight Structural & Electrical Linter**: Implements `M7101`–`M7110` with automatic LSP quick-fixes.
- **Native MNA Solvers**:
  - `.OP`: Non-linear DC operating point via Newton-Raphson iteration with companion conductances (Shockley diode, Ebers-Moll BJT, Level 1 MOSFET).
  - `.TRAN`: Adaptive/fixed-step transient simulation with Trapezoidal and Backward Euler companion models.
  - `.AC`: Small-signal frequency response with complex matrix admittance formulation $\mathbf{Y}(\omega) = \mathbf{G} + j\omega \mathbf{C}$.
- **Zero-GC DAE Arena Lowering**: Direct translation of circuit topologies to ModelScript `DAEBuilder` integer IDs and SoA tables without intermediate AST objects.
- **Polyglot & ECAD Projections**:
  - Translates SPICE netlists to `Modelica.Electrical.Analog` standard library components.
  - Generates `@modelscript/cad/ecad` `NetlistGraph` for PCB layout, ratsnest generation, and Gerber DRC.
- **Multi-File Workspace Indexer**: Implements `IWorkspaceIndex` tracking subcircuits, models, global nodes, and cross-file references across `.cir`, `.sp`, `.net`, and `.lib`.

---

## Diagnostic Rules

| Code        | Rule                          | Severity | Description                                                         | Quick-Fix                                              |
| :---------- | :---------------------------- | :------- | :------------------------------------------------------------------ | :----------------------------------------------------- |
| **`M7101`** | `spice-floating-node`         | Error    | Node with only 1 connection or no DC path to ground (`0`).          | Attach $1\,\text{G}\Omega$ bleeder resistor to ground. |
| **`M7102`** | `spice-voltage-loop`          | Error    | Ideal voltage source loop or parallel independent voltage sources.  | Insert $1\,\text{m}\Omega$ damping series resistor.    |
| **`M7103`** | `spice-current-cutset`        | Error    | Node connected strictly to ideal current sources with no exit path. | Add parallel bypass path to ground.                    |
| **`M7104`** | `spice-unresolved-subcircuit` | Error    | Subcircuit instance `X` references undeclared `.SUBCKT`.            | Add `.INCLUDE` or declare missing `.SUBCKT`.           |
| **`M7105`** | `spice-invalid-passive-value` | Error    | Passive component (R, L, C) has zero or negative value.             | Correct passive value to positive non-zero.            |
| **`M7106`** | `spice-timestep-violation`    | Error    | `.TRAN` directive specifies invalid step size or stop time.         | Adjust transient timestep parameters.                  |
| **`M7107`** | `spice-duplicate-device`      | Error    | Duplicate component or subcircuit name in the same scope.           | Rename duplicate component instance.                   |
| **`M7108`** | `spice-missing-model`         | Error    | Active device (D, Q, M, J) references non-existent `.MODEL`.        | Add default `.MODEL` card definition.                  |
| **`M7109`** | `spice-pin-count-mismatch`    | Error    | Instance pin count does not match `.SUBCKT` port count.             | Align instance pin list with subcircuit ports.         |
| **`M7110`** | `spice-malformed-directive`   | Warning  | Unrecognized or malformed dot-directive card.                       | Format directive according to SPICE standard.          |

---

## Programmatic API

```typescript
import { parseSpice, solveOp, solveTran, solveAc, spiceToModelica, lowerSpiceToDae } from "@modelscript/spice";

const netlist = `
* RC Low-Pass Filter
V1 in 0 DC 0 AC 1 PULSE(0 5 0 1u 1u 10u 20u)
R1 in out 1k
C1 out 0 100n
.TRAN 0.1u 50u
.AC DEC 10 10 100k
.END
`;

// 1. Parse
const circuit = parseSpice(netlist);

// 2. DC Operating Point
const op = solveOp(circuit);
console.log("V(out) DC:", op.nodeVoltages.get("out"));

// 3. Transient Simulation
const tran = solveTran(circuit, { tstep: 1e-7, tstop: 5e-5 });
console.log("Transient samples:", tran.time.length);

// 4. AC Small-Signal Frequency Sweep
const ac = solveAc(circuit, { type: "DEC", points: 10, fstart: 10, fstop: 1e5 });
console.log("AC magnitude at 1kHz (dB):", ac.magnitudeDb.get("out"));

// 5. Lower to ModelScript DAE Arena
const dae = lowerSpiceToDae(circuit);
```
