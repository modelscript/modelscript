<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/nmtran

NONMEM / NMTRAN pharmacometrics and clinical pharmacokinetic/pharmacodynamic (PK/PD) control stream modeling package (`.ctl`, `.mod`) for ModelScript. Features a zero-regex character-by-character NMTRAN control stream parser and serializer (`parseNmtran`, `serializeNmtran`), multi-file workspace indexing (`NmtranWorkspaceIndex`), a deterministic 1-, 2-, and 3-compartment analytical & custom `$DES` ODE solver supporting bolus, zero-order infusion, and multi-dose (`II`/`ADDL`) superposition (`solveNmtranPkPd`), direct linear-memory `DAEBuilder` lowering (`lowerNmtranToDae`), 10 pre-flight pharmacometric lint rules (`M9401`–`M9410`), Modelica 3.x PK/PD projections (`nmtranToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex NMTRAN Control Stream Parser & Serializer (`parseNmtran`, `serializeNmtran`)**: Character-by-character scanner extracting `$PROBLEM`, `$INPUT`, `$DATA`, `$SUBROUTINES` (`ADVAN1`–`ADVAN13`, `TRANS1`–`TRANS6`, `TOL`), `$MODEL` (`NCOMPARTMENTS`, `COMP=(name, DEFDOSE, DEFOBS)`), `$PK` algebraic assignments (`CL = THETA(1) * EXP(ETA(1))`), `$DES` differential equations (`DADT(i) = ...`), `$ERROR` residual error models (`IPRED`, `W`, `Y`, `EPS(n)`), `$THETA` bounded/fixed parameters (`(lower, init, upper)`, `init FIX`), `$OMEGA` diagonal and `BLOCK(n)` variance-covariance structures, `$SIGMA`, `$ESTIMATION`, `$SIMULATION`, and inline/tabular dosing records (`TIME`, `AMT`, `RATE`, `CMT`, `II`, `ADDL`, `EVID`).
- **Clinical PK/PD Dosing & Superposition Solver (`solveNmtranPkPd`)**: Simulates built-in PREDPP compartment models (`ADVAN1`–`ADVAN4`, `ADVAN10`–`ADVAN12`) and custom `$DES` ODE systems across IV bolus, zero-order infusion (`RATE > 0`), first-order oral absorption, bioavailability (`F1`..`Fn`), lag times (`ALAG1`..`ALAGn`), and multi-dose (`II`, `ADDL`) schedules, automatically computing $C_{\max}$, $T_{\max}$, terminal half-life $t_{1/2}$, and $\text{AUC}_{0\to t}$ / $\text{AUC}_{0\to\infty}$ via the trapezoidal rule.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerNmtranToDae`)**: Compiles `$THETA` parameters, `$OMEGA`/`$SIGMA` random effect placeholders, `$PK` parameter relationships, compartment amounts `A_i`, differential balance equations `der(A_i)`, and `$ERROR` predictions directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Pharmacometric Lint Rules (`M9401`–`M9410`, `lintNmtran`)**: Static verification of `$PROBLEM` records, `$THETA` lower/initial/upper bound ordering, required `$DES` blocks for general ODE subroutines (`ADVAN6`/`ADVAN8`/`ADVAN9`/`ADVAN13`), out-of-bounds `THETA(n)` and `ETA(n)` references, `$OMEGA` variance positivity, compartment index bounds (`DADT(i)`/`A(i)`), `$ERROR` dependent variable `Y` assignment, required `TRANS` parameterization (`CL`, `V`, `KA`, `Q`, etc.), and non-negative dosing `AMT`/`RATE`.
- **Modelica 3.x PK/PD Projection (`nmtranToModelica`)**: Synthesizes standalone Modelica 3.x pharmacokinetic and pharmacodynamic compartment models for whole-body PBPK and physiological co-simulation.
- **Multi-File Workspace Indexing & LSP (`NmtranWorkspaceIndex`, `getNmtranHover`, `provideNmtranCompletions`)**: Implements `IWorkspaceIndex` across `.ctl` and `.mod` control streams with parameter/compartment hover inspection, record/subroutine completions, and AST writeback.

---

## Package Structure

