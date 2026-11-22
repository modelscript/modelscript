<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/design-tokens

Shared ModelScript design system: CSS custom properties, primitive component classes, and lightweight TypeScript runtime/panel contract helpers used by the docs site (`apps/docs`, VitePress), the web app (`apps/web`, React + Primer), and IDE webviews (`packages/ide`). It keeps colours, type, radii, and button sizing identical across every surface.

Compiled with `tsc` (`pnpm --filter @modelscript/design-tokens run build`) to emit typed ESM modules (`dist/runtime.js`, `dist/panel.js`) alongside CSS entrypoints.

---

## Subpath Exports

| Subpath                                        | Description                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `@modelscript/design-tokens/tokens.css`        | Core `--ms-*` design tokens (brand, surfaces, text, status, hues, type)   |
| `@modelscript/design-tokens/tokens-vscode.css` | VS Code webview theme bridge mapping `--vscode-*` variables onto `--ms-*` |
| `@modelscript/design-tokens/tokens-web.css`    | Web application theme bridge mapping Primer / web surfaces onto `--ms-*`  |
| `@modelscript/design-tokens/components.css`    | Shared primitive `.ms-btn` and `.ms-chip` component styles                |
| `@modelscript/design-tokens/runtime`           | TypeScript runtime theme helpers (`src/runtime.ts`)                       |
| `@modelscript/design-tokens/panel`             | Shared engineering panel host contract & types (`src/panel.ts`)           |

---

## Usage

```ts
// CSS entry points (import before app-specific CSS)
import "@modelscript/design-tokens/tokens.css";
import "@modelscript/design-tokens/components.css";
// Surface-specific token bridges:
// import "@modelscript/design-tokens/tokens-web.css";
// import "@modelscript/design-tokens/tokens-vscode.css";

// TypeScript runtime & panel contract helpers
import * as themeRuntime from "@modelscript/design-tokens/runtime";
import type * as panelContract from "@modelscript/design-tokens/panel";
```

### Theming

Light is the `:root` default. Dark mode activates with either selector on `<html>`:

| Selector              | Used by   |
| --------------------- | --------- |
| `.dark`               | VitePress |
| `[data-theme="dark"]` | apps/web  |

Consumers map their framework variables onto these tokens rather than hard-coding colours. For example, `--vp-c-brand-1: var(--ms-brand)` in the docs, and Primer `--button-primary-bgColor-rest: var(--ms-brand)` in the web app.

## Tokens (`tokens.css`)

| Group      | Examples                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Brand      | `--ms-brand`, `--ms-brand-hover`, `--ms-brand-soft`, `--ms-gradient`, `--ms-focus-ring`               |
| Surfaces   | `--ms-bg`, `--ms-bg-alt`, `--ms-bg-elv`, `--ms-surface-hover`, `--ms-divider`, `--ms-border`          |
| Text       | `--ms-text-1`, `--ms-text-2`, `--ms-text-3`, `--ms-link`                                              |
| Status     | `--ms-success`, `--ms-warning`, `--ms-danger`, `--ms-info`                                            |
| Hues       | `--hue-indigo`, `--hue-cyan`, `--hue-teal`, `--hue-emerald`, `--hue-amber`, `--hue-rose`              |
| Atmosphere | `--ms-grid-line`, `--ms-glow-cyan`, `--ms-shadow-card`, `--ms-shadow-pop`                             |
| Type/shape | `--ms-font-sans` (Inter), `--ms-font-mono` (JetBrains Mono), `--ms-radius-*`, `--ms-control-sm/md/lg` |

## Components (`components.css`)

```html
<a class="ms-btn ms-btn-primary">Sign up</a>
<!-- one primary per view -->
<a class="ms-btn ms-btn-secondary">Log in</a>
<button class="ms-btn ms-btn-quiet ms-btn-sm">Forgot password?</button>
<button class="ms-btn ms-btn-danger">Delete</button>
<button class="ms-chip" aria-pressed="true">Modelica</button>
```

- **Variants:** `-primary` (alias `-brand`), `-secondary` (alias `-ghost`), `-quiet`, `-danger`
- **Sizes:** `-sm` (30px), default (36px), `-lg` (44px, marketing heroes), plus `-block`

## Scripts

```bash
pnpm --filter @modelscript/design-tokens run build      # Compile TypeScript (tsc)
pnpm --filter @modelscript/design-tokens run typecheck  # Typecheck (tsc --noEmit)
pnpm --filter @modelscript/design-tokens run clean      # Remove dist/ & tsbuildinfo
```

## License

AGPL-3.0-or-later
