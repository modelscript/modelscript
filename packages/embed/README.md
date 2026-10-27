<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/embed

ModelScript Embed Client SDK (`@modelscript/embed`) — zero-boilerplate `<modelscript-viewer>` Web Component, bidirectional `postMessage` iframe RPC controller (`ModelScriptEmbed`), URL-safe DEFLATE permalink codec (`#m=...`), context pooling, and SSR/static DOM rehydration for embedding interactive diagrams, 3D CAD assemblies, and live simulations into documentation sites, blogs, and enterprise portals.

---

## Architecture & Capabilities

### 1. `<modelscript-viewer>` Custom Element (`@modelscript/embed/element`, `src/element.ts`)

- **Standards-Compliant Web Component (`ModelScriptViewerElement`)**: Automatically registers `<modelscript-viewer>` in browser environments with encapsulated Shadow DOM styling.
- **Reactive Attributes**: Observes `code`, `view` (`diagram` | `cad` | `plot` | `code` | `split-columns` | `split-rows`), `anchor` (deep-linked component/connection highlight), `zoom-mode` (`ctrl-wheel` | `always` | `click-to-interact`), `dialect`, `multi-file`, `artifact-id`, and `origin`.

### 2. Programmatic Iframe Controller (`ModelScriptEmbed`, `src/client.ts`)

- **Bidirectional Host ↔ Embed RPC (`@modelscript/embed/protocol`, `src/protocol.ts`)**:
  - **Host → Embed Commands (`HostToEmbedMessage`)**: `setCode(code)`, `setView(view)`, `setAnchor(anchor)`, `setZoomMode(zoomMode)`, `setTheme(theme)`, `triggerSimulate({ stopTime, stepSize })`, and `REQUEST_EXPORT_SVG`.
  - **Embed → Host Events (`EmbedToHostMessage`)**: Subscribe via `embed.on(type, handler)` to `EMBED_READY`, `CODE_CHANGED`, `ANCHOR_CLICKED`, `SIMULATION_STATUS`, `SIMULATION_RESULTS`, `EXPORTED_SVG`, and `OPEN_TARGET_REQUESTED`.
- **Smart Launch Routing (`getLaunchInfo`)**: Routes single-file snippets to `/playground#m=<token>` and multi-file packages directly into the full VS Code Web workbench (`/vscode/workbench/#memfs:artifact-<id>`).

### 3. Compressed Permalink Codec (`@modelscript/embed/codec`, `src/codec.ts`)

- **URL-Safe DEFLATE Serialization**:
  - `compressEmbedPayload(payload)`: Compresses a `UniversalEmbedPayload` (source code, dialect, view mode, element anchor, simulation parameters, 3D camera pose, and package dependencies) using `pako.deflate` into a compact URL-safe Base64 token.
  - `decompressEmbedPayload(rawHash)`: Safely validates payload size bounds (`MAX_ENCODED_PAYLOAD_LENGTH = 2 MB`, `MAX_DECODED_PAYLOAD_LENGTH = 5 MB`) and inflates `#m=...` permalink hashes back into typed payloads.

### 4. Context Pooling & Static DOM Rehydration (`src/context-pool.ts`, `src/rehydration.ts`)

- **Iframe & Worker Context Pool (`src/context-pool.ts`)**: Manages concurrent embedded viewer instances on documentation pages with many diagrams to stay within browser WebGL/iframe limits.
- **Static SVG / Code Block Rehydration (`src/rehydration.ts`)**: Progressively upgrades static server-rendered code blocks or SVG previews into interactive embedded viewers on scroll or click.

---

## Subpath Exports

| Subpath                       | Module            | Description                                                                                     |
| :---------------------------- | :---------------- | :---------------------------------------------------------------------------------------------- |
| `@modelscript/embed`          | `src/index.ts`    | Root barrel exporting `ModelScriptEmbed`, `ModelScriptViewerElement`, codec, pool, and protocol |
| `@modelscript/embed/protocol` | `src/protocol.ts` | `UniversalEmbedPayload`, `HostToEmbedMessage`, `EmbedToHostMessage`, and anchor types           |
| `@modelscript/embed/codec`    | `src/codec.ts`    | `compressEmbedPayload`, `decompressEmbedPayload`, and `getLaunchUrl`                            |
| `@modelscript/embed/element`  | `src/element.ts`  | `<modelscript-viewer>` Custom HTML Web Component                                                |

---

## Usage

### 1. Declarative HTML Web Component

```html
<script type="module" src="https://esm.sh/@modelscript/embed/element"></script>

<modelscript-viewer
  dialect="modelica"
  view="split-columns"
  anchor="R1"
  zoom-mode="ctrl-wheel"
  code="model RLC parameter Real R = 10; Real v(start=1); equation der(v) = -v / R; end RLC;"
>
</modelscript-viewer>
```

### 2. Programmatic TypeScript Controller

```typescript
import { compressEmbedPayload, ModelScriptEmbed } from "@modelscript/embed";

const viewer = new ModelScriptEmbed({
  container: "#diagram-container",
  dialect: "modelica",
  view: "diagram",
  code: "model BouncingBall Real h(start=1), v(start=0); equation der(h)=v; der(v)=-9.81; end BouncingBall;",
  anchor: { elementId: "h", kind: "component" },
  theme: "dark",
});

viewer.on("EMBED_READY", () => {
  viewer.triggerSimulate({ stopTime: 3.0, stepSize: 0.01 });
});

viewer.on("SIMULATION_RESULTS", (msg) => {
  console.log("Simulated variables:", msg.variables, "Rows:", msg.data.length);
});
```

---

## Scripts

| Command             | Description                                               |
| :------------------ | :-------------------------------------------------------- |
| `npm run build`     | Compile TypeScript declarations and ES modules (`tsc -b`) |
| `npm run test`      | Run codec, protocol, and embed client unit tests          |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)             |
| `npm run clean`     | Remove `dist/` build artifacts                            |
