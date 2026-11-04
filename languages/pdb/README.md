<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/pdb

**Protein Data Bank (`.pdb`, `.ent`) & Macromolecular Crystallographic Information File (`.cif`, `.mmcif`) 3D Structural Biology** parser, stereochemical validator, **Gaussian Network Model (GNM) elastic fluctuation solver**, and coarse-grained dynamical compiler for ModelScript. Features a zero-regex character-by-character wwPDB v3.3 and PDBx/mmCIF STAR parser (`parsePdb`, `parseMmCif`, `serializePdb`), multi-file workspace indexing (`PdbWorkspaceIndex`), 3D backbone Ramachandran $(\phi, \psi, \omega)$ dihedral calculation (`computeRamachandranAngles`), mass-weighted radius of gyration $R_g$ and Bahar–Atilgan $\text{C}_\alpha$ Kirchhoff matrix $\Gamma$ eigendecomposition (`solveProteinBiophysics`), direct linear-memory `DAEBuilder` lowering (`lowerPdbToDae`), 10 structural biology & crystallographic pre-flight lint rules (`M9251`–`M9260`, `lintPdb`), Modelica 3.x coarse-grained elastic network oscillator projection (`pdbToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex wwPDB v3.3 & PDBx/mmCIF Parser (`parsePdb`, `parseMmCif`, `serializePdb`)**:
  - **wwPDB v3.3 Records**: Parses `HEADER`, `TITLE`, `REMARK` (crystallographic resolution), `HELIX`, `SHEET`, `SSBOND`, `ATOM`, `HETATM`, `CONECT`, `MODEL`/`ENDMDL`, `TER`, and `END`, plus round-trip 80-column serialization (`serializePdb`).
  - **PDBx/mmCIF STAR Syntax**: Character-by-character lexer for `data_` blocks, scalar tags (`_entry.id`, `_struct.title`, `_refine.ls_d_res_high`), and `loop_` tables (`_atom_site.*`, `_struct_conf.*`, `_struct_conn.*`).
  - **Hierarchical Grouping**: Automatically organizes atomic coordinates into `PdbResidue` and `PdbChain` objects with canonical 1-letter amino acid sequences.
- **Biophysics & Gaussian Network Model (GNM) Solver (`solveProteinBiophysics`)**:
  - Computes exact **mass-weighted center of mass** $\mathbf{R}_{\text{CM}}$, **molecular weight** (Da), **end-to-end $\text{C}_\alpha$ distance**, and **radius of gyration**:
    $$R_g = \sqrt{\frac{\sum_{i=1}^{N} m_i \|\mathbf{r}_i - \mathbf{R}_{\text{CM}}\|^2}{\sum_{i=1}^{N} m_i}}$$
  - Evaluates 3D **Ramachandran backbone dihedral torsions** $(\phi_i, \psi_i, \omega_i)$ across all polypeptide chains and classifies residues into `favored_alpha`, `favored_beta`, `allowed`, `glycine_proline`, and steric `outlier` regions.
  - Constructs the $\text{C}_\alpha$ **contact map** ($r_c = 7.0\text{ \AA}$) and symmetric **Kirchhoff matrix** $\Gamma$, computing the Moore–Penrose pseudoinverse $\Gamma^+$ via Jacobi eigendecomposition to predict **mean-square thermal fluctuations** $\langle (\Delta \mathbf{R}_i)^2 \rangle = \frac{3 k_B T}{\gamma} \Gamma^+_{ii}$, theoretical **crystallographic B-factors** $B_i = \frac{8\pi^2}{3}\langle (\Delta \mathbf{R}_i)^2 \rangle$, and Pearson correlation $r$ against experimental X-ray B-factors.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerPdbToDae`)**: Compiles 3D $\text{C}_\alpha$ equilibrium coordinates, Kirchhoff harmonic spring restoring forces $\mathbf{F}_i = -\gamma \sum_j \Gamma_{ij} \mathbf{u}_j$, and damped Langevin oscillator ODEs directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena.
- **10 Structural Biology & Crystallographic Lint Rules (`M9251`–`M9260`, `lintPdb`)**: Static verification of non-bonded steric clashes ($< 1.2\text{ \AA}$), broken peptide backbones ($\text{C}_i\text{--N}_{i+1} > 2.0\text{ \AA}$), fractional occupancy bounds, non-positive B-factors, Ramachandran steric outliers, missing main-chain atoms (`N`, `CA`, `C`), disulfide `SG`–`SG` bond lengths, unresolved `CONECT` serials, duplicate atom serials, and empty coordinate sets.
- **Modelica 3.x Elastic Network Projection (`pdbToModelica`)**: Generates standalone Modelica 3.x coarse-grained $\text{C}_\alpha$ elastic network multibody/oscillator models.

---

## Package Structure

