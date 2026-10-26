# Embedding Artifacts & Models

The **ModelScript Embed Service** allows you to embed interactive 2D schematics, 3D CAD/STEP models, simulation trajectory charts, and editable playgrounds directly into external websites, blogs, Notion, and documentation portals.

---

## 1. Quick Start: Web Component (`<modelscript-viewer>`)

The simplest and cleanest way to embed a ModelScript model in any modern web page or documentation framework is using the custom Web Component:

```html
<script type="module" src="https://cdn.modelscript.org/embed/v1/viewer.js"></script>

<modelscript-viewer
  dialect="modelica"
  view="diagram"
  anchor="R1"
  code="model RLC
  Modelica.Electrical.Analog.Basic.Resistor R1(R=100);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=1e-6);
equation
  connect(R1.p, C1.n);
end RLC;"
>
</modelscript-viewer>
```

### Supported Attributes

| Attribute     | Default        | Description                                                                                                                                    |
| :------------ | :------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`     | `"modelica"`   | Language dialect: `"modelica"`, `"sysml2"`, `"step"`, `"scad"`, `"pscad"`, `"olga"`, `"csv"`.                                                  |
| `view`        | `"diagram"`    | Initial visual mode: `"diagram"`, `"cad"`, `"plot"`, `"code"`, `"split-columns"`.                                                              |
| `anchor`      | `undefined`    | Target component element ID to visually highlight and auto-center (e.g. `"R1"` or `"chassis"`).                                                |
| `controls`    | `"none"`       | Set to `"parameters"` to display an interactive live parameter slider ribbon below the model.                                                  |
| `zoom-mode`   | `"ctrl-wheel"` | Scroll protection mode: `"ctrl-wheel"` (requires Ctrl/⌘ to zoom, preventing iframe page wheel-trapping), `"always"`, or `"click-to-interact"`. |
| `multi-file`  | `false`        | If set, the watermark pill routes the user to the **ModelScript IDE** instead of the Playground.                                               |
| `artifact-id` | `undefined`    | Numerical ID of a published artifact on the ModelScript Hub.                                                                                   |

---

## 2. Zero-Config `<iframe>` Embed

For Markdown documents, Notion, or environments where custom scripts are restricted, use an `<iframe>` with a compressed `#m=...` permalink hash:

```html
<iframe
  src="https://embed.modelscript.org/?view=diagram&theme=dark#m=<compressed-token>"
  width="100%"
  height="500"
  frameborder="0"
  allow="clipboard-write"
>
</iframe>
```

---

## 3. Programmatic JavaScript SDK (`@modelscript/embed`)

For full programmatic control in React, Vue, Svelte, or vanilla TypeScript applications, install the client package:

```bash
npm install @modelscript/embed
```

```typescript
import { ModelScriptEmbed } from "@modelscript/embed";

const embed = new ModelScriptEmbed({
  container: "#viewer-container",
  dialect: "modelica",
  view: "diagram",
  anchor: { elementId: "R1" },
  code: `model Example ... end Example;`,
});

// React to user interactions inside the embed
embed.on("ANCHOR_CLICKED", ({ anchor }) => {
  console.log("User focused element:", anchor.elementId);
});

// Update model code or trigger simulation dynamically
embed.setCode(`model Updated ... end Updated;`);
embed.triggerSimulate({ stopTime: 10.0 });
```

---

## 4. React Component SDK (`@modelscript/react`)

For native React applications, `@modelscript/react` provides first-class components and hooks for engineering inspection:

```bash
npm install @modelscript/react
```

```tsx
import { BlackboxInspector, StepResponseTestbench, useCWasmCompiler } from "@modelscript/react";

export function SimulationDashboard({ fmuBuffer }: { fmuBuffer: ArrayBuffer }) {
  const { compile, isCompiling } = useCWasmCompiler();

  return (
    <div className="dashboard-grid">
      {/* Live inspection of FMU variables, inputs, and outputs */}
      <BlackboxInspector
        buffer={fmuBuffer}
        onVariableChange={(name, val) => console.log(`Param ${name} updated to ${val}`)}
      />

      {/* Dynamic step response testbench with automatic settling time & overshoot metrics */}
      <StepResponseTestbench
        buffer={fmuBuffer}
        inputVariable="voltage_in"
        outputVariable="speed_out"
        stepMagnitude={10.0}
        stopTime={5.0}
      />
    </div>
  );
}
```

