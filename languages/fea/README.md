<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/fea

Finite Element Analysis (FEA) solver deck DSL supporting CalculiX/Abaqus (`.inp`, `.inpt`), NASTRAN Bulk Data (`.bdf`), and `.fea` files, with a WebAssembly GLR parser, `{{ expr }}` parametric deck materializer, 3D CAD boundary/load card synthesizer, structural theory slicer, and 3D Tet4/Tet10 FEA solver integration.

---

## Core Capabilities

- **Multi-Dialect FEA Solver Deck DSL (`.fea`, `.inp`, `.inpt`, `.bdf`)**: Declarative grammar (`feaLanguage`) and dialect parsers supporting CalculiX / Abaqus keyword cards (`*NODE`, `*ELEMENT`, `*NSET`, `*ELSET`, `*MATERIAL`, `*ELASTIC`, `*DENSITY`, `*SOLID SECTION`, `*BOUNDARY`, `*CLOAD`, `*DLOAD`, `*STEP`) via `InpDialect` and NASTRAN Bulk Data cards (`GRID`, `CTETRA`, `CHEXA`, `PSOLID`, `MAT1`, `SPC1`, `FORCE`, `MOMENT`, `ENDDATA`) via `BdfDialect`.
- **WASM GLR Incremental Parser**: Built on `@modelscript/dsl` (`language()`), indexing `FeaDeck`, `KeywordCard`, and `EmbeddedExpression` symbols with Salsa query hooks (`instantiate`, `resolveSimpleName`).
- **`{{ expr }}` Parametric Deck Materializer (`materializeFeaDeck`)**: Evaluates embedded expressions (`{{ ... }}`) inside `.inpt` parametric templates against a safe mathematical function library (`sin`, `cos`, `sind`, `cosd`, `sqrt`, `cbrt`, `pow`, `PI`, etc.) and external parameter tables (`evaluateFeaExpression`, `materializeCalculixDeck`), reporting precise 1-indexed line and column diagnostics on unresolved parameters.
- **3D Face Boundary & Load Card Synthesizer (`synthesizeFeaBoundary`)**: Translates interactive 3D CAD face/node selections (`BoundaryActionPayload` for `fix`, `displacement`, `force`, `moment`, and `pressure`) into CalculiX/Abaqus (`*BOUNDARY`, `*CLOAD`, `*DLOAD`) or NASTRAN (`SPC1`, `FORCE`, `MOMENT`) cards, and injects them before `*END STEP` or `ENDDATA` via `applyBoundaryActionToDeck`.
- **Structural Theory Slicing (`extractFeaSlicingProperties`)**: Extracts reduced-order structural bounding scalars—total mass ($m$), maximum von Mises stress ($\sigma_{\text{max}}$), material yield strength ($\sigma_y$), safety factor ($\text{SF} = \sigma_y / \sigma_{\text{max}}$), and safety predicate (`isSafe`)—for continuous 1D DAE co-simulation and formal contract verification.
- **Built-in 3D Tet4/Tet10 FEA Solver Integration**: Parses 3D tetrahedral (`C3D4`, `C3D10`, `CTETRA`) and hexahedral (`C3D8`, `C3D8R`, `CHEXA`) meshes, node sets, isotropic material properties ($E, \nu, \rho$), Dirichlet boundary fixities, and concentrated nodal loads into `FeaModelData` for direct execution on `@modelscript/simulate`'s 3D finite element structural solver (`run_simulation`, `open_fea_viewer`).
- **Bidirectional Polyglot TGG Rules**: 6 Triple Graph Grammar (TGG) rules linking FEA sections, materials, boundary conditions, springs, and load cases with Modelica mechanics components and SysML v2 requirements/attributes.

---

## Package Structure

| Path                    | Description                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | Public package exports (`feaLanguage`, `materializeFeaDeck`, `synthesizeFeaBoundary`, `parseInpDeck`, dialects)                        |
| `src/language.ts`       | Grammar definition, LSP actions (`open_fea_viewer`, `materialize_deck`, `run_simulation`), and 6 polyglot TGG rules                    |
| `src/materializer.ts`   | `evaluateFeaExpression`, `materializeFeaDeck`, `synthesizeFeaBoundary`, `applyBoundaryActionToDeck`, and `extractFeaSlicingProperties` |
| `src/types.ts`          | Core FEA model types (`FeaModelData`, `FeaNode`, `FeaElement`, `FeaMaterial`, `BoundaryActionPayload`, `FeaDialect`)                   |
| `src/dialects/index.ts` | Dialect registry (`registerFeaDialect`, `getFeaDialect`)                                                                               |
| `src/dialects/inp.ts`   | `InpDialect` parser and materializer for CalculiX / Abaqus `.inp` decks (`parseInpDeck`, `materializeCalculixDeck`)                    |
| `src/dialects/bdf.ts`   | `BdfDialect` parser and materializer for NASTRAN `.bdf` Bulk Data decks                                                                |

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
