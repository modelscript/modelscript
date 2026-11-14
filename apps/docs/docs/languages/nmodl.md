---
title: NMODL / NEURON Ion-Channel & Membrane Kinetics (.mod)
description: Native WebAssembly GLR parsing, biophysical static verification (M9441-M9450), Hodgkin-Huxley current-clamp action potential simulation, DAEBuilder lowering, and Modelica 3.x projections for NEURON NMODL mechanisms.
---

# NMODL / NEURON Ion-Channel & Membrane Kinetics (`.mod`)

`@modelscript/nmodl` (`languages/nmodl`) provides native WebAssembly GLR parsing, biophysical pre-flight static checks (`M9441`–`M9450`), deterministic Hodgkin-Huxley current-clamp action potential integration, `DAEBuilder` linear-memory lowering, and **Modelica 3.x** projections for **NEURON NMODL** ion-channel and synaptic mechanism descriptions.

---

## Supported Extensions & Standards

| Extension | Format          | Description                                                                                                                   |
| :-------- | :-------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `.mod`    | NMODL Mechanism | NEURON Model Description Language (`NEURON`, `SUFFIX`, `USEION`, `PARAMETER`, `STATE`, `BREAKPOINT`, `DERIVATIVE`, `INITIAL`) |

---

## Key Capabilities

### 1. Biophysical Interface & Kinetic Block Analysis

`@modelscript/nmodl` parses `NEURON { SUFFIX ... USEION ... READ ... WRITE ... }` blocks, `PARAMETER` declarations with unit annotations, `STATE` gating variables, `INITIAL` conditions, `BREAKPOINT` ohmic/GHK current assignments, and `DERIVATIVE` gating ODEs:

$$C_m \frac{dV_m}{dt} = I_{\text{stim}}(t) - \left[\bar{g}_{\text{Na}} m^3 h (V_m - E_{\text{Na}}) + \bar{g}_{\text{K}} n^4 (V_m - E_{\text{K}}) + g_L (V_m - E_L)\right]$$

### 2. Current-Clamp Action Potential Solver

- Integrates single-compartment soma membrane voltage $V_m(t)$ and voltage-gated channel states ($m, h, n$) under step current-clamp injection (`solveNmodlActionPotential`), reporting spike count, firing frequency, peak depolarization, and resting potential.

### 3. DAE Arena Lowering & Modelica Projection

- Lowers NMODL parameters, gating states, and `DERIVATIVE` / `BREAKPOINT` equations directly into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerNmodlToDae`) and projects mechanisms into **Modelica 3.x** (`nmodlToModelica`).

---

## Pre-Flight Diagnostics

<LintRules lang="nmodl" />

---

## CLI Usage

```bash
# Lint an NMODL channel mechanism for missing SUFFIX/BREAKPOINT, unassigned currents, and gating bounds
msx lint hh_sodium.mod

# Parse and inspect the NMODL concrete syntax tree
msx parse hh_sodium.mod

# Run domain inspection and action-potential simulation via the unified domain router
msx domain nmodl inspect hh_sodium.mod
msx domain nmodl simulate hh_sodium.mod
```

---

## Programmatic TypeScript SDK

```typescript
import { parseNmodl, lintNmodl, solveNmodlActionPotential, lowerNmodlToDae, nmodlToModelica } from "@modelscript/nmodl";
import { DAEBuilder } from "@modelscript/runtime";

const doc = parseNmodl(nmodlSource);
const diagnostics = lintNmodl(doc);
const sim = solveNmodlActionPotential(doc, { tEnd: 50, dt: 0.025, stimAmp: 10 });

const builder = new DAEBuilder();
lowerNmodlToDae(doc, builder);
const modelicaCode = nmodlToModelica(doc);
```