| Path                                    | Description                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                                         |
| `src/language.ts`                       | `nmtranLanguage` definition and LSP actions (`lint_nmtran`, `nmtran_simulate`, `nmtran_to_dae`, `nmtran_to_modelica`)                          |
| `src/types.ts`                          | `NmtranDocument`, `NmtranControlStream`, `ThetaSpec`, `OmegaSpec`, `SigmaSpec`, `CompartmentDef`, `PkStatement`, `DesEquation`, `DosingRecord` |
| `src/errors.ts`                         | `NmtranErrorCode` diagnostic registry (`M9401`–`M9410`)                                                                                        |
| `src/parser/nmtran-parser.ts`           | `parseNmtran` and `serializeNmtran` zero-regex NMTRAN control stream parser and serializer                                                     |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                                                          |
| `src/lints/nmtran-linter.ts`            | `lintNmtran` pharmacometric control stream diagnostic engine                                                                                   |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                                                          |
| `src/solvers/pkpd-solver.ts`            | `solveNmtranPkPd` compartmental & custom `$DES` PK/PD integrator with multi-dose superposition and NCA metrics                                 |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                                                          |
| `src/dae/nmtran-to-dae.ts`              | `lowerNmtranToDae` direct lowering of `$THETA`, `$PK`, and compartment ODEs into `DAEBuilder` linear memory                                    |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                                                    |
| `src/projections/nmtran-to-modelica.ts` | `nmtranToModelica` translator to Modelica 3.x pharmacokinetic/pharmacodynamic models                                                           |
| `src/projections/index.ts`              | Projections barrel exports                                                                                                                     |
| `src/workspace-index.ts`                | `NmtranWorkspaceIndex` implementing `IWorkspaceIndex` across `.ctl` and `.mod` files                                                           |
| `src/lsp.ts`                            | LSP validation, document symbols, hover, completion, and action providers                                                                      |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                  | Severity | Description                                                                                                                   |
| ------- | ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `M9401` | `missing-problem-record`              | `error`  | NMTRAN control stream is missing the required `'$PROBLEM'` record.                                                            |
| `M9402` | `theta-bounds-violation`              | `error`  | `$THETA` parameter `'THETA(n)'` violates bounds ($\text{lower} > \text{init}$ or $\text{init} > \text{upper}$).               |
| `M9403` | `missing-des-block-for-general-advan` | `error`  | Subroutine `'advan'` (`ADVAN6`/`ADVAN8`/`ADVAN9`/`ADVAN13`) requires a `'$DES'` differential equation block.                  |
| `M9404` | `undefined-theta-reference`           | `error`  | Block references `'THETA(n)'` beyond the number of declared `'$THETA'` parameters (`'maxTheta'`).                             |
| `M9405` | `undefined-eta-reference`             | `error`  | Block references `'ETA(n)'` beyond the dimension of declared `'$OMEGA'` variance entries (`'maxOmega'`).                      |
| `M9406` | `non-positive-omega-variance`         | `error`  | `$OMEGA` diagonal variance entry `'OMEGA(n)'` must be positive ($> 0$) unless `FIXED` to `0`.                                 |
| `M9407` | `compartment-index-out-of-bounds`     | `error`  | Compartment reference `'cmtIndex'` exceeds declared compartment count (`'maxCmt'`).                                           |
| `M9408` | `missing-error-prediction-y`          | `error`  | `$ERROR` block does not define the required dependent prediction variable `'Y'`.                                              |
| `M9409` | `missing-required-trans-parameter`    | `error`  | Subroutine `'advan'` with `'trans'` requires pharmacokinetic parameter `'paramName'` (e.g. `'CL'`, `'V'`, `'KA'`) in `'$PK'`. |
| `M9410` | `negative-dosing-amount`              | `error`  | Dosing record specifies a negative `'AMT'` or `'RATE'` value.                                                                 |

---

## Programmatic Usage

```typescript
import { lintNmtran, lowerNmtranToDae, nmtranToModelica, parseNmtran, solveNmtranPkPd } from "@modelscript/nmtran";

const ctlSource = `
$PROBLEM Two-Compartment Oral PK Model
$INPUT ID TIME AMT DV CMT EVID II ADDL
$DATA pk_study.csv IGNORE=@
$SUBROUTINES ADVAN4 TRANS4
$PK
  CL = THETA(1) * EXP(ETA(1))
  V2 = THETA(2) * EXP(ETA(2))
  Q  = THETA(3)
  V3 = THETA(4)
  KA = THETA(5)
  S2 = V2
$ERROR
  IPRED = F
  Y = IPRED * (1 + EPS(1))
$THETA
  (0, 5.0, 50.0)   ; CL (L/h)
  (0, 20.0, 200.0) ; V2 (L)
  (0, 2.0, 50.0)   ; Q (L/h)
  (0, 40.0, 500.0) ; V3 (L)
  (0, 1.2, 10.0)   ; KA (1/h)
$OMEGA
  0.04 ; IIV CL
  0.04 ; IIV V2
$SIGMA
  0.01 ; Proportional residual error
$ESTIMATION METHOD=1 INTERACTION MAXEVAL=9999
$DOSE TIME=0 AMT=100 CMT=1 RATE=0 II=12 ADDL=1
`;

// 1. Parse NMTRAN control stream and run M9401-M9410 pre-flight diagnostics
const doc = parseNmtran(ctlSource, "two_cmt_oral.ctl");
const diagnostics = lintNmtran(doc);

// 2. Simulate PK trajectory and compute NCA metrics (Cmax, Tmax, t1/2, AUC)
const simResult = solveNmtranPkPd(doc, { duration: 24.0, timeStep: 0.05 });
console.log(simResult.metrics.cMax, simResult.metrics.tMax, simResult.metrics.auc0ToT);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x
const dae = lowerNmtranToDae(doc);
const modelicaCode = nmtranToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                               |
| `npm test`          | Run NMTRAN parser, linter, PK/PD solver, DAE lowering, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                       |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                        |
| `npm run clean`     | Remove `dist/` build artifacts                                              |
