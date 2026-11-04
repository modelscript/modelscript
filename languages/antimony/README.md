<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/antimony

Antimony modular reaction network, systems biology, and biochemical pathway definition language package (`.ant`) for ModelScript. Features a zero-regex character-by-character lexer and recursive-descent parser (`parseAntimony`, `serializeAntimony`), multi-file workspace indexing (`AntimonyWorkspaceIndex`), a deterministic RK4 ODE, rate-rule, assignment-rule, submodel, and discrete event solver with zero-eval formula compilation (`solveAntimony`), direct linear-memory `DAEBuilder` stoichiometric lowering (`lowerAntimonyToDae`), 10 pre-flight biochemical & modular pathway lint rules (`M9001`–`M9010`), Modelica 3.x (`antimonyToModelica`) and SBML Level 3 XML (`antimonyToSbmlXml`) projections, and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex Antimony Parser & Serializer (`parseAntimony`, `serializeAntimony`)**: Character-by-character scanner and recursive-descent parser supporting:
  - **Modular Blocks & Submodels**: `model ... end`, `function ... end`, and hierarchical submodel instantiation (`M1: SubModel(x, y);`).
  - **Declarations & Boundary Species**: `compartment`, `species S in C`, `$S` boundary species, `const`, `var`, `formula`, `unit`, `delete`, and `is "Display Name"` ontology aliases.
  - **Stoichiometric Reactions**: Reversible (`->`, `<->`) and irreversible (`=>`) reactions (`J1: 2 A + B -> C; k1*A^2*B;`), source/sink reactions, and compartment-scoped reactions.
  - **Rules & State-Triggered Events**: Rate rules (`x' = ...`), assignment rules (`x := ...`), initial value assignments (`x = 10`), and discrete event triggers (`E1: at (S1 > 0.5): S2 = 0;`).
