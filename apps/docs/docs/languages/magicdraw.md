---
title: MagicDraw / Cameo (.mdzip)
description: Read, inspect, lint, render diagrams, lower parametrics to DAE, and migrate MagicDraw / Cameo Systems Modeler (.mdzip, .mdxml, .xmi) models to SysML v2, ReqIF, and Modelica.
---

# MagicDraw / Cameo (`.mdzip`, `.mdxml`, `.xmi`)

`@modelscript/magicdraw` provides first-class read, inspection, linting, 2D diagram rendering, arena-native DAE lowering, and polyglot migration support for **MagicDraw / Cameo Systems Modeler** archives (`.mdzip`, `.mdxml`) and **OMG UML 2.x / SysML 1.x XMI** (`.xmi`) files.

## Capabilities

- **Container & Native WASM XML Parsing**: Unpacks `.mdzip` archives via `@modelscript/runtime`'s `defaultContainerToolkit` (including gzipped internal entries and base64/binary LSP payloads) and parses XMI via `@modelscript/dsl/xml` (`parser.wasm`).
- **Clean-Room Standard Profiles**: Built-in OMG UML 2.5 primitives, OMG SysML 1.6 stereotype inheritance & BDD compartment classification (`parts`, `references`, `values`, `constraints`, `flow properties`, `operations`), QUDV/ISO-80000 SI units, and MagicDraw `href` interoperability mappings—with zero proprietary vendor profile binaries bundled.
- **Workspace Mounted Module Resolution**: Resolves external `href` references across workspace `.mdzip` / `.mdxml` libraries via `WorkspaceModuleResolver`.
- **2D Diagram Engine**: Renders **BDD**, **IBD**, **REQ**, **PAR**, and **STM** diagrams, honoring saved `mdOwnedViews` coordinates when present and falling back cleanly to automatic layout.
- **Semantic Lints (`M9921`–`M9934`)**: Validates archive integrity, encryption, Teamwork Cloud proxy stubs, duplicate `xmi:id`s, orphan stereotypes, unresolved `href`s, untyped properties/ports, dangling connectors, cyclic composition, requirement completeness/traceability, and parametric binding compatibility.
- **Polyglot Projections & DAE Lowering**:
  - `.mdzip` → **OMG SysML v2 (`.sysml`)**
  - `.mdzip` → **OMG ReqIF 1.2 (`.reqif`)**
  - `.mdzip` Parametrics → **Modelica (`.mo`)** & **Linear-Memory `DAEBuilder`**

## CLI Usage

```bash
# Summarize packages, blocks, requirements, state machines, and diagrams
msx magicdraw inspect VehicleArchitecture.mdzip

# Run semantic & structural lint checks (M9921–M9934)
msx magicdraw lint VehicleArchitecture.mdzip

# Migrate SysML 1.x .mdzip to textual SysML v2
msx magicdraw to-sysml VehicleArchitecture.mdzip -o VehicleArchitecture.sysml

# Export SysML 1.x requirements to OMG ReqIF 1.2
msx magicdraw to-reqif VehicleArchitecture.mdzip -o Requirements.reqif

# Project parametric constraint blocks to Modelica
msx magicdraw to-modelica VehicleArchitecture.mdzip -o VehicleParametrics.mo

# Render a BDD, IBD, REQ, PAR, or STM diagram as headless SVG
msx magicdraw render VehicleArchitecture.mdzip --diagramKind BDD -o architecture.svg
```

## Benchmarks

<LanguageBenchmarks lang="magicdraw" />
