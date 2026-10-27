<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# modelscript-github-fs

VS Code Web extension (`apps/ide/github-fs`) providing a virtual `vscode.FileSystemProvider` for the `github://` URI scheme — enabling zero-clone, in-browser repository browsing and editing in `@modelscript/ide` over the GitHub REST API.

---

## Capabilities

- **`github://` Virtual Filesystem (`src/extension.ts`)**: Mounts public and private GitHub repositories (`github://<owner>/<repo>/...`) directly into the VS Code Web workspace explorer with lazy directory tree resolution and file content caching.
- **Authenticated API Requests**: Reads the optional `github-fs.token` VS Code configuration setting for higher GitHub REST API rate limits and private repository access.
- **Resource Label Formatting**: Registers custom `resourceLabelFormatters` for the `github` URI scheme (`${path}` with `(GitHub)` workspace badge).

---

## Scripts

| Command             | Description                                                      |
| :------------------ | :--------------------------------------------------------------- |
| `npm run build`     | Bundle `src/extension.ts` into `dist/extension.js` via `esbuild` |
| `npm run watch`     | Bundle in watch mode                                             |
| `npm run lint`      | Run ESLint across `src/`                                         |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)                    |
| `npm run clean`     | Remove `dist/` output                                            |
