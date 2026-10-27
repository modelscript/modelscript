<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/fea

Finite Element Analysis (FEA) solver deck DSL supporting CalculiX/Abaqus (`.inp`, `.inpt`), NASTRAN Bulk Data (`.bdf`), and `.fea` files, with a WebAssembly GLR parser, `{{ expr }}` parametric deck materializer, 3D CAD boundary/load card synthesizer, pre-flight structural linter (`F1001`–`F1008` / `M7401`–`M7408`), structural theory slicer, and 3D Tet4/Tet10 FEA solver integration.

---

## Core Capabilities

- **Multi-Dialect FEA Solver Deck DSL (`.fea`, `.inp`, `.inpt`, `.bdf`)**: Declarative grammar (`feaLanguage`) and dialect parsers supporting CalculiX / Abaqus keyword cards (`*NODE`, `*ELEMENT`, `*NSET`, `*ELSET`, `*MATERIAL`, `*ELASTIC`, `*DENSITY`, `*SOLID SECTION`, `*BOUNDARY`, `*CLOAD`, `*DLOAD`, `*STEP`) via `InpDialect` and NASTRAN Bulk Data cards (`GRID`, `CTETRA`, `CHEXA`, `PSOLID`, `MAT1`, `SPC1`, `FORCE`, `MOMENT`, `ENDDATA`) via `BdfDialect`.
- **WASM GLR Incremental Parser**: Built on `@modelscript/dsl` (`language()`), indexing `FeaDeck`, `KeywordCard`, and `EmbeddedExpression` symbols with Salsa query hooks (`instantiate`, `resolveSimpleName`).
- **`{{ expr }}` Parametric Deck Materializer (`materializeFeaDeck`)**: Evaluates embedded expressions (`{{ ... }}`) inside `.inpt` parametric templates against a safe mathematical function library (`sin`, `cos`, `sind`, `cosd`, `sqrt`, `cbrt`, `pow`, `PI`, etc.) and external parameter tables (`evaluateFeaExpression`, `materializeCalculixDeck`), reporting precise 1-indexed line and column diagnostics on unresolved parameters.
- **3D Face Boundary & Load Card Synthesizer (`synthesizeFeaBoundary`)**: Translates interactive 3D CAD face/node selections (`BoundaryActionPayload` for `fix`, `displacement`, `force`, `moment`, and `pressure`) into CalculiX/Abaqus (`*BOUNDARY`, `*CLOAD`, `*DLOAD`) or NASTRAN (`SPC1`, `FORCE`, `MOMENT`) cards, and injects them before `*END STEP` or `ENDDATA` via `applyBoundaryActionToDeck`.
- **Pre-Flight Structural Linter (`lintFeaModel`, `FeaErrorCode`)**: Validates elastic modulus positivity, Poisson's ratio physical stability bounds ($-1.0 < \nu < 0.5$), rigid-body boundary constraints, non-empty meshes, material assignments, degenerate element nodes, yield strength, and mass density with Quick-Fix actions.
- **Structural Theory Slicing (`extractFeaSlicingProperties`)**: Extracts reduced-order structural bounding scalars—total mass ($m$), maximum von Mises stress ($\sigma_{\text{max}}$), material yield strength ($\sigma_y$), safety factor ($\text{SF} = \sigma_y / \sigma_{\text{max}}$), and safety predicate (`isSafe`)—for continuous 1D DAE co-simulation and formal contract verification.
- **Built-in 3D Tet4/Tet10 FEA Solver Integration**: Parses 3D tetrahedral (`C3D4`, `C3D10`, `CTETRA`) and hexahedral (`C3D8`, `C3D8R`, `CHEXA`) meshes, node sets, isotropic material properties ($E, \nu, \rho$), Dirichlet boundary fixities, and concentrated nodal loads into `FeaModelData` for direct execution on `@modelscript/simulate`'s 3D finite element structural solver (`run_simulation`, `open_fea_viewer`).
- **Bidirectional Polyglot TGG Rules**: 6 Triple Graph Grammar (TGG) rules linking FEA sections, materials, boundary conditions, springs, and load cases with Modelica mechanics components and SysML v2 requirements/attributes.

---

## Package Structure