| Path                                       | Description                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                             | Public package exports                                                                                                 |
| `src/language.ts`                          | `pdbLanguage` definition and LSP actions (`lint_pdb`, `pdb_solve_biophysics`, `pdb_to_dae`, `pdb_to_modelica`)         |
| `src/types.ts`                             | `PdbDocument`, `PdbStructure`, `PdbChain`, `PdbResidue`, `PdbAtom`, `RamachandranAngle`, and `ProteinBiophysicsResult` |
| `src/errors.ts`                            | `PdbErrorCode` diagnostic registry (`M9251`–`M9260`)                                                                   |
| `src/parser/pdb-parser.ts`                 | Zero-regex `parsePdb`, `parseMmCif`, and `serializePdb`                                                                |
| `src/parser/index.ts`                      | Parser barrel exports                                                                                                  |
| `src/lints/pdb-linter.ts`                  | `lintPdb`, `computeDihedralAngle`, and `computeRamachandranAngles` stereochemical validation engine                    |
| `src/lints/index.ts`                       | Linter barrel exports                                                                                                  |
| `src/solvers/protein-biophysics-solver.ts` | `solveProteinBiophysics` radius of gyration $R_g$, Ramachandran, and GNM Kirchhoff matrix solver                       |
| `src/solvers/index.ts`                     | Solver barrel exports                                                                                                  |
| `src/dae/pdb-to-dae.ts`                    | `lowerPdbToDae` direct lowering of $\text{C}_\alpha$ harmonic spring network ODEs into `DAEBuilder`                    |
| `src/dae/index.ts`                         | DAE lowering barrel exports                                                                                            |
| `src/projections/pdb-to-modelica.ts`       | `pdbToModelica` translator to Modelica 3.x coarse-grained elastic network oscillator models                            |
| `src/projections/index.ts`                 | Projections barrel exports                                                                                             |
| `src/workspace-index.ts`                   | `PdbWorkspaceIndex` implementing `IWorkspaceIndex` across `.pdb`, `.ent`, `.cif`, and `.mmcif` files                   |
| `src/lsp.ts`                               | LSP hover, completion, diagnostic, and symbol providers                                                                |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                         | Severity  | Description                                                                                               |
| ------- | ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `M9251` | `steric-clash`               | `error`   | Severe steric clash between non-bonded atoms `'atomA'` and `'atomB'` at distance $< 1.20\text{ \AA}$.     |
| `M9252` | `broken-peptide-backbone`    | `warning` | Consecutive residue $\text{C}_i\text{--N}_{i+1}$ peptide bond distance exceeds $2.00\text{ \AA}$.         |
| `M9253` | `invalid-occupancy`          | `error`   | Atom fractional occupancy is outside valid crystallographic bounds $[0.0, 1.0]$.                          |
| `M9254` | `non-positive-b-factor`      | `warning` | Atom isotropic temperature factor ($B$-factor) is non-positive ($\le 0.0\text{ \AA}^2$).                  |
| `M9255` | `ramachandran-outlier`       | `warning` | Non-glycine/non-proline residue has $(\phi, \psi)$ backbone torsion angles in a disallowed steric region. |
| `M9256` | `missing-backbone-atoms`     | `error`   | Standard amino acid residue is missing required main-chain backbone atoms (`N`, `CA`, or `C`).            |
| `M9257` | `invalid-disulfide-distance` | `warning` | `SSBOND` cysteine `SG`–`SG` distance is outside valid covalent bounds $[1.80, 2.50]\text{ \AA}$.          |
| `M9258` | `unresolved-conect-serial`   | `error`   | `CONECT` record references a non-existent atom serial number.                                             |
| `M9259` | `duplicate-atom-serial`      | `error`   | Duplicate atom serial number declared within the same model.                                              |
| `M9260` | `empty-pdb-structure`        | `error`   | Macromolecular structure contains zero atomic coordinate records.                                         |

---

## Programmatic Usage

```typescript
import { lintPdb, lowerPdbToDae, parsePdb, pdbToModelica, solveProteinBiophysics } from "@modelscript/pdb";

// 1. Parse a PDB or mmCIF structure and run M9251-M9260 stereochemical diagnostics
const doc = parsePdb(pdbSourceText);
const diagnostics = lintPdb(doc);

// 2. Compute Radius of Gyration Rg, Ramachandran torsions, and GNM Kirchhoff B-factors
const biophysics = solveProteinBiophysics(doc, { cutoffDistance: 7.0, temperature: 300.0 });
console.log(biophysics.radiusOfGyration, biophysics.ramachandranFavoredFraction, biophysics.bFactorCorrelation);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x
const dae = lowerPdbToDae(doc);
const modelicaCode = pdbToModelica(doc, "CrambinElasticNetwork");
```

---

## Scripts

| Command             | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                            |
| `npm test`          | Run PDB/mmCIF parser, linter, biophysics/GNM solver, DAE, projection, and LSP unit tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                    |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                     |
| `npm run clean`     | Remove `dist/` build artifacts                                                           |