- **Deterministic RK4 Pathway & Event Solver (`solveAntimony`)**: Flattens submodel hierarchies, compiles mathematical and logical expressions via a safe zero-eval recursive-descent compiler, and integrates coupled stoichiometric reaction fluxes, rate rules, algebraic assignment rules, and discrete `at (...)` event triggers.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerAntimonyToDae`)**: Compiles compartment volumes, parameters, reaction velocity flux equations ($v_r$), rate/assignment rules, and species molar balance ODEs ($\frac{dS_i}{dt} = \frac{1}{V_{\text{comp}}} \sum N_{ir} v_r$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Pathway & Stoichiometric Lint Rules (`M9001`–`M9010`, `lintAntimony`)**: Static verification of empty modules, undeclared species compartments, missing reaction rate laws, non-positive stoichiometric coefficients, undeclared rate law symbols, duplicate reaction IDs, circular submodel instantiations, conflicting `const` species variability, non-positive compartment volumes, and invalid non-relational event triggers.
- **Modelica 3.x & SBML Level 3 Projections (`antimonyToModelica`, `antimonyToSbmlXml`)**: Synthesizes standalone Modelica 3.x biochemical pathway models and standard SBML Level 3 Version 2 Core XML documents.
- **Multi-File Workspace Indexing & LSP (`AntimonyWorkspaceIndex`, `getAntimonyHover`, `provideAntimonyCompletions`)**: Implements `IWorkspaceIndex` across `.ant` files with species/reaction/compartment hover inspection, keyword/symbol completions, document outlines, and AST writeback.

---

## Package Structure

| Path                                      | Description                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Public package exports                                                                                               |
| `src/language.ts`                         | `antimonyLanguage` definition and LSP actions (`lint_antimony`, `antimony_simulate`, `antimony_to_dae`, projections) |
| `src/types.ts`                            | `AntimonyDocument`, `AntimonyModule`, `AntimonyCompartment`, `AntimonySpecies`, `AntimonyReaction`, `AntimonyEvent`  |
| `src/errors.ts`                           | `AntimonyErrorCode` diagnostic registry (`M9001`–`M9010`)                                                            |
| `src/parser/antimony-parser.ts`           | `parseAntimony` and `serializeAntimony` zero-regex character lexer and recursive-descent parser                      |
| `src/parser/index.ts`                     | Parser barrel exports                                                                                                |
| `src/lints/antimony-linter.ts`            | `lintAntimony` module, compartment, stoichiometry, rate law, submodel cycle, and event trigger diagnostic engine     |
| `src/lints/index.ts`                      | Linter barrel exports                                                                                                |
| `src/solvers/antimony-solver.ts`          | `solveAntimony` RK4 ODE, rate rule, assignment rule, submodel flattening, and event solver                           |
| `src/solvers/index.ts`                    | Solver barrel exports                                                                                                |
| `src/dae/antimony-to-dae.ts`              | `lowerAntimonyToDae` direct lowering of stoichiometric matrices, fluxes, and rules into `DAEBuilder` linear memory   |
| `src/dae/index.ts`                        | DAE lowering barrel exports                                                                                          |
| `src/projections/antimony-projections.ts` | `antimonyToModelica` and `antimonyToSbmlXml` translators to Modelica 3.x and SBML Level 3 XML                        |
| `src/projections/index.ts`                | Projections barrel exports                                                                                           |
| `src/workspace-index.ts`                  | `AntimonyWorkspaceIndex` implementing `IWorkspaceIndex` across `.ant` files                                          |
| `src/lsp.ts`                              | LSP validation, document symbol outline, hover, completion, and action handlers                                      |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                  | Severity  | Description                                                                                            |
| ------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `M9001` | `empty-antimony-module`               | `error`   | Antimony module `'moduleName'` contains no species, reactions, or rules.                               |
| `M9002` | `undefined-compartment-in-species`    | `error`   | Species `'speciesId'` is placed in undeclared compartment `'compartmentId'`.                           |
| `M9003` | `missing-reaction-rate-law`           | `warning` | Reaction `'reactionId'` has no kinetic rate expression.                                                |
| `M9004` | `negative-stoichiometric-coefficient` | `error`   | Species `'speciesId'` in reaction `'reactionId'` has non-positive stoichiometry.                       |
| `M9005` | `undefined-rate-law-symbol`           | `warning` | Rate expression in `'reactionId'` references undeclared identifier `'symbol'`.                         |
| `M9006` | `duplicate-reaction-id`               | `error`   | Reaction identifier `'reactionId'` is defined multiple times in module `'moduleName'`.                 |
| `M9007` | `circular-submodel-instantiation`     | `error`   | Submodel hierarchy contains a cycle involving `'moduleName'`.                                          |
| `M9008` | `conflicting-species-variability`     | `error`   | Species `'speciesId'` is declared both `'const'` and modified by a rate rule or non-boundary reaction. |
| `M9009` | `negative-compartment-volume`         | `error`   | Compartment `'compartmentId'` initialized with non-positive volume ($\le 0$).                          |
| `M9010` | `invalid-event-trigger`               | `error`   | Event `'eventId'` trigger condition is not a relational/boolean expression.                            |

---

## Programmatic Usage

```typescript
import {
  antimonyToModelica,
  antimonyToSbmlXml,
  lintAntimony,
  lowerAntimonyToDae,
  parseAntimony,
  solveAntimony,
} from "@modelscript/antimony";

const antSource = `
model GlycolyticStep()
  compartment cytosol = 1.0;
  species Glucose in cytosol = 10.0, Pyruvate in cytosol = 0.0;
  const k1 = 0.35;

  J1: Glucose => 2 Pyruvate; k1 * Glucose;
  TotalCarbon := Glucose + 0.5 * Pyruvate;
  E1: at (Glucose < 2.0): Glucose = Glucose + 5.0;
end
`;

// 1. Parse Antimony document and run M9001-M9010 pre-flight diagnostics
const doc = parseAntimony(antSource, "glycolysis.ant");
const diagnostics = lintAntimony(doc);

// 2. Simulate reaction kinetics, assignment rules, and discrete events via RK4
const simResult = solveAntimony(doc, { duration: 10.0, timeStep: 0.02 });
console.log(simResult.finalConcentrations.Glucose, simResult.finalConcentrations.Pyruvate);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x & SBML Level 3 XML
const dae = lowerAntimonyToDae(doc);
const modelicaCode = antimonyToModelica(doc);
const sbmlXml = antimonyToSbmlXml(doc);
```

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run Antimony parser, serializer, linter, RK4 solver, DAE, projection, and LSP tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |
