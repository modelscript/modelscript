<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/lsp

Modelica Language Server Protocol implementation. Runs as a web worker in the browser, providing:

- **Semantic token highlighting** — keywords, types, variables, strings, numbers, operators, comments
- **Keyword completions** — all Modelica keywords with trigger on `.`
- **Hover information** — descriptions for Modelica keywords
- **Basic diagnostics** — unclosed block comment detection

## Scripts

| Command           | Description                |
| ----------------- | -------------------------- |
| `npm run build`   | Production webpack bundle  |
| `npm run compile` | Development webpack bundle |
| `npm run watch`   | Webpack watch mode         |

## Architecture

The server runs in a browser web worker via `vscode-languageserver/browser`. It communicates with the client extension (`@modelscript/vscode`) using `BrowserMessageReader`/`BrowserMessageWriter`.

The semantic token provider uses a regex-based tokenizer matching the token legend from the Morsel editor — 10 token types (`keyword`, `type`, `class`, `variable`, `parameter`, `function`, `string`, `number`, `operator`, `comment`) and 2 modifiers (`declaration`, `readonly`).
