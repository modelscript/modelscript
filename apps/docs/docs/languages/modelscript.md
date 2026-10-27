# ModelScript (`.msx`, `.modelscript`)

`@modelscript/modelscript` (`languages/modelscript`) is the native **ModelScript** systems modeling and query language. It combines zero-cost linear-memory data layout control (`@unmanaged struct`), WebAssembly/C++ native compilation, and declarative XQuery-inspired **FLWOR** (`for`–`let`–`where`–`order by`–`return`) queries over polyglot engineering graphs.

---

## Supported Extensions & Dialects

| Extension      | Description                         |
| :------------- | :---------------------------------- |
| `.msx`         | Canonical ModelScript source module |
| `.modelscript` | Long-form ModelScript source module |

---

## Language Features & Grammar

The native WebAssembly GLR parser (`languages/modelscript/src/language.ts`) parses `.msx` modules into a compact Concrete Syntax Tree (CST) with five primary syntactic constructs:

### 1. Module Imports

Import declarations bind symbols from external ModelScript modules or polyglot engineering artifacts:

```ts
import { ThermalNode, Conductance as G } from "./thermal_kernel.msx";
```

### 2. Unmanaged Linear-Memory Structs (`@unmanaged struct`)

Structs annotated with `@unmanaged` are packed directly into 32-bit WebAssembly linear memory without garbage-collected wrapper allocation:

```ts
@unmanaged struct StateVector {
  id: u32;
  temperature: f64;
  pressure: f64;
  active: bool;
}
```

### 3. Type System

- **Primitive Types**: `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `bool`, `string`, `usize`, `void`
- **Generic & Pointer Types**: `Array<T>`, `Slice<T>`, `ptr<T>`
- **User-Defined Structs**: Any declared `struct` identifier

### 4. Functions, Statements & Control Flow

Functions declare strongly typed parameters and return types, supporting `let` and `const` variable bindings, `if`/`else` branches, `while` loops, C-style `for` loops, and member/index expressions:

```ts
const BOLTZMANN: f64 = 1.380649e-23;

function computeHeatFlux(k: f64, area: f64, dT: f64, dx: f64): f64 {
  if (dx <= 0.0) {
    return 0.0;
  }
  let flux: f64 = -k * area * (dT / dx);
  return flux;
}
```

### 5. Declarative FLWOR Queries

ModelScript embeds first-class **FLWOR** (`for`–`let`–`where`–`order by`–`return`) expressions directly in the expression grammar for querying collections, CST nodes, and simulation trajectories:

```ts
let criticalNodes =
  for node in nodes
  let margin := node.limit - node.temperature
  where margin < 15.0 && node.active == true
  order by margin asc
  return { id: node.id, margin: margin };
```

---

## Multi-Target Compiler (`ModelScriptCompiler`)

`ModelScriptCompiler` (`languages/modelscript/src/index.ts`) lowers the linear-memory CST across three code generation backends:

| Backend           | Emitter Class   | API Methods                                                                        | Target Output                                                                                   |
| :---------------- | :-------------- | :--------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| **JavaScript**    | `JsEmitter`     | `compileToJs(source)` / `executeJs(source, context)`                               | Executable ES module with lowered FLWOR pipelines (`.filter().sort().map()`)                    |
| **WebAssembly**   | `WasmEmitter`   | `compileToWat(source)` / `compileToWasm(source)` / `executeWasm(source, fn, args)` | Textual WAT S-expressions and binary `.wasm` modules with `@unmanaged` linear-memory offsets    |
| **Native Binary** | `NativeEmitter` | `compileToNative(source, { outPath, entryFn?, cc?, cflags? })`                     | WASM lowered to C via `wasm2c`, then compiled with the host C compiler (`$CC`, default `clang`) |

```ts
import fs from "node:fs";
import { ModelScriptCompiler } from "@modelscript/modelscript";

const compiler = new ModelScriptCompiler();
await compiler.init();

const source = fs.readFileSync("kernel.msx", "utf8");
const { js } = compiler.compileToJs(source); // ES module source
const wasm = await compiler.compileToWasm(source); // Uint8Array
const result = await compiler.executeWasm(source, "main", []);
const binary = await compiler.compileToNative(source, { outPath: "build/kernel" }); // requires wasm2c + clang
```

---

## Command Line Interface (`msx compile` & `msx lint`)

Compile, lint, and run ModelScript source modules directly from the terminal:

```bash
# Lint ModelScript modules for syntax, type errors, and unmanaged struct layout
msx lint kernel.msx

# Compile a ModelScript module into flattened DAE or WebAssembly bytecode
msx compile MainModule kernel.msx --flattener=wasm --timing
```

---

## Salsa Query Engine & Linear-Memory Struct Layout

`ModelScriptQueryEngine` (`languages/modelscript/src/queries.ts`) provides memoized semantic queries over the CST:

- **`structLayout(rawStructNode)`**: Computes deterministic 32-bit WebAssembly linear-memory byte layouts (`StructLayout`) for every `struct_declaration`:
  - `bool`: 1 byte (alignment 1)
  - `i32`, `u32`, `f32`, `usize`, `string`, `ptr<T>`, `Array<T>`, `Slice<T>`: 4 bytes (alignment 4)
  - `i64`, `u64`, `f64`: 8 bytes (alignment 8)
  - Automatically inserts natural alignment padding (`alignOffset`) between fields and aligns the total struct byte size to the maximum field alignment (`maxAlign`).
- **`inferExpressionType(rawNode, scope)`**: Infers static types across literals, binary/unary expressions, struct field access, function calls, and FLWOR `return` clauses (`Array<ReturnType>`).

---

## Semantic Linter & Error Codes

`ModelScriptLinter` (`languages/modelscript/src/linter.ts` and `languages/modelscript/src/errors.ts`) enforces 10 static analysis rules across syntax, name resolution, type checking, FLWOR clauses, and struct/function calls:

<LintRules lang="modelscript" />

---

## Polyglot TGG Rules

`@modelscript/modelscript` registers two Triple Graph Grammar (TGG) synchronization rules in `languages/modelscript/src/language.ts` for bidirectional projection with Modelica:

| Rule Name                           | Source Pattern        | Target Pattern (`modelica`)     | Semantics                                                                                              |
| :---------------------------------- | :-------------------- | :------------------------------ | :----------------------------------------------------------------------------------------------------- |
| `ModelScriptStructToModelicaRecord` | `StructDeclaration`   | `ClassDefinition` (`record`)    | Synchronizes a `@unmanaged struct` declaration with a Modelica `record` definition                     |
| `ModelScriptParamToModelicaMod`     | `VariableDeclaration` | `ComponentClause` (`parameter`) | Synchronizes a top-level constant or variable binding with a Modelica component parameter modification |
