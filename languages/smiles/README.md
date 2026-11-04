<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/smiles

Cheminformatics molecular graph parser for **SMILES / SMARTS** (`.smi`, `.smarts`) and **MDL Molfile V2000 / SDF** (`.mol`, `.sdf`), with automated **Joback & Reid group-contribution thermophysical property estimation** for ModelScript. Features a zero-regex character-by-character SMILES/SMARTS & MDL Molfile V2000/SDF parser (`parseSmiles`, `parseMolfile`, `parseSdf`, `parseSmilesDocument`), multi-file workspace indexing (`SmilesWorkspaceIndex`), exact Hill formula & molar mass calculation, Euler characteristic ring counting ($R = E - V + C$), Ertl topological polar surface area (TPSA), Wildman-Crippen $\log P$, Joback & Reid (1987) critical & thermochemical property estimation (`estimateThermophysicalProperties`, `solveMolecularProperties`), direct linear-memory `DAEBuilder` lowering (`lowerSmilesToDae`), 10 pre-flight cheminformatics & valence lint rules (`M9301`–`M9310`, `lintSmiles`), Modelica 3.x & Aspen Plus property projections (`smilesToModelica`, `smilesToAspenDeck`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex SMILES/SMARTS & MDL Molfile V2000/SDF Parser (`parseSmiles`, `parseMolfile`, `parseSdf`, `parseSmilesDocument`)**:
  - **Unbracketed Organic & Aromatic Subset**: `B, C, N, O, P, S, F, Cl, Br, I` and aromatic `b, c, n, o, p, s` with automatic OpenSMILES implicit hydrogen calculation.
  - **Bracketed Atoms & Stereochemistry**: Isotopes (`[13CH4]`), formal charges (`[NH4+]`, `[O-]`), tetrahedral chirality (`[C@H]`, `[C@@H]`), explicit hydrogens, and atom map numbers (`[CH3:1]`).
  - **Topology & Connection Tables**: Explicit bonds (`-`, `=`, `#`, `:`, `/`, `\`), nested branches (`(...)`), ring closures (`1..9` and `%10..%99`), disconnected fragments (`.`), multi-line `.smi` libraries, and MDL Molfile V2000 / `$$$$`-delimited SDF records with `M  CHG`, `M  ISO`, and `> <Field>` data blocks.
- **Joback & Reid Group-Contribution & Cheminformatics Solver (`estimateThermophysicalProperties`, `solveMolecularProperties`)**:
  - Computes exact **Hill system molecular formula**, IUPAC average molecular weight, monoisotopic exact mass, connected components, and **Euler characteristic ring count** ($R = E - V + C$).
  - Evaluates Lipinski H-bond donors/acceptors, rotatable bonds, **Ertl TPSA**, and **Wildman-Crippen $\log P$**.
  - Decomposes the molecular graph into **Joback & Reid (1987)** functional groups (`-CH3`, `-CH2-`, `>CH-`, `ring =CH-`, `-OH`, `-COOH`, `-COO-`, `>C=O`, `-NH2`, etc.) to estimate normal boiling point $T_b$, critical temperature $T_c$, critical pressure $P_c$, critical molar volume $V_c$, Lee-Kesler acentric factor $\omega$, standard enthalpy of formation $\Delta H_f^\circ(298\,\text{K})$, Gibbs energy of formation $\Delta G_f^\circ(298\,\text{K})$, ideal-gas heat capacity polynomial $C_p^\circ(T) = a + bT + cT^2 + dT^3$, and Antoine vapor-pressure coefficients.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSmilesToDae`)**: Compiles species critical parameters, ideal-gas $C_p^\circ(T)$ polynomials, Antoine saturation vapor pressure equations, and vapor-liquid equilibrium $K$-values directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Cheminformatics & Valence Lint Rules (`M9301`–`M9310`, `lintSmiles`)**: Static verification of unclosed ring digits, unbalanced branch parentheses, maximum covalent valence bounds, Hückel $4n+2$ aromatic ring rules, IUPAC element symbols, conflicting ring bond orders, self-loop bonds, duplicate atom bonds, and tetrahedral stereocenters.
- **Modelica 3.x & Aspen Plus Projections (`smilesToModelica`, `smilesToAspenDeck`, `smilesToAspenComponent`)**: Synthesizes standalone Modelica 3.x thermodynamic species models and Aspen Plus `COMPONENTS` / `PROP-DATA` cards.

---

## Package Structure

| Path                                    | Description                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                           |
| `src/language.ts`                       | `smilesLanguage` definition and LSP actions (`lint_smiles`, `smiles_estimate_properties`, `smiles_to_dae`, etc.) |
| `src/types.ts`                          | `SmilesDocument`, `MolecularGraph`, `MoleculeAtom`, `MoleculeBond`, `ThermophysicalEstimate`, and range types    |
| `src/errors.ts`                         | `SmilesErrorCode` diagnostic registry (`M9301`–`M9310`)                                                          |
| `src/parser/smiles-parser.ts`           | Zero-regex `parseSmiles`, `parseMolfile`, `parseSdf`, `parseSmilesDocument`, and `serializeSmiles`               |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                            |
| `src/lints/smiles-linter.ts`            | `lintSmiles` valence, ring-closure, Hückel $4n+2$ aromaticity, and stereocenter diagnostic engine                |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                            |
| `src/solvers/property-estimator.ts`     | `estimateThermophysicalProperties` and `solveMolecularProperties` Joback-Reid & topological property solver      |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                            |
| `src/dae/smiles-to-dae.ts`              | `lowerSmilesToDae` direct lowering of species thermophysical equations into `DAEBuilder` linear memory           |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                      |
| `src/projections/smiles-to-modelica.ts` | `smilesToModelica`, `smilesToAspenDeck`, and `smilesToAspenComponent` translators to Modelica 3.x and Aspen Plus |
| `src/projections/index.ts`              | Projections barrel exports                                                                                       |
| `src/workspace-index.ts`                | `SmilesWorkspaceIndex` implementing `IWorkspaceIndex` across `.smi`, `.smarts`, `.mol`, and `.sdf` files         |
| `src/lsp.ts`                            | LSP hover, completion, diagnostic, and symbol providers                                                          |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                            | Severity  | Description                                                                                                               |
| ------- | ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `M9301` | `unclosed-ring-digit`           | `error`   | Ring closure digit `'ringId'` in `'moleculeName'` has no matching closing bond.                                           |
| `M9302` | `unbalanced-branch-parenthesis` | `error`   | Branch parenthesis in `'moleculeName'` is unbalanced.                                                                     |
| `M9303` | `valence-exceeded`              | `error`   | Atom `'element'` (index `'atomIndex'`) in `'moleculeName'` has bond order sum `'actualValence'` exceeding `'maxValence'`. |
| `M9304` | `invalid-aromatic-kekule-ring`  | `error`   | Aromatic ring in `'moleculeName'` violates Hückel's $4n+2$ $\pi$-electron rule or cannot be Kekulized.                    |
| `M9305` | `unknown-chemical-element`      | `error`   | Atomic symbol `'symbol'` in `'moleculeName'` is not a valid IUPAC element.                                                |
| `M9306` | `conflicting-ring-bond-order`   | `error`   | Ring closure `'ringId'` in `'moleculeName'` specifies conflicting bond orders at opening and closing atoms.               |
| `M9307` | `self-loop-bond`                | `error`   | Bond in `'moleculeName'` connects atom `'atomIndex'` to itself.                                                           |
| `M9308` | `duplicate-atom-bond`           | `error`   | Multiple bonds declared between identical atom pair (`'atomA'`, `'atomB'`) in `'moleculeName'`.                           |
| `M9309` | `invalid-tetrahedral-chirality` | `warning` | Chiral center `'atomIndex'` (`@` / `@@`) in `'moleculeName'` has fewer than 4 distinct substituents.                      |
| `M9310` | `empty-molecular-graph`         | `error`   | Molecule entry `'moleculeName'` contains zero atoms.                                                                      |

---

## Programmatic Usage

```typescript
import {
  estimateThermophysicalProperties,
  lintSmiles,
  lowerSmilesToDae,
  parseSmiles,
  smilesToAspenDeck,
  smilesToModelica,
} from "@modelscript/smiles";

// 1. Parse SMILES molecule and run M9301-M9310 pre-flight diagnostics
const aspirin = parseSmiles("CC(=O)Oc1ccccc1C(=O)O", "Aspirin");
const diagnostics = lintSmiles(aspirin);

// 2. Estimate exact molecular formula, weight, TPSA, logP, and Joback critical properties
const props = estimateThermophysicalProperties(aspirin);
console.log(props.formula, props.molecularWeight, props.Tb, props.Tc, props.Pc);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x and Aspen Plus
const dae = lowerSmilesToDae(aspirin);
const modelicaCode = smilesToModelica(aspirin, "AspirinThermo");
const aspenDeck = smilesToAspenDeck(aspirin, "Aspirin Property Deck");
```

---

## Scripts

| Command             | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                                |
| `npm test`          | Run SMILES/Molfile/SDF parser, linter, Joback estimator, DAE, projection, and LSP unit tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                        |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                         |
| `npm run clean`     | Remove `dist/` build artifacts                                                               |