---

## 5. Accelerated Rehydration (`IndexedDB`)

When loading models that depend on standard libraries (such as the Modelica Standard Library or KerML), `@modelscript/embed` utilizes pre-baked binary symbol tables (`.sym.bin`):

```typescript
import { PackageRehydrationCache } from "@modelscript/embed";

// Retrieves from local IndexedDB in <15ms or streams from CDN on cache miss
const symbolBuffer = await PackageRehydrationCache.loadOrFetch("Modelica", "4.0.0");
```

This bypasses parsing thousands of library classes on every page load, delivering instant sub-second boot times even on mobile devices.

---

## 6. Live Parameter Slider Ribbon

Embeds can be made dynamically interactive without opening full code editors. Pass `controls="parameters"` or append `?controls=parameters` to any embed URL:

```html
<modelscript-viewer
  dialect="modelica"
  view="plot"
  controls="parameters"
  code="model RC
  parameter Real R = 100 \"Resistance\";
  parameter Real C = 1e-4 \"Capacitance\";
  Real v(start=5.0);
equation
  der(v) = -v / (R * C);
end RC;">
</modelscript-viewer>
```

The viewer automatically extracts top-level parameters from the model code, renders sleek glassmorphic range sliders with real-time numeric inputs, and re-executes simulations upon user adjustments with built-in 300ms debouncing.

---

## 7. Universal oEmbed API & Rich Social Cards

ModelScript embeds implement the standard [oEmbed specification](https://oembed.com/) (`GET /api/v1/oembed`), enabling drop-in interactive previews in Notion, Discord, Slack, and WordPress.

### Auto-Discovery

Every ModelScript post (`https://modelscript.org/p/:id`) includes standard auto-discovery `<link>` tags in the HTML header:

```html
<link
  rel="alternate"
  type="application/json+oembed"
  href="https://api.modelscript.org/api/v1/oembed?url=https%3A%2F%2Fmodelscript.org%2Fp%2F123&format=json"
  title="ModelScript Interactive Model"
/>
```

### Direct oEmbed Query

Clients can query the oEmbed endpoint directly using either a post URL or a playground permalink hash (`#m=...`):

```bash
curl "https://api.modelscript.org/api/v1/oembed?url=https%3A%2F%2Fmodelscript.org%2F%23m%3DeJy...&maxwidth=800&format=json"
```

Response:

```json
{
  "version": "1.0",
  "type": "rich",
  "provider_name": "ModelScript",
  "provider_url": "https://modelscript.org",
  "title": "Interactive Model Simulation",
  "width": 800,
  "height": 500,
  "html": "<iframe src=\"https://embed.modelscript.org/?embed=true#m=eJy...\" width=\"100%\" height=\"500\" frameborder=\"0\" loading=\"lazy\" allow=\"clipboard-write\" style=\"border-radius:12px;border:1px solid rgba(255,255,255,0.1);max-width:800px;\"></iframe>"
}
```

---

## 8. WebGL Context Management & Mobile Scroll Protection

To guarantee rock-solid stability when multiple 3D CAD or WebGPU viewers exist on the same page:

- **Context Pooling (`CanvasContextPool`):** Restricts active WebGL contexts to 6 on mobile/Safari and 8 on desktop. Inactive canvases automatically sleep and display an ultra-crisp WebP raster snapshot with a glassmorphic `🧊 Click to re-activate 3D` overlay pill.
- **Scroll Hijacking Protection:** Embeds intercept wheel events and require holding `Ctrl` (Windows/Linux) or `⌘` (macOS) to zoom, displaying a non-intrusive badge hint if scrolling is attempted without the key.
- **Mobile Touch Passthrough:** Single-finger dragging vertically passes straight through to scroll the host webpage; two-finger pinch and drag gestures control 3D orbit and dolly zoom.
