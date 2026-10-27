<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/fortran

First-class Fortran 77/90 (`.f`, `.for`, `.f77`, `.f90`) DSL and engineering simulation compiler package for ModelScript. Features a native WebAssembly GLR parser (`parser.wasm` via `@modelscript/dsl`), 10 static analysis lint rules (`M4070`–`M4079`), engineering preprocessor macro resolution (`#IF`/`#STORAGE`/`#LOCAL`/`$Param`/`$#DIM`), direct linear-memory DAE arena lowering (`IDaeBuilder`), and zero-allocation simulation step compilation for EMT and dynamic solvers (PSCAD EMTDC, EASY5 `UG`, NASA ROCETS).

---

## Core Capabilities

- **Native WebAssembly GLR Parser (`getFortranParser`, `parseFortran`, `parser.wasm`)**: Compiled AssemblyScript WebAssembly GLR parser handling Fortran subroutines, functions, modules, `COMMON` blocks, `DO` loops, structured `IF/THEN/ELSEIF/ELSE/ENDIF`, inline `IF`, and arithmetic/logical expressions.
- **Pre-Flight Static Linter (`lintFortran`, `lintFortranSource`, `FortranErrorCode`)**: 10 static verification rules (`M4070`–`M4079`) checking undeclared variables under `IMPLICIT NONE`, uninitialized variable reads, constant division by zero, `STORF`/`STORI` storage bounds overflows, unreachable code after `RETURN`, `DO`-loop index mutation, procedural algebraic loops, `COMMON` block mismatches, array dimension underflow, and obsolete arithmetic `IF` statements.
- **Engineering Preprocessor (`preprocessFortranSegment`, `preprocessFortran`, `evaluateCondition`)**:
  - Evaluates `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF` conditional directives
  - Extracts `#STORAGE REAL:m INTEGER:n` state allocations and `#LOCAL REAL`/`#LOCAL INTEGER` declarations
  - Substitutes `$#DIM(port)` and `$Param` tokens and auto-reserves EMTDC state storage for library blocks (`REALPOLE`, `DELAY1`, `INTGRL`, `LEADLAG`, `DIFF`).
- **Direct Linear-Memory DAE Arena Lowering (`lowerFortranToDae`)**: Lowers EASY5/ROCETS continuous state derivatives (`SD(i) = ...`) into `der(s_i)` variables and algebraic assignments into `EqKind.Simple` equations in `@modelscript/runtime`'s `IDaeBuilder`.
- **Zero-Allocation Step Compiler (`compileFortranStep`, `compileFortranSegment`, `buildStepFunction`)**: Compiles preprocessed Fortran subroutines into high-speed closures executing 100,000 steps in $< 30\text{ ms}$ with built-in EMTDC intrinsics (`REALPOLE`, `DELAY1`, `INTGRL`, `LEADLAG`, `DIFF`, `LIMITER`, `CMPLX_POLAR`, `SIN_COS`, `CURRENT_SOURCE`, `E_BRANCH`).

---

## Package Structure

| Path                           | Description                                                                                   |
| :----------------------------- | :-------------------------------------------------------------------------------------------- |
| `src/index.ts`                 | Public package exports and singleton WASM GLR parser initializer (`getFortranParser`)         |
| `src/language.ts`              | `fortranLanguage` grammar definition, operator precedences, and Fortran ◄► Modelica TGG rules |
| `src/ast.ts`                   | `FortranAstParser`, `parseFortranScript`, and `tokenizeFortran` procedural AST builder        |
| `src/preprocessor.ts`          | `preprocessFortranSegment` and `preprocessFortran` macro and `#STORAGE` preprocessor          |
| `src/lints/index.ts`           | `lintFortran`, `lintFortranSource`, and `FortranErrorCode` (`M4070`–`M4079`)                  |
| `src/dae/lowering.ts`          | `lowerFortranToDae` direct lowering of continuous state derivatives to `IDaeBuilder`          |
| `src/codegen/step-compiler.ts` | `compileFortranStep` and `compileFortranSegment` zero-allocation simulation step compiler     |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                        | Severity  | Description                                                                                     |
| :------ | :-------------------------- | :-------- | :---------------------------------------------------------------------------------------------- |
| `M4070` | `undeclared-variable`       | `error`   | Variable referenced without declaration under strict typing (`IMPLICIT NONE`).                  |
| `M4071` | `uninitialized-variable`    | `warning` | Variable may be used in an expression before being assigned a value.                            |
| `M4072` | `constant-division-by-zero` | `error`   | Division by constant zero detected in arithmetic expression.                                    |
| `M4073` | `storage-bounds-overflow`   | `error`   | Storage array index `STORF(i)` or `STORI(i)` exceeds allocated `#STORAGE` capacity.             |
| `M4074` | `dead-code-after-return`    | `warning` | Unreachable statements detected following an unconditional `RETURN`.                            |
| `M4075` | `do-loop-index-mutation`    | `error`   | Active `DO`-loop index variable is modified within its loop body.                               |
| `M4076` | `procedural-algebraic-loop` | `warning` | Algebraic cycle detected among procedural assignments without time-step lag.                    |
| `M4077` | `common-block-mismatch`     | `error`   | `COMMON /name/` block definition conflicts in element count or layout with a prior declaration. |
| `M4078` | `array-dimension-underflow` | `error`   | Array declared with non-positive dimension size ($\text{dim} \le 0$).                           |
| `M4079` | `obsolete-arithmetic-if`    | `info`    | Three-way arithmetic `IF (expr) l1, l2, l3` is obsolescent; prefer structured `IF/THEN/ELSE`.   |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a Fortran subroutine or PSCAD/EASY5 segment (M4070–M4079)
npx msx fortran lint governor.f90

# Lower Fortran derivative subroutine to the ModelScript DAE arena
npx msx fortran flatten turbine_ug.f
```

### Programmatic API

```typescript
import {
  compileFortranStep,
  lintFortran,
  lowerFortranToDae,
  parseFortran,
  preprocessFortranSegment,
} from "@modelscript/fortran";

// 1. Run static linter (M4070–M4079)
const diagnostics = lintFortran(`
      IMPLICIT NONE
      REAL X
      X = 10.0 / 0.0
`);

// 2. Compile zero-allocation EMTDC / control step closure
const compiled = compileFortranStep(`
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL Tau, y
      Tau = 0.01
      IF (FIRSTSTEP) STORF(1) = 0.0
      y = STORF(1) + DELT * ($In - STORF(1)) / Tau
      STORF(1) = y
      $Out = y
`);

// 3. Execute step in simulation loop
compiled.step({
  time: 0.0,
  dt: 0.001,
  firstStep: true,
  inputs: (port) => (port === "In" ? 10.0 : 0.0),
  setOutput: (port, val) => console.log(port, val),
  storf: new Float64Array(compiled.numRealStates + 1),
  stori: new Int32Array(compiled.numIntStates + 1),
});
```

---

## Scripts

| Command                | Description                                                                |
| :--------------------- | :------------------------------------------------------------------------- |
| `npm run build`        | Build WASM GLR parser (`node build.js`) and compile TypeScript (`tsc`)     |
| `npm run build:parser` | Force regeneration of the WebAssembly GLR parser (`node build.js --force`) |
| `npm run clean`        | Remove `dist/`, `src-gen/`, `as-gen/`, and `*.wasm` artifacts              |
| `npm run lint`         | Run ESLint across `src/`                                                   |
| `npm test`             | Run unit and integration test suite via `test-runner.js`                   |
| `npm run typecheck`    | Run TypeScript type checking without emitting (`tsc --noEmit`)             |
