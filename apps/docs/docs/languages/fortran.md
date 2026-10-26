# Fortran Legacy Engineering Integration (`.f`, `.f90`)

`@modelscript/fortran` (`languages/fortran`) provides native GLR parsing, AST analysis, Triple Graph Grammar (TGG) synchronization, and DAE wrapping for legacy **Fortran 77** and **Fortran 90** computational engines.

---

## Supported Extensions & Standards

| Extension            | Standard / Format               | Description                                                            |
| :------------------- | :------------------------------ | :--------------------------------------------------------------------- |
| `.f`, `.for`, `.f77` | **Fortran 77** (Fixed Form)     | Column-based legacy engineering subroutines and mathematical libraries |
| `.f90`, `.f95`       | **Fortran 90 / 95** (Free Form) | Free-form modular subroutines, derived types, and array syntax         |

---

## Key Capabilities

### 1. WebAssembly GLR Fortran Parser

- Built on `@modelscript/dsl`'s ahead-of-time compiled WASM GLR parser table.
- Accurately parses both fixed-form (columns 1-5 label, 6 continuation, 7-72 statements) and modern free-form source files.
- Supports subroutines, functions, `COMMON` blocks, `EQUIVALENCE`, `PARAMETER`, `DATA` statements, multidimensional array indexing, and intrinsic mathematical functions (`SIN`, `COS`, `SQRT`, `EXP`, etc.).

### 2. Bidirectional Triple Graph Grammar (TGG) Rules

- Features formal bidirectional graph rewriting rules (`languages/fortran/src/language.ts`):
  - **`FortranSubroutineToModelicaFunction`**: Maps Fortran `SUBROUTINE` and `FUNCTION` definitions to strongly typed Modelica functions.
  - **`FortranAssignToModelicaEquation`**: Transforms Fortran numerical assignment statements into declarative Modelica equality equations.

### 3. Direct DAE Subroutine Lowering

- Compiles Fortran continuous state derivative subroutines directly into `@modelscript/runtime`'s `DAEBuilder` SoA linear memory arena.
- Enables legacy aero-propulsion, ballistics, and nuclear thermal routines to execute within modern hybrid continuous-discrete simulation solvers without manual recoding.

---

## Static Analysis & Modernization Linter Rules

The Fortran analyzer surfaces modernization issues and common numeric defects:

| Rule Identifier           | Severity  | Condition Checked                                                                                 |
| :------------------------ | :-------- | :------------------------------------------------------------------------------------------------ |
| `implicit-none-missing`   | `warning` | Program unit lacks `IMPLICIT NONE`, risking unintended variable type coercion (I-N integer rule). |
| `subroutine-arg-mismatch` | `error`   | Subroutine or function call provides an argument count or type incompatible with the declaration. |
| `array-bounds-exceeded`   | `error`   | Literal or constant array index subscript exceeds declared dimension bounds.                      |
| `obsolete-control-flow`   | `warning` | Computed `GOTO` or arithmetic `IF` statement detected; recommends structured modernization.       |

---

## CLI Usage

```bash
# Lint legacy Fortran engineering subroutines
msx fortran lint TurbomachineryModel.f

# Lower Fortran state equations to ModelScript linear DAE arena
msx fortran to-dae PropulsionAero.f90 --out=propulsion.dae.json

# Project Fortran computational subroutines into Modelica function blocks
msx fortran to-modelica LegacyThermodynamics.f -o Thermodynamics.mo
```
