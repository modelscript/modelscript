<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/vscode

VS Code extension for Modelica language support. Provides syntax highlighting, semantic token coloring, keyword completions, and hover information via `@modelscript/lsp`.

## Features

- **Syntax highlighting** — TextMate grammar for `.mo` files
- **Semantic token coloring** — context-aware highlighting via the LSP server
- **Keyword completions** — all Modelica keywords
- **Hover info** — keyword descriptions
- **Language configuration** — comment toggling, bracket matching, code folding

## Scripts

| Command            | Description                                     |
| ------------------ | ----------------------------------------------- |
| `npm run build`    | Production webpack bundle (client + server)     |
| `npm run compile`  | Development webpack bundle                      |
| `npm run dev`      | Webpack watch mode                              |
| `npm run test-web` | Launch VS Code in browser with extension loaded |
| `npm run watch`    | Webpack watch mode                              |

## Development

### Testing in Browser

```bash
npm run test-web
```

This compiles the extension and opens a Chromium-based VS Code at http://localhost:3100 with the extension loaded. The `test-data/` folder contains sample `.mo` files.

### Architecture

The extension is a **VS Code web extension**:

- **Client** (`src/browserClientMain.ts`) — activates on `.mo` files, creates a `LanguageClient` that spawns the LSP server as a web worker
- **Server** — bundled from `@modelscript/lsp` into `server/dist/` by webpack
- **Grammar** — TextMate grammar at `syntaxes/modelica.tmLanguage.json`
