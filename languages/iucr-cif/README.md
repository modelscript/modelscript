<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/iucr-cif

**Maturity:** Beta · **Extensions:** `.cif`, `.mcif`, `.star` · **Docs:** [modelscript.org/languages/iucr-cif](https://modelscript.org/languages/iucr-cif)

Native **IUCr Crystallographic Information File (CIF / STAR 1.1)** crystal-structure modeling, crystallography solver, powder X-ray diffraction (XRD) simulator, and interactive 3D-projected lattice viewer package for ModelScript. Supports full STAR/CIF 1.1 syntax (`data_`, `loop_`, `_tag value`, single/double-quoted strings, `;...;` multiline semicolon blocks, `?`/`.` missing/inapplicable tokens, standard uncertainties such as `5.4310(2)`, and `#` comments), triclinic-to-cubic metric tensor geometry, Wyckoff symmetry expansion, Cu-$K\alpha$ Bragg powder XRD simulation, direct linear-memory `DAEBuilder` lowering, PDB/XYZ/MDL Molfile projections, 14 crystallographic lint rules (`ICIF1001`–`ICIF5006`), and a React + SVG crystal lattice & powder XRD viewer panel.

---

## Core Capabilities

- **WASM GLR & STAR/CIF 1.1 Parser (`parseIucrCif`, `extractCrystalStructure`, `iucrCifLanguage`)**: Parses multi-block CIF/STAR 1.1 files with standard uncertainties, semicolon-delimited text blocks, loops, and both CIF 1.0 and CIF 2.0 symmetry/cell aliases.
- **Crystallography & Powder XRD Solver (`computeMetricTensor`, `expandSymmetrySites`, `findPeriodicBonds`, `computeTheoreticalDensity`, `simulatePowderXrd`, `solveCrystalStructure`)**:
  - Triclinic-to-cubic metric tensor $G$, unit-cell volume $V = \sqrt{\det G}$, reciprocal metric tensor $G^* = G^{-1}$, and fractional $\leftrightarrow$ Cartesian orthogonalization.
  - Affine `_symmetry_equiv_pos_as_xyz` Wyckoff expansion with periodic modulo-1 deduplication and minimum-image nearest-neighbor bond detection.
  - Cu-$K\alpha$ ($\lambda = 1.5406\,\text{\AA}$) powder XRD $d_{hkl}$, $2\theta$, Cromer-Mann atomic scattering factor $f_j(s)$, complex structure factor $|F_{hkl}|^2$, Lorentz-polarization correction, and broadened diffraction profile.
- **Direct Continuous DAE Arena Lowering (`cifToDae`, `lowerCifToDae`)**: Lowers unit-cell metric tensor components, unit-cell volume ($V^2 = \det G$), density, and Bragg diffraction equations ($2 d_{hkl} \sin\theta = \lambda$) directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Crystallographic Linter (`lintIucrCif`, `IucrCifErrorCode`)**: 14 domain diagnostics (`ICIF1001`–`ICIF5006`) checking STAR syntax, duplicate `data_` blocks/tags, `loop_` column divisibility, non-positive cell lengths, invalid cell angles, degenerate metric tensors, missing fractional coordinates, invalid occupancies, and overlapping symmetry-expanded atoms ($< 0.5\,\text{\AA}$).
- **Polyglot Projections (`cifToPdb`, `cifToXyz`, `cifToMolfile`)**: Projects crystal structures to RCSB PDB (`CRYST1` + `ATOM` + `CONECT`), Cartesian XYZ, and MDL Molfile V2000.
- **Interactive SVG Visualization & React Panel (`renderIucrCifSvg`, `IucrCifPanel`)**: Pure SVG isometric 3D-projected unit-cell lattice (atoms, bonds, unit-cell wireframe) + simulated Cu-$K\alpha$ powder XRD pattern, integrated into a React `@modelscript/design-tokens/panel` viewer.
- **Cleanroom Standard Library (`@modelscript/iucr-cif-std-lib`)**: Core CIF dictionary categories (`_cell`, `_symmetry`, `_atom_site`, `_diffrn`) and canonical crystal templates (Silicon $Fd\bar{3}m$, NaCl $Fm\bar{3}m$, $\alpha$-Quartz $P3_121$, FCC Copper $Fm\bar{3}m$) with AssemblyScript WASM runtime.

---

## Package Structure

| Path                                    | Description                                                                                |
| :-------------------------------------- | :----------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                     |
| `src/language.ts`                       | `iucrCifLanguage` WASM GLR grammar and UI panel registration (`.cif`, `.mcif`, `.star`)    |
| `src/types.ts`                          | STAR/CIF AST and crystallographic domain types                                             |
| `src/errors.ts`                         | `IucrCifErrorCode` (`ICIF1001`–`ICIF5006`) diagnostic definitions                          |
| `src/parser/cif-parser.ts`              | STAR/CIF 1.1 lexer, parser, standard-uncertainty parser, and structure extractor           |
| `src/lints/index.ts`                    | `lintIucrCif` syntactic, structural, metric, and steric-overlap validator                  |
| `src/solver/crystallography.ts`         | Metric tensor, orthogonalization, Wyckoff expansion, periodic bonds, and density           |
| `src/solver/xrd.ts`                     | Cu-$K\alpha$ Bragg powder XRD structure-factor and profile simulator                       |
| `src/dae/lowering.ts`                   | `lowerCifToDae` and `cifToDae` direct `DAEBuilder` lowering                                |
| `src/projections/`                      | `cifToPdb`, `cifToXyz`, and `cifToMolfile` structural projections                          |
| `src/catalog/iucr-cif-std-schemas.ts`   | Cleanroom CIF dictionary & canonical crystal schemas + SVG icons                           |
| `assets/iucr-cif-std-lib/src/models.ts` | AssemblyScript WASM crystallography & Bragg diffraction runtime                            |
| `src/diagram/crystal-svg.ts`            | `renderIucrCifSvg` 3D-projected crystal lattice & powder XRD SVG renderer                  |
| `src/ui/IucrCifPanel.tsx`               | Interactive React crystal lattice & powder XRD viewer/editor panel                         |
| `src/indexing.ts`                       | `iucrCifIndexing` UnifiedWorkspace indexer                                                 |
| `src/lsp.ts`                            | `validateIucrCif`, `getIucrCifDocumentSymbols`, `getIucrCifHover`, `getIucrCifCompletions` |
