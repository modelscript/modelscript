<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# Modelica Grammar for Tree-sitter

This package (`@modelscript/tree-sitter-modelica`) provides a high-performance **Tree-sitter** grammar for the Modelica language. It is used by the ModelScript compiler for efficient, incremental parsing.

## Features

- **High Performance**: Designed for incremental parsing and low-latency syntax highlighting.
- **Robust Modelica Support**: Covers the core Modelica language syntax, including class definitions, equations, algorithms, and annotations.
- **WASM Support**: Compiled to WASM for use in web-based environments (like the Morsel editor).

## Development

The grammar is defined in `grammar.js`.

### Prerequisites

- [Tree-sitter CLI](https://tree-sitter.github.io/tree-sitter/creating-parsers#installation)

### Building the Grammar

Generate the C and WASM parser:

```bash
npm run build
```

### Running Tests

Execute the tree-sitter test suite:

```bash
npm test
```

### Playground

Launch the tree-sitter playground to interactively test the grammar:

```bash
npm start
```

## Usage in Node.js

```javascript
const Parser = require("tree-sitter");
const Modelica = require("@modelscript/tree-sitter-modelica");

const parser = new Parser();
parser.setLanguage(Modelica);

const sourceCode = "model M end M;";
const tree = parser.parse(sourceCode);
console.log(tree.rootNode.toString());
```

## License

ModelScript is licensed under the **AGPL-3.0-or-later**.
