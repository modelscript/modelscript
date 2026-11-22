# `scripts/tools` — Developer, Compliance & Asset Utilities

This directory contains standalone developer-experience (DX) utilities, the isolated single-language playground launcher, GDPR/CCPA user-data export tooling, and procedural CAD/icon asset generators.

## Quick Reference

| File                                                       | npm Script / Invocation                                   | When to Use                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`dev-doctor.ts`](./dev-doctor.ts)                         | `npm run doctor:dev`                                      | Verify local Node version (`.nvmrc`), CPU/RAM, `asc`, `omc`, MSL 4.1.0, `data/`, Docker, and docs setup on onboarding. |
| [`clean-scratch.ts`](./clean-scratch.ts)                   | `npm run clean:scratch`                                   | Delete untracked `scratch*` files/dirs, `blink.log`, and `asc_error.log` without touching git-tracked files.           |
| [`language-playground.ts`](./language-playground.ts)       | `npm run playground -- <lang>`                            | Launch an isolated Vite + Monaco/Morsel + LSP dev server for a single language in `languages/<lang>/`.                 |
| [`export-user-data.ts`](./export-user-data.ts)             | `npx tsx scripts/tools/export-user-data.ts [opts]`        | Batch-export GDPR Art. 20 / CCPA user data archives (`.zip` with offline HTML viewer or `.json`) from SQLite.          |
| [`generate-drone-step.ts`](./generate-drone-step.ts)       | `npx tsx scripts/tools/generate-drone-step.ts [out.step]` | Procedurally generate an ISO-10303-21 (STEP AP214) quadcopter chassis B-Rep CAD fixture.                               |
| [`generate-desktop-icons.py`](./generate-desktop-icons.py) | `python3 scripts/tools/generate-desktop-icons.py`         | Generate multi-size PNG/ICO/ICNS Tauri desktop icons from `languages/modelscript/assets/icon-dark.png`.                |

---

## Script Reference

### [`dev-doctor.ts`](./dev-doctor.ts)

- **Purpose:** Local environment preflight checker across all three contributor tracks:
  - **Core:** Validates Node.js major version against `.nvmrc` (required — fails with exit `1` on mismatch) and reports CPU parallelism and RAM.
  - **Track A (Compiler):** Checks `asc`, `omc`, and `data/libraries/Modelica/4.1.0/extracted/Modelica`.
  - **Track B (Platform):** Ensures `data/` exists (creating it if absent) and checks `docker`.
  - **Track C (Docs):** Checks `apps/docs/docs`.
- **When to use:** Run `npm run doctor:dev` after cloning the repo, switching Node versions, or debugging missing toolchain dependencies.
- **Callers:** Root `package.json` (`doctor:dev`).

---

### [`clean-scratch.ts`](./clean-scratch.ts)

- **Purpose:** Safely removes untracked temporary scratch scripts and compiler error logs (`/^scratch($|[_.-])/i`, `blink.log`, `asc_error.log`) up to depth 6 from the repository root while skipping `.git`, `node_modules`, `.nx`, `.cache`, `vendor`, and any git-tracked paths.
- **When to use:** Run `npm run clean:scratch` (or `-- --dry-run` first) after ad-hoc debugging or agent scratch-script runs.
- **CLI flags:** `--dry-run`.
- **Callers:** Root `package.json` (`clean:scratch`).

---

### [`language-playground.ts`](./language-playground.ts)

