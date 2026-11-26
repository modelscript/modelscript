<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/blog (`blog.modelscript.org`)

Statically generated engineering blog for ModelScript & Ansatz, built with VitePress and hosted alongside `modelscript.org` inside the unified `web` Nginx container.

## Authoring a New Post

Create a folder using the uniform naming convention `YYYY-MM-DD-<slug>`:

```text
apps/blog/blog/posts/2026-12-01-my-post-slug/
├── index.md
└── diagram.png   # optional co-located assets
```

Every `index.md` is automatically rewritten to a clean root URL: `https://blog.modelscript.org/my-post-slug`.

### Required Frontmatter

```yaml
---
title: "Post Title"
slug: my-post-slug
date: 2026-12-01
author: omar
tags: [modelica, wasm]
description: "Concise SEO & OpenGraph description (≤ 160 chars)."
social:
  twitter: "Short X/Twitter summary (≤ 250 chars; URL is appended automatically)."
  linkedin: |-
    Medium-sized LinkedIn summary (~300–1,300 chars) with hook and key takeaways.
  hashtags: [ModelScript, Modelica]
---
```

### Embedding Interactive Ansatz Artifacts

Use the `::: ansatz-artifact` Markdown block (click-to-interact by default):

- **Hosted Ansatz artifact** (by ID on `ansatz.social`):
  ```markdown
  ::: ansatz-artifact
  artifactId: "42"
  title: "Turbine Assembly (STEP)"
  kind: cad
  poster: "./preview.png"
  caption: "Interactive 3D CAD assembly."
  :::
  ```
- **Inline self-contained model**:
  ````markdown
  ::: ansatz-artifact
  title: "RC Low-Pass Filter"
  dialect: modelica
  view: split-columns
  kind: simulation

  ```modelica
  model RC ... end RC;
  ```

  :::
  ````

## Commands

```bash
pnpm --filter @modelscript/blog dev          # Local dev server (port 5174)
pnpm --filter @modelscript/blog check        # Validate post naming, frontmatter & social budgets
pnpm --filter @modelscript/blog build        # Validate, generate OG cards, build static site & feeds
pnpm --filter @modelscript/blog social       # Print ready-to-paste X/Twitter & LinkedIn copy
```
