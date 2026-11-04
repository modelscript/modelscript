# BioNetGen Rule-Based Biochemical Networks (`.bngl`)

`@modelscript/bngl` (`languages/bngl`) provides native WebAssembly GLR parsing, rule-based site-specific biochemical network expansion, observable pattern aggregation, 4th-order Runge-Kutta ODE integration, `DAEBuilder` lowering, and SBML / Modelica projections for **BioNetGen Language (BNGL)** multiprotein signaling, receptor oligomerization, and post-translational modification models.

---

## Supported Extensions & Standards

| Extension | Format          | Description                                                                                                                                        |
| :-------- | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.bngl`   | BioNetGen Model | Block-structured rule-based biochemical specification (`parameters`, `molecule types`, `seed species`, `observables`, `reaction rules`, `actions`) |

---

## Key Capabilities

### 1. Site-Specific Molecule Types & Bond Graphs

- Parses structured BNGL blocks:
  - **`molecule types`**: Multi-component proteins with internal phosphorylation/conformational states (e.g., `EGFR(L,CR1,Y1068~U~P)`).
  - **`seed species`**: Initial molecular complexes with explicit site bonds (`!1`, `!+`, `!?`, `!.`).
  - **`observables`**: `Molecules` and `Species` pattern queries aggregating phosphorylated or bound sub-complexes.
  - **`reaction rules`**: Unidirectional (`->`) and bidirectional (`<->`) site-transformation and binding rules without combinatorial manual enumeration.

### 2. Automated Network Expansion & ODE Simulation

- Iteratively applies reaction rules to seed species to generate the reachable species and elementary reaction network (`generateNetwork` / `solveBngl`).
- Integrates species concentration trajectories and observable outputs, and lowers the expanded network into `@modelscript/runtime`'s `DAEBuilder` arena, **SBML** (`bnglToSbml`), and **Modelica 3.x** (`bnglToModelica`).

---

## Pre-Flight Diagnostics

<LintRules lang="bngl" />

---

## CLI Usage

```bash
# Validate molecule site states, bond indices, and reaction rate constants
msx lint EgfrSignaling.bngl

# Parse and inspect BioNetGen blocks
msx parse EgfrSignaling.bngl
```
