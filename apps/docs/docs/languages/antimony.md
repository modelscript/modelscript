# Antimony Modular Systems Biology (`.ant`)

`@modelscript/antimony` (`languages/antimony`) provides native WebAssembly GLR parsing, hierarchical submodel composition and port aliasing (`is`), rate and assignment rule evaluation, state-triggered event handling, 4th-order Runge-Kutta ODE integration, `DAEBuilder` lowering, and bidirectional SBML Level 3 / Modelica 3.x projection for **Antimony** human-readable systems biology models.

---

## Supported Extensions & Standards

| Extension | Format         | Description                                                                                                            |
| :-------- | :------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `.ant`    | Antimony Model | Modular text language (`model ... end`) for biochemical reactions, compartments, species, events, and submodel imports |

---

## Key Capabilities

### 1. Human-Readable Biochemical Reactions & Rules

- Parses concise Antimony syntax:
  - **Compartments & Species**: `compartment cell = 1.0; species S1 in cell = 10.0, $S_ext in cell = 5.0;` (including boundary species `$`).
  - **Reactions**: `J1: S1 + E -> ES; k_on * S1 * E - k_off * ES;` with named reaction IDs, stoichiometric weights, and arbitrary kinetic rate laws.
  - **Rate & Assignment Rules**: `x' = k1 * S1 - k2 * x;` and `totS := S1 + ES;`.
  - **State Events**: `E1: at (S1 < 0.5): S1 = 10.0, k1 = 0.2;`.

### 2. Modular Composition (`model` & `is`)

- Supports reusable `model` definitions instantiated as submodels (`A: Oscillator();`) with shared variable bindings (`A.S1 is Cytosol_S1;`) and unit declarations (`unit mM = 1e-3 mole / litre;`).

### 3. RK4 Solver, DAE Lowering & SBML / Modelica Projection

- Simulates coupled reaction networks and state events (`solveAntimony`), lowers equations into `@modelscript/runtime`'s `DAEBuilder` arena, and exports to **SBML Level 3 Core** (`antimonyToSbml`) and **Modelica 3.x** (`antimonyToModelica`).

---

## Pre-Flight Diagnostics

<LintRules lang="antimony" />

---

## CLI Usage

```bash
# Run pre-flight linting on an Antimony model
msx lint Repressilator.ant

# Parse and inspect Antimony model declarations
msx parse Repressilator.ant
```
