# `scripts/playground` — Single-Language Vite Playground SPA

This directory is the browser Single-Page Application (SPA) root served by [`scripts/tools/language-playground.ts`](../tools/language-playground.ts) (`npm run playground -- <lang>`). It lets language authors develop and test a single language's grammar, WASM CST, `@modelscript/lsp/core` providers, stencils, toolbar buttons, and React UI panels in isolation without building or loading all 104+ languages in `apps/web`.

It is also used as the Vite root by [`scripts/lint/verify-language-ui-panels.ts`](../lint/verify-language-ui-panels.ts) to compile-check language UI panels headlessly.

## Architecture Overview

```mermaid
flowchart LR
    CLI["scripts/tools/language-playground.ts\n(Vite dev server + HTTP middleware)"]
    CLI -->|virtual:modelscript-playground-lang| APP["playground-app.tsx"]
    CLI -->|"/__playground/lsp\n/__playground/parser.wasm\n/__playground/rebuild-parser"| APP

    HTML["index.html"] --> MAIN["main.tsx"] --> APP
    APP -->|default: ?shell=morsel| MORSEL["@modelscript/editor\n(Morsel workbench)"]
    APP -->|?shell=studio| MONACO["monaco-playground-editor.tsx\n(Monaco + 6 LSP providers)"]
    APP --> PANELS["languages/<lang>/src/ui/*\n(ui.panels + simulationCards)"]
```

## File Reference

| File                                                             | Role                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`index.html`](./index.html)                                     | Minimal HTML5 shell mounting `/main.tsx` onto `#root`.                                                                                                                                                                                                                                                                                                      |
| [`tsconfig.json`](./tsconfig.json)                               | Browser/Vite TypeScript configuration (`DOM` libs, `jsx: "react-jsx"`, source path aliases for `@modelscript/editor`, `@modelscript/design-tokens`, `@modelscript/react`). Excluded from root `tsconfig.json` to keep DOM types isolated from Node scripts.                                                                                                 |
| [`env.d.ts`](./env.d.ts)                                         | Ambient declarations for `*.css` imports and the Vite virtual module `virtual:modelscript-playground-lang` (`PLAYGROUND_LANG`, panels, simulation cards, stencils, samples, tree views, toolbar buttons).                                                                                                                                                   |
| [`main.tsx`](./main.tsx)                                         | React 19 entry point loading `@modelscript/design-tokens` CSS, `apps/web/src/index.css`, and `playground-styles.css`, then rendering `<PlaygroundApp />`.                                                                                                                                                                                                   |
| [`playground-app.tsx`](./playground-app.tsx)                     | Main React workbench hosting the active language in either **Morsel mode** (default, full `@modelscript/editor` workbench with Primer theme and HTTP LSP transport) or **Dev Studio mode** (`?shell=studio`, split editor + live WASM CST inspector + diagnostics + `LanguagePanelHost` event log + `Rebuild WASM` button + mock simulation result editor). |
| [`monaco-playground-editor.tsx`](./monaco-playground-editor.tsx) | Monaco Editor wrapper used in Dev Studio mode. Dynamically builds a Monarch syntax highlighter (including XML and INI/section dialects) and wires 6 LSP providers (`SemanticTokens`, `Hover`, `Completion`, `DocumentSymbol`, `FoldingRange`, `InlayHints`) over `/__playground/lsp`.                                                                       |
| [`playground-styles.css`](./playground-styles.css)               | Layout and theme tokens (`[data-theme="dark"                                                                                                                                                                                                                                                                                                                | "light"]`and`[data-tokens="vscode"]`) for Dev Studio mode. |

## Usage & Query Parameters

Start the playground via `scripts/tools/language-playground.ts`:

```bash
# From repo root
npm run playground -- modelica

# Or from inside any languages/<slug>/ directory
npm run playground
```

Supported URL query parameters in `playground-app.tsx`:

- `?shell=morsel|studio` — Switch between the full Morsel workbench (`morsel`, default) and the lightweight Dev Studio (`studio`).
- `?mode=workbench|inspector|artifact` — Host surface mode in Dev Studio.
- `?theme=dark|light` — Color theme.
- `?tokens=web|vscode` — Switch between Web CSS tokens and VS Code CSS tokens in Dev Studio.
- `?panel=<id>` — Pre-select a specific language UI panel.
