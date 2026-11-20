<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/editor`

Host-agnostic visual modeling and code editor core for ModelScript.

Provides the shared **LSP Transport** (`EditorLspTransport`, `createHttpLspTransport`) and **Host Context** (`EditorHostProvider`, `useEditorHost`) abstractions so the same editor workbench can run seamlessly across:

- Production web (`apps/web`) over a WebWorker LSP connection
- Single-language dev playground (`scripts/language-playground.ts`) over `/__playground/lsp` (`@modelscript/lsp/core`)
- Docs embeds (`apps/docs`) and deterministic in-memory tests
