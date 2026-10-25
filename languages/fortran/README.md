# @modelscript/fortran

First-class Fortran DSL and engineering simulation compiler package for ModelScript.

Provides high-performance procedural Fortran parsing (WASM GLR parser via `@modelscript/dsl`), static analysis diagnostics (10 linter rules M4070–M4079), preprocessor macro resolution (`#IF`/`#STORAGE`/`#LOCAL`/`$Param`/`$#DIM`), direct linear-memory DAE arena lowering (`IDaeBuilder`), and zero-allocation simulation step compilation for EMT solvers (PSCAD, EASY5, ROCETS).

## Architecture & Features

1. **WASM GLR Parser (`parser.wasm`)**:
   - Compiled AssemblyScript WebAssembly parser with zero grammar conflicts.
   - Parses Fortran subroutines, functions, modules, DO loops, block IF/THEN/ELSE, declarations, and arithmetic expressions.
2. **Static Analysis & Linters (`lintFortran`)**:
   - `M4070`: Undeclared variable under `IMPLICIT NONE`.
   - `M4071`: Uninitialized variable read before assignment.
   - `M4072`: Constant division by zero.
   - `M4073`: State array index out of allocated bounds (`STORF`/`STORI`).
   - `M4074`: Unreachable dead code after unconditional `RETURN`.
   - `M4075`: Active `DO` loop index variable mutation.
   - `M4076`: Procedural algebraic dependency cycles without state lag.
   - `M4077`: `COMMON` block definition size/type mismatch.
   - `M4078`: Array dimension subscript underflow or non-positive dimension size.
   - `M4079`: Obsolete three-way arithmetic `IF`.
3. **Engineering Preprocessor (`preprocessFortranSegment`)**:
   - Evaluates `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF` conditional blocks against parameters.
   - Extracts `#STORAGE REAL:m INTEGER:n` state allocations.
   - Tracks `#LOCAL REAL` and `#LOCAL INTEGER` variable declarations.
   - Substitutes `$#DIM(port)` and `$Param` references.
   - Auto-reserves EMTDC state storage for library subroutines (`REALPOLE`, `DELAY1`, `INTGRL`, `LEADLAG`, `DIFF`).
4. **Direct DAE Arena Lowering (`lowerFortranToDae`)**:
   - Lowers EASY5 state derivatives (`SD(i) = ...`) into continuous state derivatives `der(s_i)` in `@modelscript/runtime`'s `IDaeBuilder`.
   - Lowers algebraic assignments directly into arena equations (`EqKind.Simple`).
5. **Zero-Allocation Step Compiler (`compileFortranStep` / `compileFortranSegment`)**:
   - Compiles preprocessed procedural scripts into low-overhead execution closures executing 100,000 steps in < 30ms.
   - Built-in EMTDC library subroutines: `REALPOLE`, `DELAY1`, `INTGRL`, `LEADLAG`, `DIFF`, `LIMITER`, `CMPLX_POLAR`, `SIN_COS`, `CURRENT_SOURCE`, `E_BRANCH`.

## Usage

```typescript
import {
  compileFortranStep,
  lintFortran,
  lowerFortranToDae,
  preprocessFortranSegment,
  getFortranParser,
} from "@modelscript/fortran";

// 1. Static Linter
const diagnostics = lintFortran(`
IMPLICIT NONE
REAL x
x = 10.0 / 0.0
`);

// 2. Preprocessor & Step Compiler
const compiled = compileFortranStep(`
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL Tau, y
Tau = 0.01
IF (FIRSTSTEP) STORF(0) = 0.0
y = STORF(0) + DELT * ($In - STORF(0)) / Tau
STORF(0) = y
$Out = y
`);

// 3. Step execution in simulation loop
compiled.step({
  time: 0.0,
  dt: 0.001,
  firstStep: true,
  inputs: (port) => 10.0,
  setOutput: (port, val) => console.log(port, val),
  storf: new Float64Array(compiled.numRealStates),
  stori: new Int32Array(compiled.numIntStates),
});
```

## Testing

```bash
npm run build --workspace=@modelscript/fortran
npm test --workspace=@modelscript/fortran
```
