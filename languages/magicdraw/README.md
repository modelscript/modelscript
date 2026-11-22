<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/magicdraw`

First-class read, inspection, linting, diagramming, DAE lowering, and polyglot migration support for **MagicDraw / Cameo Systems Modeler** (`.mdzip`, `.mdxml`) and **OMG UML 2.x / SysML 1.x XMI** (`.xmi`) models.

## Features

- **Native ZIP + WASM XML Parsing**: Unpacks `.mdzip` archives via `@modelscript/runtime`'s `defaultContainerToolkit` and parses XMI via `@modelscript/dsl/xml` (`parser.wasm`), with clean diagnostics for corrupt, encrypted, and Teamwork Cloud (TWC) proxy-stub archives.
- **Clean-Room Standard Profiles**: Built-in OMG UML 2.5 primitives, OMG SysML 1.6 stereotype taxonomy & BDD compartment rules, QUDV/ISO-80000 SI units, and MagicDraw `href` interoperability mappings—without bundling any proprietary vendor profile binaries.
- **Workspace Mounted Module Resolution**: Resolves external `href` references across workspace `.mdzip` / `.mdxml` libraries via `WorkspaceModuleResolver`.
- **Semantic Lints (`M9921`–`M9934`)**: Validates archive integrity, duplicate `xmi:id`s, orphan stereotypes, unresolved `href`s, untyped properties/ports, dangling connectors, cyclic block composition, requirement completeness/traceability, and parametric binding compatibility.
- **2D Diagram Engine**: Generates interactive models and headless SVGs for **BDD**, **IBD**, **REQ**, **PAR**, and **STM** diagrams, honoring MagicDraw `mdOwnedViews` coordinates when present.
- **Polyglot Projections & DAE Lowering**:
  - `.mdzip` → **OMG SysML v2 (`.sysml`)**
  - `.mdzip` → **OMG ReqIF 1.2 (`.reqif`)**
  - `.mdzip` Parametrics → **Modelica (`.mo`)** & **Linear-Memory `DAEBuilder`**