- **Purpose:** Starts an isolated Vite dev server rooted at [`scripts/playground/`](../playground/README.md) for a single language package (`languages/<lang>/`), wiring up `@modelscript/lsp/core` over HTTP, live WASM parser bindings, sample discovery, and source HMR aliases for `@modelscript/editor`, `@modelscript/react`, `@modelscript/diagram`, and `@modelscript/design-tokens`.
- **When to use:** Run `npm run playground -- <lang>` (or `npm run playground` inside any `languages/<lang>/` directory) when iterating on a language's grammar, LSP, stencils, or `src/ui/*.tsx` panels without building the full 104-language web app.
- **How it works:**
  - Uses `discoverSingleLanguage()` from `@modelscript/dsl` to load language metadata, UI panels, simulation cards, stencils, and toolbar buttons into the virtual module `virtual:modelscript-playground-lang`.
  - Serves dev middleware endpoints: `GET /__playground/parser.wasm`, `GET /__playground/bindings.js`, `GET /__playground/sample`, `POST /__playground/lsp`, and `POST /__playground/rebuild-parser`.
  - With `--morsel`, delegates to `@modelscript/web` at `/playground?lang=<id>&single=1`.
- **CLI flags:**
  - `<language|path>` or `--lang, -l <target>` (defaults to `cwd` if inside `languages/*`).
  - `--port, -p <num>` (default `5179`, or `5173` with `--morsel`), `--host <addr>` (default `127.0.0.1`).
  - `--file, -f <path>`, `--mode, -m <workbench|inspector|artifact>`, `--theme, -t <dark|light>`, `--morsel`, `--open`, `--help, -h`.
- **Callers:** Root `package.json` (`playground`) and 100+ `languages/*/package.json` `"playground"` scripts.
- **Note:** `POST /__playground/rebuild-parser` currently references `scripts/build-language-parser.js` instead of `scripts/build/build-language-parser.js` after the `scripts/build/` reorganization; verify that path before relying on in-browser WASM rebuilds.

---

### [`export-user-data.ts`](./export-user-data.ts)

- **Purpose:** Operator CLI for GDPR Art. 20 / CCPA § 1798.100 batch user-data archive exports directly from the SQLite `LibraryDatabase` (`apps/api/src/database.js`), using a bounded async worker pool.
- **When to use:** Bulk compliance fulfillment, account migration, or offline recovery outside the running API server. Also exercised directly by `apps/api/tests/archive-batch-and-concurrency.test.ts`.
- **CLI flags & environment variables:**
  - Target selection: positional `<usernames_or_ids...>`, `--all`, or `--users, -u <list>`.
  - `--concurrency, -c <N>` (default `2`, or `ARCHIVE_CONCURRENCY` / `ARCHIVE_MAX_CONCURRENCY`).
  - `--output-dir, -o, --out <dir|file>` (default `./data/archives`), `--output <file>`.
  - `--format, -f <zip|json>`, `--json`.
  - `--sqlite, -s, --dir, -d <path>` (default `./data`), `--quiet, -q`, `--help, -h`, `NO_COLOR`.
- **Exit codes:** `0` on success (or `--help` / `--all` with 0 users); `1` on invalid targets or any failed export job.

---

### [`generate-drone-step.ts`](./generate-drone-step.ts)

- **Purpose:** Zero-dependency procedural ISO-10303-21 (STEP AP214 `AUTOMOTIVE_DESIGN`) B-Rep generator that emits a 20-solid quadcopter chassis assembly (`DroneChassisCAD`: central body, top cover, electronics bay, 4 arms, 4 motors, 2 landing skids, 4 struts, camera mount/housing, battery).
- **When to use:** Authoring or regenerating deterministic STEP B-Rep CAD fixtures (e.g., `packages/examples/drone-chassis/cad/drone.step`).
- **CLI arguments:** Optional `argv[2]` output file path (defaults to `/dev/stdout`).

---

### [`generate-desktop-icons.py`](./generate-desktop-icons.py)

- **Purpose:** Python/Pillow script that scales `languages/modelscript/assets/icon-dark.png` onto a 512x512 RGBA canvas and generates Tauri desktop icon assets (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, multi-size `icon.ico`, `icon.icns`) in `apps/desktop/src-tauri/icons/`.
- **When to use:** Standalone brand/icon regeneration whenever updating desktop app branding (requires `Pillow` and a Tauri `apps/desktop/` checkout).
