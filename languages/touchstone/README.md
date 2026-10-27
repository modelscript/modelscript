<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/touchstone

Touchstone 1.0/2.0 N-port microwave and high-speed interconnect scattering/admittance/impedance ($S, Y, Z, H, G$) network modeling and rational vector-fitting macromodeling package (`.s1p`, `.s2p`, `.s3p`, `.s4p`, `.s5p`, `.s6p`, `.s7p`, `.s8p`, `.s9p`, `.s10p`, `.s12p`, `.s16p`, `.s24p`, `.s32p`, `.ts2`) for ModelScript. Features a Touchstone v1/v2 parser (`parseTouchstone`), multi-file workspace indexing (`TouchstoneWorkspaceIndex`), spectral-norm passivity verification and Gustavsen-Semlyen rational vector fitting (`verifyPassivity`, `fitStateSpaceModel`), direct linear-memory `DAEBuilder` state-space macromodel lowering (`lowerTouchstoneToDae`), 10 pre-flight RF/microwave lint rules (`M8301`–`M8312`), Modelica 3.x N-port state-space projections (`touchstoneToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Touchstone 1.0 & 2.0 N-Port Parser (`parseTouchstone`)**: Parses `.s1p`–`.s32p` and `.ts2` frequency-domain network data files, handling `# <freq_unit> <param> <format> R <R_ref>` option lines (`Hz`, `kHz`, `MHz`, `GHz`; `S`, `Y`, `Z`, `H`, `G`; `RI` real/imaginary, `MA` magnitude/angle, `DB` decibel/angle), Touchstone 2.0 `[Version] 2.0`, `[Number of Ports]`, `[Reference]`, and `[Network Data]` blocks, automatic 2-port $S_{11}, S_{21}, S_{12}, S_{22}$ column ordering, and conversion to normalized complex $N \times N$ scattering matrices $\mathbf{S}(f) \in \mathbb{C}^{N \times N}$.
- **Spectral-Norm Passivity Verifier & Rational Vector Fitting (`verifyPassivity`, `fitStateSpaceModel`)**:
  - **Passivity Verification**: Evaluates the maximum singular value (spectral norm $\|\mathbf{S}(j\omega)\|_2 = \sqrt{\lambda_{\max}(\mathbf{S}^H \mathbf{S})} \le 1.0$) at every frequency sample to verify energy conservation ($\mathbf{I} - \mathbf{S}^H \mathbf{S} \succeq \mathbf{0}$).
  - **Rational Pole-Residue Vector Fitting**: Fits stable left-half-plane complex conjugate poles ($\text{Re}(p_k) < 0$) and residue matrices $\mathbf{R}_k$ to synthesize a time-domain state-space macromodel:
    $$\mathbf{H}(s) \approx \mathbf{D} + \sum_{k=1}^{M} \frac{\mathbf{R}_k}{s - p_k} \quad \Longleftrightarrow \quad \dot{\mathbf{x}}(t) = \mathbf{A}\mathbf{x}(t) + \mathbf{B}\mathbf{a}(t), \quad \mathbf{b}(t) = \mathbf{C}\mathbf{x}(t) + \mathbf{D}\mathbf{a}(t)$$
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerTouchstoneToDae`)**: Lowers vector-fitted companion state-space ODEs ($\dot{\mathbf{x}} = \mathbf{A}\mathbf{x} + \mathbf{B}\mathbf{u}$, $\mathbf{y} = \mathbf{C}\mathbf{x} + \mathbf{D}\mathbf{u}$) and port incident/reflected wave relations ($a_k = \frac{V_k + R_0 I_k}{2\sqrt{R_0}}$, $b_k = \frac{V_k - R_0 I_k}{2\sqrt{R_0}}$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight RF/Microwave & Signal-Integrity Lint Rules (`M8301`–`M8312`, `lintTouchstone`)**: Static verification of N-port passivity ($\|\mathbf{S}(f)\|_2 \le 1.0$), Kramers-Kronig Hilbert-transform causality, strictly increasing frequency grids, `#` option line completeness, incomplete $N \times N$ matrix rows, reference impedance positivity ($R_0 > 0$), passive reciprocity symmetry ($|S_{ij} - S_{ji}|$), and duplicate frequency points.
- **Modelica 3.x N-Port State-Space Projection (`touchstoneToModelica`)**: Synthesizes standalone Modelica 3.x time-domain N-port state-space macromodels for transient circuit and high-speed channel co-simulation.
- **Multi-File Workspace Indexing & LSP (`TouchstoneWorkspaceIndex`, `provideTouchstoneHover`, `provideTouchstoneCompletions`)**: Implements `IWorkspaceIndex` across `.sNp` and `.ts2` files with insertion-loss / return-loss dB hover cards, option-line completions, and AST writeback.

---

## Package Structure

| Path                                        | Description                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                              | Public package exports                                                                                                                                                  |
| `src/language.ts`                           | `touchstoneLanguage` definition and LSP actions (`lint_touchstone`, `touchstone_passivity`, `touchstone_to_dae`, `touchstone_to_modelica`, `touchstone_fit_macromodel`) |
| `src/types.ts`                              | `TouchstoneDeck`, `TouchstoneOptions`, `FrequencyPoint`, `Complex`, `PassivityReport`, and `StateSpaceModel` interfaces                                                 |
| `src/errors.ts`                             | `TouchstoneErrorCode` diagnostic registry (`M8301`–`M8312`)                                                                                                             |
| `src/parser/touchstone-parser.ts`           | `parseTouchstone` parser for Touchstone 1.0/2.0 `.s1p`–`.s32p` and `.ts2` files                                                                                         |
| `src/lints/touchstone-linter.ts`            | `lintTouchstone` passivity, causality, reciprocity, and frequency monotonicity linter                                                                                   |
| `src/lints/index.ts`                        | Linter barrel exports                                                                                                                                                   |
| `src/solvers/vector-fitting.ts`             | `verifyPassivity` and `fitStateSpaceModel` spectral-norm passivity and rational pole-residue vector fitting engine                                                      |
| `src/dae/touchstone-to-dae.ts`              | `lowerTouchstoneToDae` direct lowering of N-port state-space macromodels into `DAEBuilder` linear memory                                                                |
| `src/projections/touchstone-to-modelica.ts` | `touchstoneToModelica` translator to Modelica 3.x time-domain N-port state-space models                                                                                 |
| `src/workspace-index.ts`                    | `TouchstoneWorkspaceIndex` implementing `IWorkspaceIndex` across `.sNp` and `.ts2` files                                                                                |
| `src/lsp.ts`                                | LSP hover, completion, and symbol providers                                                                                                                             |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                            | Severity  | Description                                                                                                    |
| ------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `M8301` | `passivity-violation`           | `error`   | N-port scattering matrix violates the passivity criterion (spectral norm $\lVert\mathbf{S}(f)\rVert_2 > 1.0$). |
| `M8302` | `causality-violation`           | `error`   | Kramers-Kronig causality relation is violated across the frequency sweep.                                      |
| `M8304` | `frequency-grid-non-monotonic`  | `error`   | Frequency grid is not monotonically increasing ($f_{k} \le f_{k-1}$).                                          |
| `M8306` | `missing-option-line`           | `warning` | Missing `'#'` option line; defaulting to `'# GHz S MA R 50'`.                                                  |
| `M8307` | `invalid-parameter-format`      | `error`   | Invalid Touchstone parameter token or data format (`'token'`).                                                 |
| `M8308` | `incomplete-matrix-data`        | `error`   | Incomplete N-port matrix row: expected $2N^2$ numeric values for the frequency sample.                         |
| `M8309` | `negative-reference-resistance` | `error`   | Reference resistance $R_0$ (`'r'`) must be strictly positive ($> 0\ \Omega$).                                  |
| `M8310` | `asymmetric-reciprocal-network` | `warning` | Asymmetry in reciprocal S-parameter network: $\lvert S_{ij} - S_{ji}\rvert$ exceeds reciprocity threshold.     |
| `M8311` | `no-frequency-points`           | `error`   | Touchstone file contains no valid frequency parameter points.                                                  |
| `M8312` | `duplicate-frequency-point`     | `error`   | Duplicate frequency sample point `'freq'` encountered in the sweep.                                            |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect Touchstone version, port count, reference impedance, and frequency range
npx msx touchstone inspect backplane.s2p

# Run pre-flight passivity, causality, reciprocity, and grid monotonicity checks (M8301-M8312)
npx msx touchstone lint backplane.s2p

# Verify spectral-norm passivity (||S(f)||_2 <= 1.0) across all frequency points
npx msx touchstone passivity backplane.s2p

# Fit a rational pole-residue state-space macromodel via vector fitting
npx msx touchstone fit backplane.s2p --order 4

# Lower N-port state-space macromodel to DAEBuilder linear memory or export to Modelica
npx msx touchstone to-dae backplane.s2p --order 4
npx msx touchstone to-modelica backplane.s2p -o BackplaneChannel.mo
```

### Programmatic Usage

```typescript
import {
  fitStateSpaceModel,
  lintTouchstone,
  lowerTouchstoneToDae,
  parseTouchstone,
  touchstoneToModelica,
  verifyPassivity,
} from "@modelscript/touchstone";

const s2pContent = `
! 2-Port Microstrip Low-Pass Filter
# GHz S MA R 50
1.0  0.12 -15.0  0.96 -45.0  0.96 -45.0  0.12 -15.0
2.0  0.25 -32.0  0.91 -90.0  0.91 -90.0  0.25 -32.0
3.0  0.42 -55.0  0.82 -135.0 0.82 -135.0 0.42 -55.0
`;

// 1. Parse Touchstone .s2p file and run M8301-M8312 pre-flight diagnostics
const deck = parseTouchstone(s2pContent, "filter.s2p");
const diagnostics = lintTouchstone(deck);

// 2. Verify passivity (||S(f)||_2 <= 1.0) and fit a rational state-space macromodel
const passivity = verifyPassivity(deck);
const macromodel = fitStateSpaceModel(deck, 2);
console.log(passivity.isPassive, passivity.maxNorm, macromodel.poles);

// 3. Lower state-space macromodel to DAEBuilder linear memory or export to Modelica
const dae = lowerTouchstoneToDae(deck, { macromodelOrder: 2 });
const modelicaCode = touchstoneToModelica(deck);
```

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run Touchstone parser, linter, passivity, vector fitting, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |
