<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cellml

CellML 1.0 / 1.1 / 2.0 cardiac electrophysiology, ion channel gating, and multi-compartment cellular modeling language package (`.cellml`, `.xml`) for ModelScript. Features a zero-regex CellML XML & Content MathML parser with SI dimensional analysis (`parseCellml`), multi-file workspace indexing (`CellmlWorkspaceIndex`), an RK4 & Rush-Larsen gating ODE solver (`solveCellml`), direct linear-memory `DAEBuilder` lowering (`lowerCellmlToDae`), 10 biophysical & structural verification lint rules (`M9301`–`M9310`, `lintCellmlDocument`, `CellmlErrorCode`), Modelica 3.x and SBML Level 3 projections (`cellmlToModelica`, `cellmlToSbml`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **CellML 1.0 / 1.1 / 2.0 & Content MathML Parser (`parseCellml`)**:
  - **`<units>` & `<unit>` Dimensional Reduction**: Computes 7-dimensional SI base unit exponent vectors (`ampere`, `kelvin`, `kilogram`, `metre`, `mole`, `second`, `candela`, `multiplierScale`) across SI prefixes (`milli`, `micro`, `nano`, `pico`, `kilo`, etc.) and exponents.
  - **`<component>`, `<variable>`, & Content MathML `<math>`**: Extracts public/private interfaces (`in`, `out`, `none`), initial values, ODEs (`<apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>`), algebraic equations, and `<piecewise>` expressions.
  - **`<connection>` & `<encapsulation>`**: Resolves `<map_components>`, `<map_variables>`, and `<group>` / `<encapsulation>` `<component_ref>` hierarchies.
- **RK4 & Rush-Larsen Electrophysiology Solver (`solveCellml`)**: Resolves cross-component variable connections, topologically sorts algebraic equations across components, and integrates membrane action potentials and Hodgkin-Huxley ion channel gating variables ($m, h, n$) via 4th-order Runge-Kutta (RK4) and Rush-Larsen exponential integration.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerCellmlToDae`)**: Lowers component variables, connection alias equations, algebraic equations, and state ODEs directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena.
- **10 Biophysical & Structural Lint Rules (`M9301`–`M9310`, `lintCellmlDocument`)**: Static verification of model identifiers, SI unit resolution, interface direction compatibility, dimensional homogeneity across connected variables, ODE state initialization, encapsulation hierarchy acyclicity, connection member resolution, overconstrained variables, Content MathML `<ci>` scope checks, and duplicate declarations.
- **Modelica 3.x & SBML Level 3 Projections (`cellmlToModelica`, `cellmlToSbml`)**: Projects CellML multi-compartment models to Modelica 3.x physical models and SBML Level 3 Version 2 XML.
- **Multi-File Workspace Indexing & LSP (`CellmlWorkspaceIndex`, `validateCellml`, `getCellmlHover`, `getCellmlCompletions`, `getCellmlDefinition`)**: Full `IWorkspaceIndex` implementation with SI dimension vector hover cards and symbol navigation.

---

## Package Structure

| Path                       | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                              |
| `src/language.ts`          | `cellmlLanguage` definition, LSP actions, and MCP tool (`cellml_simulate`)                          |
| `src/types.ts`             | `CellmlDocument`, `CellmlComponent`, `CellmlVariable`, `CellmlUnits`, `CellmlDimensionVector` types |
| `src/parser/index.ts`      | `parseCellml` XML, Content MathML, and SI dimensional analysis parser                               |
| `src/lints/rules.ts`       | `CellmlErrorCode` and `lintCellmlDocument` (`M9301`–`M9310`)                                        |
| `src/lints/index.ts`       | Linter barrel exports                                                                               |
| `src/solvers/index.ts`     | `solveCellml` topological algebraic evaluator and RK4 / Rush-Larsen ODE integrator                  |
| `src/dae/index.ts`         | `lowerCellmlToDae` direct lowering into `DAEBuilder` linear memory                                  |
| `src/projections/index.ts` | `cellmlToModelica` and `cellmlToSbml` cross-language translators                                    |
| `src/workspace-index.ts`   | `CellmlWorkspaceIndex` implementing `IWorkspaceIndex` across `.cellml` and `.xml` files             |
| `src/lsp.ts`               | LSP validation, document symbols, SI dimensional hover, completion, and definition providers        |

---

## Pre-Flight Semantic Lint Rules (`M9301`–`M9310`)

| Code    | Rule                                     | Severity  | Description                                                                                                                |
| ------- | ---------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `M9301` | `cellml-missing-model-name`              | `error`   | `<model>` element is missing a non-empty `name` attribute.                                                                 |
| `M9302` | `cellml-unresolved-units`                | `error`   | Variable or `<unit>` references `<units>` not in built-in SI/CellML standard units or declared `<units>`.                  |
| `M9303` | `cellml-interface-direction-conflict`    | `error`   | `<map_variables>` connects incompatible interfaces (both `in`, both `out`, or `none`).                                     |
| `M9304` | `cellml-unit-dimensional-mismatch`       | `warning` | Connected variables in `<map_variables>` have incompatible physical SI base unit exponents (`CellmlDimensionVector`).      |
| `M9305` | `cellml-uninitialized-state-variable`    | `warning` | Differential state variable (`isOde: true`) has no `initial_value`.                                                        |
| `M9306` | `cellml-encapsulation-hierarchy-cycle`   | `error`   | Circular component reference in `<encapsulation>` hierarchy.                                                               |
| `M9307` | `cellml-unresolved-connection-member`    | `error`   | `<connection>` references unknown component or variable name.                                                              |
| `M9308` | `cellml-overconstrained-variable`        | `error`   | Variable with `public_interface="in"` or `private_interface="in"` is also assigned by an equation or ODE in the component. |
| `M9309` | `cellml-undefined-math-ci`               | `error`   | Equation references an identifier `<ci>` not declared as a `<variable>` in that `<component>`.                             |
| `M9310` | `cellml-duplicate-variable-or-component` | `error`   | Duplicate `<component>` or `<variable>` name in the source XML.                                                            |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx cellml`)

```bash
# Lint a CellML 1.0/1.1/2.0 model (M9301-M9310)
npx msx cellml lint hodgkin_huxley_1952.cellml

# Simulate cardiac action potential & gating kinetics (RK4 + Rush-Larsen)
npx msx cellml simulate hodgkin_huxley_1952.cellml --duration 50 --dt 0.01

# Lower to DAE or project to Modelica 3.x (.mo) and SBML Level 3 (.sbml)
npx msx cellml to-dae hodgkin_huxley_1952.cellml
npx msx cellml to-modelica hodgkin_huxley_1952.cellml
npx msx cellml to-sbml hodgkin_huxley_1952.cellml
```

### Programmatic API

```typescript
import {
  cellmlToModelica,
  cellmlToSbml,
  lintCellmlDocument,
  lowerCellmlToDae,
  parseCellml,
  solveCellml,
} from "@modelscript/cellml";

// 1. Parse CellML XML + Content MathML and run SI dimensional/structural lints (M9301-M9310)
const doc = parseCellml(cellmlXml, "hodgkin_huxley_1952.cellml");
const diagnostics = lintCellmlDocument(doc);

// 2. Solve electrophysiology ODEs via RK4 and Rush-Larsen gating integration
const sim = solveCellml(doc, { duration: 50.0, dt: 0.01 });
console.log("Final state values:", sim.finalStates);

// 3. Lower to WebAssembly DAEBuilder or project to Modelica 3.x and SBML Level 3
const dae = lowerCellmlToDae(doc);
const modelicaCode = cellmlToModelica(doc);
const sbmlXml = cellmlToSbml(doc);
```

---

## Scripts

| Command             | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`                                                              |
| `npm test`          | Run CellML parser, linter, RK4/Rush-Larsen solver, DAE, projection, and LSP workspace test |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                      |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                       |
| `npm run clean`     | Remove `dist/` build artifacts                                                             |

---

## License

`AGPL-3.0-or-later`
