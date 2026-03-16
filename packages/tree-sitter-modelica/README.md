<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/tree-sitter-modelica

Tree-sitter grammar for the Modelica language. Produces both a native Node.js binding and a WebAssembly build for browser use.

## Prerequisites

- **tree-sitter-cli** (`npm install -g tree-sitter-cli`)
- **emsdk** (for WASM build)
- **node-gyp** build tools

## Scripts

| Command         | Description                                    |
| --------------- | ---------------------------------------------- |
| `npm run build` | Generate, build native binding, and build WASM |
| `npm run clean` | Remove `build/` and `src/` output              |
| `npm test`      | Run grammar binding tests                      |
| `npm start`     | Launch tree-sitter playground                  |

## Building

```bash
npm run build
```

This generates the parser from `grammar.js`, builds the native Node.js binding, and produces `tree-sitter-modelica.wasm`.

## Testing

```bash
npm test
```

## Playground

```bash
npm start
```

Opens the tree-sitter web playground for interactively testing the grammar.