| Path                      | Description                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`            | Public package exports (`feaLanguage`, `materializeFeaDeck`, `synthesizeFeaBoundary`, `parseInpDeck`, `lintFeaModel`, dialects)        |
| `src/language.ts`         | Grammar definition, LSP actions (`open_fea_viewer`, `materialize_deck`, `run_simulation`), and 6 polyglot TGG rules                    |
| `src/materializer.ts`     | `evaluateFeaExpression`, `materializeFeaDeck`, `synthesizeFeaBoundary`, `applyBoundaryActionToDeck`, and `extractFeaSlicingProperties` |
| `src/types.ts`            | Core FEA model types (`FeaModelData`, `FeaNode`, `FeaElement`, `FeaMaterial`, `BoundaryActionPayload`, `FeaDialect`)                   |
| `src/errors.ts`           | `FeaErrorCode` diagnostic registry (`F1001`–`F1008` / `M7401`–`M7408`)                                                                 |
| `src/lints/fea-linter.ts` | `lintFeaModel` pre-flight structural diagnostic engine with Quick-Fix actions                                                          |
| `src/lsp.ts`              | LSP diagnostic validation, hover tooltips, and document symbol providers                                                               |
| `src/dialects/index.ts`   | Dialect registry (`registerFeaDialect`, `getFeaDialect`)                                                                               |
| `src/dialects/inp.ts`     | `InpDialect` parser and materializer for CalculiX / Abaqus `.inp` decks (`parseInpDeck`, `materializeCalculixDeck`)                    |
| `src/dialects/bdf.ts`     | `BdfDialect` parser and materializer for NASTRAN `.bdf` Bulk Data decks                                                                |

---

## Semantic / Pre-Flight Lint Rules (`FeaErrorCode`)

| Code (`stdCode` / `code`) | Rule                          | Severity  | Description                                                                                          |
| :------------------------ | :---------------------------- | :-------- | :--------------------------------------------------------------------------------------------------- |
| `F1001` (`7401`)          | `zero-elastic-modulus`        | `error`   | Material has non-positive Young's modulus ($E \le 0$).                                               |
| `F1002` (`7402`)          | `poisson-ratio-limit`         | `error`   | Poisson's ratio $\nu$ violates isotropic elastic stability bounds ($-1.0 < \nu < 0.5$).              |
| `F1003` (`7403`)          | `unconstrained-rigid-body`    | `warning` | Structural mesh has insufficient constrained boundary nodes; rigid-body motion may be unconstrained. |
| `F1004` (`7404`)          | `empty-mesh`                  | `error`   | FEA deck does not contain any defined finite elements (`*ELEMENT` / `CTETRA` / `CHEXA`).             |
| `F1005` (`7405`)          | `missing-material-definition` | `error`   | Element set lacks an assigned material specification or solid section.                               |
| `F1006` (`7406`)          | `degenerate-element-nodes`    | `error`   | Finite element contains duplicate or degenerate node connectivity references.                        |
| `F1007` (`7407`)          | `negative-yield-stress`       | `error`   | Plastic yield strength $\sigma_y$ for material must be strictly positive ($\sigma_y > 0$).           |
| `F1008` (`7408`)          | `negative-density`            | `warning` | Mass density $\rho$ for material must be strictly positive for dynamic or gravitational analysis.    |

---

## Polyglot Triple Graph Grammar (TGG) Rules

`@modelscript/fea` defines 6 bidirectional TGG rules in `feaLanguage.polyglot.rules`:

| Rule Name                       | Source (`fea`)                       | Target (`modelica` / `sysml2`)                                                                                              | Priority |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| `FeaStressMassToModelicaParam`  | `KeywordCard(name: "SOLID SECTION")` | `modelica`: `ComponentClause(name: "m", defaultValue: mass)`                                                                | 15       |
| `FeaStressMassToSysmlAttribute` | `KeywordCard(name: "SOLID SECTION")` | `sysml2`: `AttributeUsage(declaredName: "totalMass", defaultValue: mass)`                                                   | 15       |
| `FeaBoundaryFixToModelicaFixed` | `KeywordCard(name: "BOUNDARY")`      | `modelica`: `ComponentClause(name: "fixedBoundary", typeSpecifier: "Modelica.Mechanics.Translational.Components.Fixed")`    | 10       |
| `FeaSpringToModelicaSpring`     | `KeywordCard(name: "SPRING")`        | `modelica`: `ComponentClause(name: "springComponent", typeSpecifier: "Modelica.Mechanics.Translational.Components.Spring")` | 10       |
| `FeaMaterialToSysmlAttribute`   | `KeywordCard(name: "MATERIAL")`      | `sysml2`: `AttributeUsage(declaredName: "material", defaultValue: modulus)`                                                 | 5        |
| `FeaLoadCaseToSysmlRequirement` | `KeywordCard(name: "LOADCASE")`      | `sysml2`: `ConstraintUsage(declaredName: "loadCase")`                                                                       | 0        |

---

## Scripts

| Command             | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                         |
| `npm test`          | Run unit and dialect test suites via `test-runner.js` |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                 |
| `npm run typecheck` | Run `tsc --noEmit` type verification                  |
| `npm run clean`     | Remove `dist/` build artifacts                        |

---

## CLI Usage (`msx fea`)

```bash
# Inspect FEA mesh nodes, elements, materials, and boundary conditions
msx fea inspect cantilever.inp

# Run pre-flight structural lint checks (F1001–F1008)
msx fea lint cantilever.inp

# Solve 3D structural displacements, von Mises stress, and safety factor
msx fea solve cantilever.inp

# Project FEA structural deck to Modelica or DAE JSON
msx fea to-modelica cantilever.inp --out=CantileverBeam.mo
msx fea to-dae cantilever.inp --out=cantilever-dae.json
```

---

## Programmatic Usage

```typescript
import {
  applyBoundaryActionToDeck,
  extractFeaSlicingProperties,
  materializeFeaDeck,
  parseInpDeck,
} from "@modelscript/fea";

// 1. Materialize a parametric CalculiX template (.inpt -> .inp)
const template = `
*HEADING
Parametric Cantilever Beam
*NODE
1, 0.0, 0.0, 0.0
2, {{ beam_length }}, 0.0, 0.0
*MATERIAL, NAME=AL7075
*ELASTIC
{{ youngs_modulus }}, 0.33
*DENSITY
{{ density }}
*STEP
*STATIC
*END STEP
`;

const inpDeck = materializeFeaDeck(template, {
  evaluator: { beam_length: 0.25, youngs_modulus: 7.17e10, density: 2810.0 },
});

// 2. Synthesize & inject 3D boundary fixity and tip load cards before *END STEP
const withFix = applyBoundaryActionToDeck(inpDeck, { kind: "fix", targetId: 1, dofs: [1, 2, 3] }, "calculix");
const withLoad = applyBoundaryActionToDeck(withFix, { kind: "force", targetId: 2, vector: [0, 0, -500] }, "calculix");

// 3. Parse mesh topology and extract structural slicing properties
const model = parseInpDeck(withLoad);
const slicing = extractFeaSlicingProperties(withLoad);
console.log(model.nodes.size, slicing.safetyFactor, slicing.isSafe);
```
