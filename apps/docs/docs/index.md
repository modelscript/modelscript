---
layout: home

hero:
  name: "ModelScript"
  text: "The Computable Digital Thread for Engineering & Simulation"
  tagline: "Parse, lint, flatten, simulate, optimize, and formally verify across Modelica, SysML v2, CAD, and continuum physics — uniting multi-domain engineering in an active computable digital thread. Free and open-source under AGPL-3.0."
  image:
    src: /ms-logo.png
    alt: ModelScript 3D Turbine Engine
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Try in Browser (Morsel)
      link: https://morsel.modelscript.org
    - theme: alt
      text: Launch Web IDE
      link: https://ide.modelscript.org
    - theme: alt
      text: View on GitHub
      link: https://github.com/modelscript/modelscript

features:
  - icon: ⚡
    title: Incremental GLR Parsing
    details: Native WebAssembly GLR incremental parser with full Modelica & SysML2 grammar coverage and instant IDE-speed responsiveness.
    link: /architecture/glr-parser
  - icon: 🔍
    title: Real-Time Linting & Diagnostics
    details: Over 15 compiler lint rules covering syntax errors, unresolved references, type mismatches, and structural consistency checks.
    link: /reference/linter-rules
  - icon: 🧬
    title: Arena DAE Flattening
    details: High-speed flattening in WebAssembly linear memory transforming hierarchical models into Differential Algebraic Equations with zero AST overhead.
    link: /architecture/dae-arena
  - icon: ⚙️
    title: High-Performance Simulation
    details: ODE/DAE numerical solver with Pantelides index reduction, Tarjan BLT partitioning, Cellier-Elmqvist tearing, and alias elimination.
    link: /algorithms/pantelides
  - icon: 🎯
    title: Collocation Optimization
    details: Direct collocation solver for optimal control problems with configurable state bounds, algebraic constraints, and custom objectives.
    link: /algorithms/optimization
  - icon: 🧵
    title: Computable Digital Thread
    details: Unified hypergraph connecting SysML v2 requirements, Modelica physics, STEP CAD, and continuum analysis with bidirectional TGG synchronization and formal verification.
    link: /architecture/overview
---

<HomeQuickStart />

<HomePackages />

<HomeVsCode />

<HomeDocker />
