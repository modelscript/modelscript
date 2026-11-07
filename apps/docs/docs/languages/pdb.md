---
title: PDB & mmCIF Macromolecular Structure (.pdb, .cif)
description: Compiler reference for Protein Data Bank (.pdb) and PDBx/mmCIF (.cif) 3D macromolecular coordinates, Ramachandran torsions, Gaussian Network Model (GNM) normal modes, and DAE/OpenSCAD projections.
---

# PDB & mmCIF 3D Macromolecular Structure (`.pdb`, `.cif`, `.mmcif`)

`@modelscript/pdb` (`languages/pdb`) provides native WebAssembly GLR parsing, backbone Ramachandran $(\phi, \psi)$ dihedral angle and steric clash verification, radius of gyration ($R_g$) calculation, **Gaussian Network Model (GNM)** elastic normal-mode fluctuation analysis, `DAEBuilder` lowering, and OpenSCAD / Modelica projections for **Protein Data Bank (`.pdb`)** and **PDBx/mmCIF (`.cif`)** 3D macromolecular structures.

---

## Supported Extensions & Standards

| Extension        | Format            | Description                                                                                                       |
| :--------------- | :---------------- | :---------------------------------------------------------------------------------------------------------------- |
| `.pdb`, `.ent`   | Legacy PDB Format | Fixed-column records (`HEADER`, `TITLE`, `SEQRES`, `HELIX`, `SHEET`, `SSBOND`, `ATOM`, `HETATM`, `CONECT`, `END`) |
| `.cif`, `.mmcif` | PDBx / mmCIF      | Macromolecular Crystallographic Information File (`data_`, `loop_`, `_atom_site.*`)                               |

---

## Governing Mathematical Formulation

### 1. Backbone Dihedral Angles $(\phi, \psi, \omega)$ & Radius of Gyration ($R_g$)

Given consecutive backbone atomic coordinates $\mathbf{r}_{\text{C}_{i-1}}, \mathbf{r}_{\text{N}_i}, \mathbf{r}_{\text{C}\alpha_i}, \mathbf{r}_{\text{C}_i}, \mathbf{r}_{\text{N}_{i+1}} \in \mathbb{R}^3$, bond vectors $\mathbf{b}_1, \mathbf{b}_2, \mathbf{b}_3$ define the peptide torsion angle via the four-quadrant normal projection:

$$
\theta(\mathbf{b}_1, \mathbf{b}_2, \mathbf{b}_3) = \operatorname{atan2}\!\left(
  \bigl((\mathbf{b}_1 \times \mathbf{b}_2) \times (\mathbf{b}_2 \times \mathbf{b}_3)\bigr) \cdot \frac{\mathbf{b}_2}{\|\mathbf{b}_2\|},\;
  (\mathbf{b}_1 \times \mathbf{b}_2) \cdot (\mathbf{b}_2 \times \mathbf{b}_3)
\right)
$$

yielding $\phi_i = \theta(\text{C}_{i-1}, \text{N}_i, \text{C}_{\alpha,i}, \text{C}_i)$ and $\psi_i = \theta(\text{N}_i, \text{C}_{\alpha,i}, \text{C}_i, \text{N}_{i+1})$. The mass-weighted center of mass $\mathbf{R}_{\text{cm}}$ and radius of gyration $R_g$ over $N$ atoms with atomic masses $m_k$ are:

$$
\mathbf{R}_{\text{cm}} = \frac{\sum_{k=1}^N m_k \mathbf{r}_k}{\sum_{k=1}^N m_k}, \qquad R_g = \sqrt{\frac{\sum_{k=1}^N m_k \|\mathbf{r}_k - \mathbf{R}_{\text{cm}}\|^2}{\sum_{k=1}^N m_k}}
$$

### 2. Gaussian Network Model (GNM) & Crystallographic $B$-Factors

In the coarse-grained Tirion / Bahar **Gaussian Network Model (GNM)**, each residue is represented by its $\text{C}_\alpha$ node ($i = 1, \dots, n$) connected by uniform harmonic springs $\gamma$ within a cutoff radius $r_c = 7.0\text{ \AA}$. The $n \times n$ Kirchhoff contact matrix $\boldsymbol{\Gamma}$ is defined by:

$$
\Gamma_{ij} = \begin{cases}
  -1 & \text{if } i \ne j \text{ and } \|\mathbf{r}_{\text{C}\alpha,i} - \mathbf{r}_{\text{C}\alpha,j}\| \le r_c, \\
  0  & \text{if } i \ne j \text{ and } \|\mathbf{r}_{\text{C}\alpha,i} - \mathbf{r}_{\text{C}\alpha,j}\| > r_c, \\
  -\sum_{k \ne i} \Gamma_{ik} & \text{if } i = j.
\end{cases}
$$

Using the Moore-Penrose pseudoinverse $\boldsymbol{\Gamma}^+$ (excluding the trivial zero translational eigenmode $\lambda_1 = 0$), theoretical equilibrium mean-square residue fluctuations and isotropic X-ray Debye-Waller $B$-factors are:

$$
\langle (\Delta \mathbf{R}_i)^2 \rangle = \frac{3 k_B T}{\gamma} \left[\boldsymbol{\Gamma}^+\right]_{ii}, \qquad B_i^{\text{calc}} = \frac{8 \pi^2}{3} \langle (\Delta \mathbf{R}_i)^2 \rangle
$$

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Direct `DAEBuilder` Lowering (`lowerPdbToDae`)**: Lowers the coarse-grained $\text{C}_\alpha$ elastic network $M_i \ddot{\mathbf{u}}_i + \eta \dot{\mathbf{u}}_i + \gamma \sum_j \Gamma_{ij} \mathbf{u}_j = \mathbf{0}$ into continuous state and derivative equations in `@modelscript/runtime`'s `DAEBuilder` arena.
- **OpenSCAD 3D CSG Projection (`pdbToScad`)**: Exports secondary-structure ribbons, $\text{C}_\alpha$ elastic contact networks, and ball-and-stick atomic spheres/cylinders to [OpenSCAD](./scad.md) (`.scad`).
- **Modelica Multibody Projection (`pdbToModelica`)**: Generates acausal harmonic spring-damper macromolecular models in [Modelica](./modelica.md).

---

## Pre-Flight Diagnostics

<LintRules lang="pdb" />

---

## CLI Usage

```bash
# Validate steric clashes, peptide bond lengths, occupancy, and B-factors
msx lint CrambeTrypsinInhibitor.pdb

# Parse and inspect PDB or mmCIF macromolecular records
msx parse CrambeTrypsinInhibitor.pdb

# Run domain-specific PDB structural and GNM normal-mode inspection
msx domain pdb inspect CrambeTrypsinInhibitor.pdb
```

---

## Programmatic TypeScript SDK

```typescript
import { analyzePdbStructure, lintPdb, lowerPdbToDae, parsePdb, pdbToModelica, pdbToScad } from "@modelscript/pdb";

const structure = parsePdb(pdbText);
const diagnostics = lintPdb(structure);
const metrics = analyzePdbStructure(structure);
const dae = lowerPdbToDae(structure);
const scadCode = pdbToScad(structure);
const moCode = pdbToModelica(structure);
```
