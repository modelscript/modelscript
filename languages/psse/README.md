<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/psse

Siemens PTI PSS/E transmission grid power flow and dynamic network simulation package (`.raw`, `.dyr`) for ModelScript. Features multi-file workspace indexing (`PsseWorkspaceIndex`), RAW format parsing (v30, v32, v33), high-performance Newton-Raphson AC power flow solver (`solveAcPowerFlow`), pre-flight transmission grid linters (`P2001`–`P3003`), and turnkey projections to Modelica and PSCAD (`.pscx`).

---

## Core Capabilities

- **PSS/E RAW Base Case Parser (`parsePsseRaw`)**: High-performance parser extracting transmission grid network elements:
  - Substation buses (Type 1 PQ, Type 2 PV, Type 3 Swing/Slack, Type 4 Isolated)
  - Synchronous & renewable generators ($P_{gen}, Q_{gen}, Q_{max}, Q_{min}, V_{sched}$)
  - Static & constant-power/current/admittance loads ($P_{load}, Q_{load}$)
  - Fixed & switched shunt capacitor/reactor banks ($B_{init}, B_{steps}$)
  - AC transmission lines (resistance $R$, reactance $X$, charging susceptance $B$, thermal MVA ratings)
  - Two-winding and three-winding transformers with complex tap ratios ($a \angle \phi$) and magnetizing admittance
- **AC Power Flow Solver (`solveAcPowerFlow`, `PowerflowNetlist`)**:
  - Full Newton-Raphson power flow solver with sparse Jacobian formulation
  - Exact calculation of bus voltage phasors ($V_i \angle \theta_i$), active and reactive branch flows ($P_{ij}, Q_{ij}$), and system active/reactive losses
  - Automatic PV-to-PQ bus switching upon reactive capability ($Q_{min} / Q_{max}$) limit exhaustion
- **Pre-Flight Transmission Grid Linter (`lintPsse`)**:
  - `P2001`: Islanded bus without generation or transmission interconnect.
  - `P2002`: Missing slack / swing bus (Type 3) in base case.
  - `P2003`: Multiple conflicting slack buses with inconsistent voltage setpoints.
  - `P3001`: Generator active power schedule outside physical capacity ($P_{gen} > P_{max}$ or $P_{gen} < P_{min}$).
  - `P3002`: Inverted reactive power bounds ($Q_{min} > Q_{max}$).
  - `P3003`: Scheduled voltage setpoint deviates excessively from nominal per-unit envelope ($0.85 \le V_{sched} \le 1.15$).
- **Turnkey Projections to Modelica & PSCAD**:
  - `psseToModelica`: Synthesizes standardized `Modelica.Electrical.Analog` AC network circuits for transient and dynamic co-simulation.
  - `psseToPscad`: Lowers PSS/E base cases into PSCAD XML projects (`.pscx`) with automated single-line busbar layout and transformer parameters.
- **Multi-File Workspace Indexing (`PsseWorkspaceIndex`)**: Global indexing for cross-file model resolution and VS Code Library tree navigation.

---

## Usage

```typescript
import { parsePsseRaw, solveAcPowerFlow, lintPsse, psseToModelica, psseToPscad } from "@modelscript/psse";

// Parse a PSS/E RAW base case
const rawContent = `...`;
const psseCase = parsePsseRaw(rawContent);

// Run pre-flight lint checks
const diagnostics = lintPsse(psseCase);

// Solve AC power flow
const powerFlowResult = solveAcPowerFlow(psseCase);
console.log(
  `Converged in ${powerFlowResult.iterations} iterations. Active losses: ${powerFlowResult.totalLossesMw} MW`,
);

// Export to Modelica or PSCAD
const modelicaSource = psseToModelica(psseCase);
const pscadXml = psseToPscad(psseCase);
```
