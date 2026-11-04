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

### 1. Molecular Graph Topology & Valence Verification

- Constructs typed molecular graphs with implicit/explicit hydrogen counting, ring-closure matching (including `%nn` two-digit rings), disconnected salts/mixtures (`.`), formal charges, isotopes, and Kekulé/aromatic conjugation.

### 2. Joback & Reid Group-Contribution Property Estimator

- Automatically decomposes molecular graphs into functional groups (`-CH3`, `-CH2-`, `>C=O`, `-OH`, `-COOH`, `-NH2`, aromatic ring carbons, halogens) to estimate pure-component physical properties:
  - Normal boiling point $T_b$ and freezing point $T_m$ ($\text{K}$)
  - Critical temperature $T_c$ ($\text{K}$), critical pressure $P_c$ ($\text{bar}$), and critical molar volume $V_c$ ($\text{cm}^3/\text{mol}$)
  - Standard enthalpy of formation $\Delta H_f^\circ$ and Gibbs energy of formation $\Delta G_f^\circ$ ($\text{kJ/mol}$)
  - Ideal-gas heat capacity polynomial $C_p^\circ(T) = A + BT + CT^2 + DT^3$ and Lee-Kesler acentric factor $\omega$.

### 3. Aspen Plus, Modelica & DAE Lowering

- Projects estimated critical and thermochemical parameters directly into **Aspen Plus** pure-component property cards (`smilesToAspen`), **Modelica** media records (`smilesToModelica`), and `@modelscript/runtime`'s `DAEBuilder`.

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
```
