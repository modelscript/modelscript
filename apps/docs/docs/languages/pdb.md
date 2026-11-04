# PDB & mmCIF 3D Macromolecular Structure (`.pdb`, `.cif`, `.mmcif`)

`@modelscript/pdb` (`languages/pdb`) provides native WebAssembly GLR parsing, backbone Ramachandran $(\phi, \psi)$ dihedral angle and steric clash verification, radius of gyration ($R_g$) calculation, **Gaussian Network Model (GNM)** elastic normal-mode fluctuation analysis, `DAEBuilder` lowering, and OpenSCAD / Modelica projections for **Protein Data Bank (`.pdb`)** and **PDBx/mmCIF (`.cif`)** 3D macromolecular structures.

---

## Supported Extensions & Standards

| Extension        | Format            | Description                                                                                                       |
| :--------------- | :---------------- | :---------------------------------------------------------------------------------------------------------------- |
| `.pdb`, `.ent`   | Legacy PDB Format | Fixed-column records (`HEADER`, `TITLE`, `SEQRES`, `HELIX`, `SHEET`, `SSBOND`, `ATOM`, `HETATM`, `CONECT`, `END`) |
| `.cif`, `.mmcif` | PDBx / mmCIF      | Macromolecular Crystallographic Information File (`data_`, `loop_`, `_atom_site.*`)                               |

---

## Key Capabilities

### 1. Atomic Coordinates, Secondary Structure & Disulfide Bridges

- Extracts multi-chain 3D atomic coordinates $(x, y, z)$, occupancy, isotropic temperature factors ($B$-factors), $\alpha$-helices (`HELIX`), $\beta$-sheets (`SHEET`), disulfide bonds (`SSBOND`), and ligand connectivity (`CONECT`).
- Computes backbone torsion angles $(\phi, \psi, \omega)$, center of mass, and mass-weighted radius of gyration $R_g$.

### 2. Gaussian Network Model (GNM) Elastic Normal Modes

- Constructs the $C_\alpha$ Kirchhoff contact matrix $\boldsymbol{\Gamma}$ ($r_c = 7.0\text{ \AA}$) to compute theoretical residue mean-square fluctuations $\langle (\Delta \mathbf{R}_i)^2 \rangle \propto [\boldsymbol{\Gamma}^{-1}]_{ii}$ and correlate them against crystallographic $B$-factors.

### 3. DAE Arena Lowering & 3D CSG / Modelica Export

- Lowers coarse-grained $C_\alpha$ harmonic spring networks into `@modelscript/runtime`'s `DAEBuilder` arena and projects structures into **Modelica** (`pdbToModelica`) and **OpenSCAD** 3D ball-and-stick CSG geometry (`pdbToScad`).

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
```
