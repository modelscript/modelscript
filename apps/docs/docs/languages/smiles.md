---
title: SMILES & MDL Molfile Molecular Graphs (.smi, .smarts, .mol, .sdf)
description: Zero-regex native WebAssembly GLR parsing, organic valence and Hückel aromaticity verification, Joback & Reid group-contribution property estimation, DAEBuilder lowering, and Aspen Plus / Modelica projections for OpenSMILES, SMARTS, and MDL Molfile / SDF.
---

# SMILES & MDL Molfile Molecular Graphs (`.smi`, `.smarts`, `.mol`, `.sdf`)

`@modelscript/smiles` (`languages/smiles`) provides zero-regex native WebAssembly GLR parsing, organic valence and Hückel $4n+2$ aromaticity verification, **Joback & Reid (1987)** group-contribution thermodynamic and critical property estimation, `DAEBuilder` lowering, and Aspen Plus / Modelica projections for **OpenSMILES**, **SMARTS**, and **MDL Molfile V2000 / Structure-Data File (`.sdf`)** molecular specifications.

---

## Supported Extensions & Standards

| Extension         | Format          | Description                                                                                                      |
| :---------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------- |
| `.smi`, `.smiles` | OpenSMILES      | Line notation encoding molecular graphs, ring closures, branches, stereochemistry (`@`/`@@`), and aromatic atoms |
| `.smarts`         | SMARTS          | Substructure query patterns for functional-group matching                                                        |
| `.mol`, `.sdf`    | MDL V2000 / SDF | 2D/3D atomic coordinate tables, bond orders, and associated structure-data property tags (`> <Property>`)        |

---

## Key Capabilities

### 1. Molecular Graph Topology, Valence & Hückel Aromaticity

- Constructs typed molecular graphs $G = (V, E)$ with implicit/explicit hydrogen counting, ring-closure matching (single-digit `1`–`9` and two-digit `%nn` closures), disconnected ionic salts/mixtures (`.`), formal charges, isotopes, tetrahedral chirality (`@`/`@@`), and cis/trans alkene stereochemistry (`/` and `\`).
- Evaluates cycle bases over conjugated $\pi$-systems to verify **Hückel's rule** ($N_\pi = 4n + 2$ delocalized $\pi$-electrons) and checks every atom against allowed organic/inorganic valence shells ($\text{B}: 3$, $\text{C}: 4$, $\text{N}: \{3,5\}$, $\text{O}: 2$, $\text{P}: \{3,5\}$, $\text{S}: \{2,4,6\}$, halogens: $1$).

### 2. Joback & Reid (1987) Group-Contribution Property Estimator

`@modelscript/smiles` decomposes molecular graphs into functional group frequencies $N_k$ (`-CH3`, `-CH2-`, `>CH-`, `>C<`, `=CH2`, `>C=O`, `-OH`, `-COOH`, `-COO-`, `-NH2`, aromatic ring carbons, and halogens) and evaluates the **Joback & Reid** group-contribution correlations for pure-component thermophysical properties:

$$
\begin{aligned}
T_b &= 198.2 + \sum_k N_k \, \Delta T_{b,k} \quad [\text{K}] \\[4pt]
T_m &= 122.5 + \sum_k N_k \, \Delta T_{m,k} \quad [\text{K}] \\[4pt]
T_c &= T_b \left[0.584 + 0.965 \sum_k N_k \, \Delta T_{c,k} - \left(\sum_k N_k \, \Delta T_{c,k}\right)^2\right]^{-1} \quad [\text{K}] \\[4pt]
P_c &= \left(0.113 + 0.0032 \, N_{\text{atoms}} - \sum_k N_k \, \Delta P_{c,k}\right)^{-2} \quad [\text{bar}] \\[4pt]
V_c &= 17.5 + \sum_k N_k \, \Delta V_{c,k} \quad [\text{cm}^3/\text{mol}]
\end{aligned}
$$

Along with standard enthalpy of formation $\Delta H_{f,298}^\circ$, standard Gibbs energy of formation $\Delta G_{f,298}^\circ$ ($\text{kJ/mol}$), ideal-gas heat capacity polynomial $C_p^\circ(T) = A + BT + CT^2 + DT^3$, and the Lee-Kesler acentric factor $\omega$.

### 3. Aspen Plus, Modelica & DAE Lowering

- **Aspen Plus & Modelica Media Projection**: Projects estimated critical constants ($T_c, P_c, V_c, \omega$), molecular weights, and NASA/ideal-gas $C_p^\circ(T)$ polynomials directly into **Aspen Plus** pure-component property cards (`smilesToAspen`) and **Modelica** media records (`smilesToModelica`).
- **`DAEBuilder` Lowering**: Emits pure-component thermophysical parameters and temperature-dependent $C_p^\circ(T)$, $H^\circ(T)$, and vapor-pressure saturation equations into `@modelscript/runtime`'s `DAEBuilder` arena.

---

## Pre-Flight Diagnostics

<LintRules lang="smiles" />

---

## CLI Usage

```bash
# Validate ring closures, atomic valences, and Hückel aromaticity
msx lint DrugLibrary.smi

# Parse SMILES or SDF molecular structure files
msx parse Aspirin.smi

# Estimate Joback & Reid critical properties and thermochemistry
msx domain smiles inspect Aspirin.smi
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseSmilesModel,
  estimateJobackProperties,
  lowerSmilesToDae,
  smilesToAspen,
  smilesToModelica,
} from "@modelscript/smiles";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseSmilesModel("CC(=O)Oc1ccccc1C(=O)O aspirin\n");
const props = estimateJobackProperties(model.molecules[0]);

const builder = new DAEBuilder();
lowerSmilesToDae(model, builder);
const aspenInp = smilesToAspen(model);
const modelicaMedia = smilesToModelica(model);
```
