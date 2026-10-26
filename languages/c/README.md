# @modelscript/c

First-class C99 / ANSI C language and engineering simulation compiler package for ModelScript.

Provides high-performance procedural C parsing (WASM GLR parser via `@modelscript/dsl`), static safety diagnostics (`M8401`–`M8410`), C header (`.h`) introspection and automated Modelica `external "C"` binding, direct linear-memory DAE arena lowering (`IDaeBuilder`), and zero-allocation simulation step compilation for embedded control algorithms, Simulink C MEX S-functions, and PSCAD C segments.

## Architecture & Features

1. **WASM GLR Parser (`parser.wasm`)**:
   - Compiled AssemblyScript WebAssembly parser with zero grammar conflicts.
   - Parses C99 translation units, functions, struct/union declarations, typedefs, statements, and expressions.
2. **Modelica External "C" Bridge (`header-scraper.ts` / `modelica-binder.ts`)**:
   - Scrapes C headers (`.h`) to extract function declarations and struct layouts.
   - Auto-generates strongly-typed Modelica functions with `external "C"` annotations.
3. **Static Analysis & Linters (`lintC`)**:
   - `M8401`: Local variable read before initialization.
   - `M8402`: Constant division or modulo by zero.
   - `M8403`: Static array index out of allocated bounds.
   - `M8404`: Unreachable dead code after unconditional `return`/`break`/`goto`.
   - `M8405`: Accidental assignment in conditional expression (`=` instead of `==`).
   - `M8406`: Procedural algebraic dependency cycles without state lag.
   - `M8407`: Null pointer dereference in constant expression.
   - `M8408`: Function prototype signature mismatch.
   - `M8409`: Missing return value in non-void function.
   - `M8410`: Implicit floating-point to integer lossy truncation.
4. **Direct DAE Arena Lowering (`lowerCToDae`)**:
   - Lowers continuous ODE derivatives (`dx[i] = ...` / `der_x = ...`) into `@modelscript/runtime`'s `IDaeBuilder`.
   - Lowers explicit algebraic assignments into arena equations (`EqKind.Simple`).
5. **Zero-Allocation Step Compiler (`compileCStep`)**:
   - Compiles preprocessed procedural C scripts into low-overhead execution closures executing 100,000 steps in < 30ms without garbage collection overhead.
   - Built-in `<math.h>` mathematical functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `log`, `log10`, `sqrt`, `fabs`, `pow`, `fmin`, `fmax`, `floor`, `ceil`.

## Testing

```bash
npm run build --workspace=@modelscript/c
npm test --workspace=@modelscript/c
```
