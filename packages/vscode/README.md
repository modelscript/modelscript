<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript — Modelica for VS Code

Rich Modelica language support for Visual Studio Code, powered by [ModelScript](https://modelscript.org).

## Features

### Syntax Highlighting

Full TextMate grammar and semantic token coloring for `.mo` files — keywords, types, variables, strings, comments, and operators are all distinctly colored.

### Intelligent Completions

- **Dot-path completions** — type `Modelica.` and get sub-packages, classes, and components from the Modelica Standard Library
- **Keyword completions** — all Modelica language keywords

### Hover Information

Hover over any Modelica identifier to see its type, description, and classification (model, connector, component, enumeration literal, etc.).

### Error Diagnostics

Real-time error detection with:

- **Parse errors** — caught via tree-sitter incremental parsing
- **Semantic errors** — type mismatches, invalid modifications, and more via ModelicaLinter

### Document Formatting

Format Modelica files with proper indentation for class definitions, equations, algorithms, and control structures.

### Modelica Standard Library

The extension bundles MSL 4.1.0, providing full type resolution, completions, and hover information for all standard library types out of the box — no configuration needed.

## Requirements

- VS Code 1.100.0 or later
- Works in both desktop VS Code and [vscode.dev](https://vscode.dev)

## Extension Settings

| Setting                    | Description                                                                                 | Default   |
| -------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `modelscript.trace.server` | Traces communication between VS Code and the language server (`off`, `messages`, `verbose`) | `verbose` |

## Known Issues

- The extension currently runs as a **web extension** — Node.js-based desktop features (e.g., workspace-wide file system access) are not yet supported.

## Links

- [ModelScript](https://modelscript.org) — project homepage
- [GitHub](https://github.com/modelscript/modelscript) — source code and issue tracker
- [Morsel](https://modelscript-morsel.github.io) — online Modelica editor
