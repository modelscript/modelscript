<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/lsp

Modelica Language Server Protocol implementation. Runs as a web worker in the browser, providing rich editor features for `.mo` files.

## Features

- **Semantic Token Highlighting** — keywords, types, variables, strings, numbers, operators, comments
- **Dot-Path Completions** — sub-packages, classes, and components from the Modelica Standard Library
- **Keyword Completions** — all Modelica language keywords
- **Hover Information** — type, description, and classification for Modelica identifiers
- **Error Diagnostics** — parse errors via Tree-sitter and semantic errors via ModelicaLinter
- **Document Formatting** — proper indentation for class definitions, equations, algorithms, and control structures
- **Color Provider** — inline RGB color swatches for Modelica annotation color fields (`color`, `lineColor`, `fillColor`, `textColor`)
- **Diagram Edits** — computes text edits for component placement annotations during diagram interactions

## Scripts

| Command           | Description                |
| ----------------- | -------------------------- |
| `npm run build`   | Production webpack bundle  |
| `npm run compile` | Development webpack bundle |
| `npm run watch`   | Webpack watch mode         |

## Architecture

The server runs in a browser web worker via `vscode-languageserver/browser`. It communicates with the client extension (`@modelscript/vscode`) using `BrowserMessageReader`/`BrowserMessageWriter`.

The semantic token provider uses a Tree-sitter-based tokenizer matching the token legend — 10 token types (`keyword`, `type`, `class`, `variable`, `parameter`, `function`, `string`, `number`, `operator`, `comment`) and 2 modifiers (`declaration`, `readonly`).
