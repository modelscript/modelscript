# WebAssembly GLR Incremental Parser

ModelScript avoids external runtime parser dependencies. Instead, every supported language in `languages/` is parsed using a custom, ahead-of-time (AOT) compiled **Generalized LR (GLR)** parser executing directly in WebAssembly (`parser.wasm`).

The parser compiler is implemented in `@modelscript/dsl` under `packages/dsl/src/codegen/`.

---

## Why GLR in WebAssembly?

1. **Handling Complex Engineering Grammars**: Engineering modeling languages like Modelica and SysML v2 possess ambiguities that cannot be parsed by strict deterministic LR(1) or LALR parsers. The GLR algorithm handles non-deterministic grammar paths by branching parse stacks and pruning invalid branches dynamically.
2. **Zero-Allocation Memory Footprint**: Rather than allocating JavaScript AST object wrappers for every identifier and operator, tokens and CST nodes are laid out in a flat WebAssembly linear memory arena.
3. **Web-Native Performance**: The compiled `parser.wasm` executes at near-native speeds in both Node.js server environments and client-side browser contexts (such as the IDE and Morsel).

---

## Parser Initialization

In TypeScript or AssemblyScript code, parsers are loaded and registered via `createWasmParser`:

```typescript
import { createWasmParser } from "@modelscript/modelica/parser";
import { Context } from "./src/context.js";

// Load the compiled WebAssembly parser binary
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
const { parser } = await createWasmParser(modelicaWasmPath);

// Register file extension mapping in the compilation Context
Context.registerParser(".mo", parser);
```

---

## Linear CST Memory Layout

When a source file is parsed, the parser allocates a continuous buffer of node headers in linear memory. Each CST node is referenced by a 32-bit integer pointer (`u32` node offset) rather than an object reference:

```
┌────────────────────────────────────────────────────────┐
│                   Linear CST Node Arena                │
├───────────┬───────────┬──────────────┬─────────────────┤
│ Field     │ Offset    │ Type         │ Description     │
├───────────┼───────────┼──────────────┼─────────────────┤
│ typeId    │ 0         │ uint16       │ Node type code  │
│ flags     │ 2         │ uint16       │ Semantic flags  │
│ startByte │ 4         │ uint32       │ Start byte pos  │
│ endByte   │ 8         │ uint32       │ End byte pos    │
│ firstChild│ 12        │ uint32       │ Offset to child │
│ nextSibling│ 16       │ uint32       │ Offset to sib   │
└───────────┴───────────┴──────────────┴─────────────────┘
```

### Direct Field Accessors (`Cst`)

High-performance accessors read typed node properties directly from the linear buffer:

```typescript
import { Cst } from "@modelscript/modelica/language";

// Accessing child fields without constructing intermediate wrappers
const comp = Cst.ComponentClause.componentDeclarationList(node);
for (const decl of comp) {
  const nameNode = Cst.ComponentDeclaration.declaration(decl);
  const identifier = db.ast.text(nameNode);
}
```

---

## Incremental Re-Parsing

When editing code in the Language Server Protocol (LSP) or Web IDE, the GLR parser performs incremental tree re-use:

- Text edits pass line and character delta offsets.
- Unaffected subtrees in linear memory remain unchanged and are spliced into the new parse tree.
- Syntax diagnostics are generated instantly during parsing and stored in the diagnostics arena.
