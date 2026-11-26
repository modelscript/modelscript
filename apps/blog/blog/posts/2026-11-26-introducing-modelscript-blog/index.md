---
title: "Introducing the ModelScript Blog: Interactive Engineering Posts"
slug: introducing-modelscript-blog
date: 2026-11-26
author: omar
tags: [announcement, modelica, ansatz, wasm]
featured: true
draft: false
description: "Why we built blog.modelscript.org with live, click-to-interact Ansatz artifacts embedded directly inside every technical post."
ogAlt: "ModelScript Blog — Interactive Engineering Posts with Live Ansatz Artifacts"
social:
  twitter: >-
    We just launched blog.modelscript.org — static engineering deep dives with live,
    click-to-interact Ansatz simulation & CAD artifacts embedded right inside every post.
  linkedin: >-
    Technical engineering blogs shouldn't be stuck with static screenshots of models and plots.

    Today we're launching the ModelScript Engineering Blog at blog.modelscript.org. Every post is
    statically generated for instant loading, while letting you click into live Ansatz artifacts
    directly inside the article—inspecting schematics, tweaking Modelica parameters, or orbiting 3D
    assemblies without leaving the page.

    Read our inaugural post and try the live embedded RC filter simulation inline:
  hashtags: [ModelScript, Modelica, SystemsEngineering, WebAssembly, DigitalThread]
---

Engineering articles usually force an awkward trade-off: either you read static screenshots of equations and plots, or you download a multi-gigabyte desktop toolchain just to reproduce a single figure.

With **blog.modelscript.org**, we wanted every technical deep dive to stay as fast and linkable as a static site while allowing readers to **interact directly with live engineering models** right inside the prose.

## Click-to-Interact Ansatz Artifacts

Every post can embed live **Ansatz artifact blocks**. On initial page load, an artifact block renders a lightweight technical preview (or custom poster image) with zero WebAssembly or WebGL overhead. Clicking **Interact Live** mounts the full interactive viewer in place—with automatic dark/light theme syncing, fullscreen expansion, and one-click handoff to [Ansatz Studio](https://ansatz.social/studio).

Below is a self-contained Modelica RC low-pass filter embedded directly via the `::: ansatz-artifact` Markdown block. Click **Interact Live** to inspect the schematic, modify `R` or `C`, and run the browser WebAssembly solver inline:

::: ansatz-artifact
title: "RC Low-Pass Filter — Interactive Modelica Simulation"
dialect: modelica
view: split-columns
kind: simulation
height: 500px
figure: "Figure 1"
caption: "Click 'Interact Live' to compile and simulate this Modelica model directly inside the blog post."

```modelica
model RCLowPass
  parameter Real R = 1000.0 "Resistance [Ohm]";
  parameter Real C = 1e-6 "Capacitance [F]";
  parameter Real Vin = 5.0 "Step input voltage [V]";
  Real v(start = 0.0) "Capacitor voltage [V]";
  Real i "Current [A]";
equation
  i = C * der(v);
  Vin = R * i + v;
end RCLowPass;
```

:::

## How Posts Are Structured

Every article in [`apps/blog`](https://github.com/modelscript/modelscript/tree/main/apps/blog) follows a uniform folder-per-post layout:

```text
apps/blog/blog/posts/
  └── YYYY-MM-DD-<slug>/
        ├── index.md
        └── (optional co-located images, SVGs, or model files)
```

At build time, VitePress rewrites each folder to a clean root URL (`https://blog.modelscript.org/<slug>`), validates frontmatter and social summary budgets (for both X/Twitter and LinkedIn), generates `1200×630` Open Graph cards, and publishes RSS, Atom, and sitemap feeds.

## What's Coming Next

Over the coming weeks we'll share deep dives on:

1. **Linear-Memory WebAssembly Compilers**: How our struct-of-arrays DAE arena eliminates intermediate AST allocations across 169 engineering languages.
2. **Polyglot Digital Threads**: Linking SysML v2 requirements, Modelica dynamics, and STEP CAD geometry into a single computable graph.
3. **Formal Verification in the Browser**: Running symbolic index reduction, BLT partitioning, and SMT checks client-side.

Subscribe via [RSS](/rss.xml) or [Atom](/atom.xml), or explore the [ModelScript Documentation](https://modelscript.org/guide/introduction).
