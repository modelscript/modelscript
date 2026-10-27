<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/c

First-class ANSI C / C99 (`.c`, `.h`) language and engineering simulation compiler package for ModelScript. Features a native WebAssembly GLR parser (`parser.wasm` built via `@modelscript/dsl`), static safety diagnostics (`M8401`–`M8410`), C header (`.h`) introspection and automated Modelica `external "C"` binding generation, direct linear-memory DAE arena lowering (`IDaeBuilder`), and zero-allocation simulation step compilation for embedded control algorithms, Simulink C MEX S-functions, and PSCAD C segments.

---

## Core Capabilities

- **Native WebAssembly GLR Parser (`getCParser`, `parseC`, `parser.wasm`)**: Compiled AssemblyScript WebAssembly GLR parser handling C99 translation units, functions, `struct`/`union`/`enum` declarations, `typedef`s, pointers, arrays, statements, and expressions.
- **Modelica `external "C"` Bridge (`scrapeCHeader`, `bindCHeaderToModelica`, `generateModelicaFunction`, `generateModelicaRecord`)**: Scrapes C headers (`.h`) to extract function prototypes and struct layouts, automatically synthesizing strongly-typed Modelica `function` and `record` definitions with `external "C"` annotations.
- **Pre-Flight Static Safety Linter (`lintC`, `lintCSource`, `CErrorCode`)**: 10 static analysis rules (`M8401`–`M8410`) detecting uninitialized local variables, constant division/modulo by zero, static array out-of-bounds subscripts, unreachable dead code, accidental assignment in conditionals, algebraic dependency cycles, `NULL` pointer dereferences, prototype mismatches, missing return values, and implicit lossy float-to-int conversions.
- **Engineering Preprocessor (`preprocessCSegment`, `evaluateCondition`)**: Resolves `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`, `#define` macros, and simulation state/parameter bindings.
- **Direct Linear-Memory DAE Arena Lowering (`lowerCToDae`)**: Lowers continuous ODE state derivatives (`dx[i] = ...`, `der_x = ...`) and algebraic equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Zero-Allocation Step Compiler (`compileCStep`, `buildCStepFunction`)**: Compiles procedural C control blocks into zero-GC execution closures with full `<math.h>` intrinsics (`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `log`, `log10`, `sqrt`, `fabs`, `pow`, `fmin`, `fmax`, `floor`, `ceil`).

---

## Package Structure

| Path                            | Description                                                                               |
| :------------------------------ | :---------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Public package exports and singleton WASM GLR parser initializer (`getCParser`, `parseC`) |
| `src/language.ts`               | `cLanguage` DSL grammar definition, operator precedences, and C ◄► Modelica TGG rules     |
| `src/ast.ts`                    | `CAstParser`, `parseCScript`, and `tokenizeC` lightweight procedural AST builder          |
| `src/preprocessor.ts`           | `preprocessCSegment` C preprocessor for `#define` macros and conditional compilation      |
| `src/errors.ts`                 | `CErrorCode` diagnostic definitions (`8401`–`8410` / `M8401`–`M8410`)                     |
| `src/lints/rules.ts`            | `lintCSource` static analysis and safety verification rules                               |
| `src/lints/index.ts`            | Linter module exports (`lintC`, `lintCSource`)                                            |
| `src/dae/lowering.ts`           | `lowerCToDae` direct lowering of C state derivatives and assignments to `IDaeBuilder`     |
| `src/codegen/step-compiler.ts`  | `compileCStep` and `buildCStepFunction` zero-allocation simulation step compiler          |
| `src/bridge/header-scraper.ts`  | `scrapeCHeader` C header declaration and struct extractor                                 |
| `src/bridge/modelica-binder.ts` | `bindCHeaderToModelica` generator for Modelica `external "C"` functions and records       |
| `src/bridge/index.ts`           | C-to-Modelica bridge re-exports                                                           |
| `src/ide/index.ts`              | Monaco Monarch syntax highlighter, TextMate grammar, and language configuration           |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                          | Severity  | Description                                                                                           |
| :------ | :---------------------------- | :-------- | :---------------------------------------------------------------------------------------------------- |
| `M8401` | `uninitialized-variable`      | `warning` | Local variable may be read before being initialized.                                                  |
| `M8402` | `constant-division-by-zero`   | `error`   | Division or modulo by constant zero detected in arithmetic expression.                                |
| `M8403` | `array-bounds-overflow`       | `error`   | Static array subscript `arr[index]` exceeds declared dimension bound.                                 |
| `M8404` | `unreachable-code`            | `warning` | Unreachable statements detected following unconditional `return`, `break`, or `goto`.                 |
| `M8405` | `assignment-in-conditional`   | `warning` | Assignment operator `=` used inside conditional expression (`if (x = y)`); did you mean `==`?         |
| `M8406` | `algebraic-dependency-cycle`  | `error`   | Procedural algebraic dependency cycle detected without state lag.                                     |
| `M8407` | `null-pointer-dereference`    | `error`   | Dereference of statically known `NULL` pointer in expression.                                         |
| `M8408` | `function-prototype-mismatch` | `error`   | Function signature conflicts with prior prototype declaration.                                        |
| `M8409` | `missing-return-value`        | `error`   | Non-void function reaches end of body without returning a value.                                      |
| `M8410` | `implicit-lossy-conversion`   | `info`    | Implicit floating-point to integer conversion (`double`/`float` to `int`) may cause lossy truncation. |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a C source or header file for safety defects (M8401–M8410)
npx msx c lint controller.c

# Generate Modelica external "C" wrappers from a C header file
npx msx c bind controller.h

# Lower a C dynamic model into the ModelScript DAE arena
npx msx c flatten plant_sfunc.c
```

### Programmatic API

```typescript
import { bindCHeaderToModelica, compileCStep, lintCSource, lowerCToDae, parseC } from "@modelscript/c";

// 1. Parse C99 source via native WebAssembly GLR parser
const cstRoot = await parseC(`
  double pi_step(double err, double *integral, double dt) {
    *integral += err * dt;
    return 2.5 * err + 0.8 * (*integral);
  }
`);

// 2. Run static safety linter (M8401–M8410)
const diagnostics = lintCSource(`
  void step(void) {
    double x;
    double y = x + 1.0 / 0.0;
  }
`);

// 3. Auto-generate Modelica external "C" bindings from a C header
const modelicaPkg = bindCHeaderToModelica(
  `
  typedef struct { double kp; double ki; } PiGains;
  double compute_torque(double speed_ref, double speed_meas);
`,
  { packageName: "EmbeddedControl" },
);

// 4. Compile zero-allocation procedural step closure
const compiled = compileCStep(`
  dx[0] = -2.0 * x[0] + u[0];
  y[0] = x[0];
`);
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
