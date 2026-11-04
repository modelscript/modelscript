<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gproms

gPROMS Process Modeling Language (`.gproms`, `.pml`) equation-oriented chemical process engineering, dynamic CSTR, and spatially distributed tubular reactor PDE-DAE modeling package for ModelScript. Features a zero-regex character-by-character `.gproms` / `.pml` lexer and parser (`parseGproms`), roundtrip serializer (`serializeGproms`), multi-file workspace indexing (`GpromsWorkspaceIndex`), a deterministic RK4 Method-of-Lines (MOL) PDE-DAE process solver (`solveGpromsProcess`), direct linear-memory `DAEBuilder` finite-difference lowering (`lowerGpromsToDae`), 10 pre-flight structural and mathematical lint rules (`M9451`–`M9460`), Modelica 3.x projections (`gpromsToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex gPROMS `.gproms` / `.pml` Parser & Serializer (`parseGproms`, `serializeGproms`)**: Character-by-character scanner and recursive-descent parser supporting:
  - **`DECLARE TYPE`**: Physical variable domain definitions with default values, lower/upper bounds, and engineering units (`Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"`).
  - **`MODEL` Blocks**: `PARAMETER`, `DISTRIBUTION_DOMAIN` (`Axial AS [ 0.0 : 1.0 ] N = 10`), `VARIABLE` (lumped and `DISTRIBUTION(Axial) OF ...`), `BOUNDARY`, and `EQUATION` sections with `$x` time derivatives and 1st/2nd-order `PARTIAL(C, Axial)` spatial derivatives.
  - **`PROCESS` Blocks**: `UNIT`, `SET`, `ASSIGN`, `INITIAL`, and `SOLUTIONPARAMETERS` sections.
- **Lumped DAE & Method-of-Lines (MOL) Tubular PDE-DAE Solver (`solveGpromsProcess`)**: Discretizes `DISTRIBUTION_DOMAIN` partial differential equations using upwind Backward Finite Differences (BFDM) for 1st-order convection $\frac{\partial u}{\partial z}$ and Central Finite Differences (CFDM) with Danckwerts zero-gradient outlet boundary conditions for 2nd-order axial dispersion $\frac{\partial^2 u}{\partial z^2}$, integrating via 4th-order Runge-Kutta (RK4).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerGpromsToDae`)**: Discretizes `PARTIAL` spatial derivatives via finite differences and lowers parameters, lumped states, distributed grid states, and `ASSIGN`ed inputs directly into a structurally square ModelScript WebAssembly `DAEBuilder` arena.
- **10 Pre-Flight Process Modeling Lint Rules (`M9451`–`M9460`, `lintGproms`)**: Static verification of `DECLARE TYPE` references, variable bounds, spatial distribution domain bounds and grid points, undeclared equation identifiers, structural degrees-of-freedom (DOF) balance, uninitialized differential states (`$x`), `PARTIAL` on non-distributed variables, overassigned parameters/variables, empty models, and duplicate entity declarations.
- **Modelica 3.x Process Projection (`gpromsToModelica`)**: Translates lumped and Method-of-Lines discretized gPROMS models into standalone Modelica 3.x code.
- **Multi-File Workspace Indexing & LSP (`GpromsWorkspaceIndex`, `validateGproms`, `getGpromsHover`, `provideGpromsCompletions`)**: Implements `IWorkspaceIndex` across `.gproms` and `.pml` files with symbol navigation, hover cards, completions, and AST writeback.

---

## Package Structure

| Path                                    | Description                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                |
| `src/language.ts`                       | `gpromsLanguage` definition and LSP actions (`lint_gproms`, `gproms_simulate`, `gproms_to_dae`, `gproms_to_modelica`) |
| `src/types.ts`                          | `GpromsDocument`, `GpromsModel`, `GpromsProcess`, `GpromsVariableType`, `GpromsDistributionDomain`, and range types   |
| `src/errors.ts`                         | `GpromsErrorCode` diagnostic registry (`M9451`–`M9460`)                                                               |
| `src/parser/gproms-parser.ts`           | `parseGproms` and `serializeGproms` zero-regex character-by-character parser and serializer                           |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                                 |
| `src/lints/gproms-linter.ts`            | `lintGproms` structural DOF, domain, and differential initialization diagnostic engine                                |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                                 |
| `src/solvers/gproms-solver.ts`          | `solveGpromsProcess` RK4 lumped DAE and Method-of-Lines 1D tubular reactor PDE-DAE solver                             |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                                 |
| `src/dae/gproms-to-dae.ts`              | `lowerGpromsToDae` finite-difference PDE discretization and direct lowering into `DAEBuilder` linear memory           |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                           |
| `src/projections/gproms-to-modelica.ts` | `gpromsToModelica` translator to Modelica 3.x lumped and discretized PDE models                                       |
| `src/projections/index.ts`              | Projections barrel exports                                                                                            |
| `src/workspace-index.ts`                | `GpromsWorkspaceIndex` implementing `IWorkspaceIndex` across `.gproms` and `.pml` files                               |
| `src/lsp.ts`                            | LSP validation, hover, completion, and document symbol providers                                                      |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                  | Severity  | Description                                                                                                           |
| ------- | ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `M9451` | `undeclared-variable-type`            | `error`   | `VARIABLE` references an undeclared `DECLARE TYPE`.                                                                   |
| `M9452` | `invalid-variable-bounds`             | `error`   | `DECLARE TYPE` specifies `lower >= upper` or `default` outside `[lower, upper]`.                                      |
| `M9453` | `invalid-distribution-domain`         | `error`   | `DISTRIBUTION_DOMAIN` specifies `lower >= upper` or fewer than $2$ grid points.                                       |
| `M9454` | `undeclared-equation-identifier`      | `error`   | `EQUATION` or `BOUNDARY` references an undeclared variable, parameter, or domain identifier.                          |
| `M9455` | `structural-dof-mismatch`             | `warning` | Number of equations + `ASSIGN`ed variables does not equal the number of unknown variables in `MODEL`.                 |
| `M9456` | `uninitialized-differential-state`    | `warning` | Variable differentiated via `$x` lacks an `INITIAL` condition in `PROCESS`.                                           |
| `M9457` | `partial-on-non-distributed-variable` | `error`   | `PARTIAL(u, z)` is applied to a variable `u` not distributed over `DISTRIBUTION_DOMAIN` `z`.                          |
| `M9458` | `overassigned-parameter-or-variable`  | `error`   | Parameter or variable is assigned multiple times or placed in the wrong `SET` / `ASSIGN` section in `PROCESS`.        |
| `M9459` | `empty-gproms-model`                  | `error`   | `MODEL` is empty and defines no variables or equations.                                                               |
| `M9460` | `duplicate-entity-declaration`        | `error`   | Duplicate `TYPE`, `MODEL`, `PARAMETER`, `DISTRIBUTION_DOMAIN`, `VARIABLE`, `PROCESS`, or `UNIT` declaration in scope. |

---

## Programmatic Usage

```typescript
import { gpromsToModelica, lintGproms, lowerGpromsToDae, parseGproms, solveGpromsProcess } from "@modelscript/gproms";

const pfrSource = `
DECLARE
  TYPE
    Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"
  END
END

MODEL TubularPFR
  PARAMETER
    v    AS REAL DEFAULT 0.5
    D_ax AS REAL DEFAULT 0.02
    k    AS REAL DEFAULT 0.4
    C_in AS REAL DEFAULT 10.0
  DISTRIBUTION_DOMAIN
    Axial AS [ 0.0 : 1.0 ] N = 11
  VARIABLE
    C AS DISTRIBUTION(Axial) OF Concentration
  BOUNDARY
    C(0.0) = C_in ;
  EQUATION
    $C = -v * PARTIAL(C, Axial) + D_ax * PARTIAL(PARTIAL(C, Axial), Axial) - k * C ;
END

PROCESS RunPFR
  UNIT
    R101 AS TubularPFR
  SET
    R101.k := 0.4 ;
  INITIAL
    R101.C := 0.0 ;
  SOLUTIONPARAMETERS
    TotalTime := 5.0 ;
    TimeStep := 0.005 ;
END
`;

// 1. Parse and validate (M9451-M9460)
const doc = parseGproms(pfrSource, "tubular_pfr.gproms");
const diagnostics = lintGproms(doc);

// 2. Solve Method-of-Lines PDE-DAE via RK4
const sim = solveGpromsProcess(doc);
console.log("Axial concentration profile:", sim.finalSpatialProfiles.C);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x
const dae = lowerGpromsToDae(doc);
const modelicaCode = gpromsToModelica(doc);
```
