<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/magicdraw

**Maturity:** Beta · **Extensions:** `.mdzip`, `.mdxml`, `.xmi` · **Docs:** [modelscript.org/languages/magicdraw](https://modelscript.org/languages/magicdraw)

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

## Package Structure

| File                            | Responsibility                                                              |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/language.ts`               | `@modelscript/dsl` language registration (`.mdzip`, `.mdxml`, `.xmi`)       |
| `src/parser/mdzip-archive.ts`   | `.mdzip` container unpacking and integrity/encryption validation            |
| `src/parser/xmi-parser.ts`      | OMG UML 2.x / SysML 1.x XMI parser                                          |
| `src/parser/module-resolver.ts` | `WorkspaceModuleResolver` for external `href` workspace libraries           |
| `src/profiles/index.ts`         | Clean-room UML 2.5, SysML 1.6, QUDV SI units, and MagicDraw `href` profiles |
| `src/lints/rules.ts`            | Semantic lint rules (`M9921`–`M9934`)                                       |
| `src/diagram.ts`                | 2D BDD, IBD, REQ, PAR, and STM diagram model & SVG generator                |
| `src/dae/parametric-to-dae.ts`  | Parametric constraint block lowering into linear-memory `DAEBuilder`        |
| `src/projections/sysml2.ts`     | Migration projection from MagicDraw SysML 1.x to OMG SysML v2 (`.sysml`)    |
| `src/projections/reqif.ts`      | Requirements projection to OMG ReqIF 1.2 (`.reqif`)                         |
| `src/projections/modelica.ts`   | Parametric block projection to Modelica 3.x (`.mo`)                         |
| `src/tgg/magicdraw-rules.ts`    | Triple Graph Grammar (TGG) bidirectional synchronization rules              |
| `src/lsp.ts`                    | Language Server Protocol hover, symbols, and diagnostics                    |
| `src/indexing.ts`               | Workspace symbol indexing across `.mdzip`, `.mdxml`, and `.xmi` files       |
| `src/index.ts`                  | Public package entry point and barrel exports                               |

## Scripts

```bash
pnpm --filter @modelscript/magicdraw build
pnpm --filter @modelscript/magicdraw test
pnpm --filter @modelscript/magicdraw lint
pnpm --filter @modelscript/magicdraw typecheck
```
