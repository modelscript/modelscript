<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/bngl

BioNetGen rule-based biochemical and cell-signaling modeling language package (`.bngl`) for ModelScript. Features a zero-regex character-by-character parser and serializer (`parseBngl`, `serializeBngl`), multi-file workspace indexing (`BnglWorkspaceIndex`), automated rule-based network expansion via graph canonicalization and subgraph isomorphism (`generateBnglNetwork`), a deterministic RK4 ODE and observable trajectory solver (`solveBngl`), direct linear-memory `DAEBuilder` stoichiometric lowering (`lowerBnglToDae`), 10 pre-flight rule-based biochemical lint rules (`M9051`–`M9060`), Modelica 3.x (`bnglToModelica`) and SBML Level 3 XML (`bnglToSbmlXml`) projections, and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex BioNetGen Parser & Serializer (`parseBngl`, `serializeBngl`)**: Character-by-character lexer and parser supporting:
  - **Model Sections**: `begin model ... end model`, `parameters`, `compartments`, `molecule types`, `seed species`, `observables`, `functions`, and `reaction rules`.
  - **Structured Molecule Graphs**: Multi-site molecule definitions (`R(l,Y~U~P)`), complex patterns with site-specific bond labels (`L(r!1).R(l!1,Y~U)`), wildcards (`!+`, `!?`, `~?`), and compartment annotations (`@EC:L(r)`).
  - **Reaction Rules & Actions**: Reversible (`<->`) and irreversible (`->`) rules with forward/reverse rate expressions, synthesis/degradation (`0`), and simulation commands (`generate_network({...})`, `simulate({method=>"ode",t_end=>100,n_steps=>100})`).
- **Automated Rule-Based Network Generation (`generateBnglNetwork`)**: Iteratively expands seed species across pattern-based reaction rules using complex graph canonicalization, subgraph isomorphism matching, bond formation/cleavage, connected-component decomposition, and `Molecules` / `Species` observable weighting.
- **Deterministic RK4 ODE & Observable Solver (`solveBngl`)**: Integrates the expanded mass-action biochemical network and computes time-series trajectories for both concrete chemical species and rule-based observables.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerBnglToDae`)**: Compiles compartments, parameters, concrete expanded species, algebraic observable group equations, reaction fluxes, and molar balance ODEs directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena.
- **10 Pre-Flight Rule-Based Lint Rules (`M9051`–`M9060`, `lintBngl`)**: Static verification of undeclared molecule types, undeclared component sites, invalid internal phosphorylation/conformational states, dangling bond labels (`!1` appearing $\ne 2$ times), undefined rate parameters, reversible rules missing reverse rate constants, negative seed concentrations, empty models, duplicate observable names, and unbounded polymerization rules.
- **Modelica 3.x & SBML Level 3 Projections (`bnglToModelica`, `bnglToSbmlXml`)**: Synthesizes standalone Modelica 3.x biochemical pathway models and standard SBML Level 3 Version 2 Core XML documents from expanded rule networks.
- **Multi-File Workspace Indexing & LSP (`BnglWorkspaceIndex`, `getBnglHover`, `provideBnglCompletions`)**: Implements `IWorkspaceIndex` across `.bngl` files with molecule/observable/rule hover inspection, completions, document outlines, and AST writeback.

---

## Package Structure

| Path                                  | Description                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                        | Public package exports                                                                                             |
| `src/language.ts`                     | `bnglLanguage` definition and LSP actions (`lint_bngl`, `bngl_generate_network`, `bngl_simulate`, `bngl_to_dae`)   |
| `src/types.ts`                        | `BnglDocument`, `BnglModel`, `BnglMoleculeType`, `BnglComplexPattern`, `BnglSeedSpecies`, `BnglReactionRule`, etc. |
| `src/errors.ts`                       | `BnglErrorCode` diagnostic registry (`M9051`–`M9060`)                                                              |
| `src/parser/bngl-parser.ts`           | `parseBngl`, `serializeBngl`, and `parseComplexPattern` zero-regex character parser                                |
| `src/parser/index.ts`                 | Parser barrel exports                                                                                              |
| `src/lints/bngl-linter.ts`            | `lintBngl` molecule, component site, internal state, bond topology, rate parameter, and polymerization linter      |
| `src/lints/index.ts`                  | Linter barrel exports                                                                                              |
| `src/solvers/bngl-solver.ts`          | `generateBnglNetwork` rule-based network expander and `solveBngl` RK4 ODE & observable trajectory solver           |
| `src/solvers/index.ts`                | Solver barrel exports                                                                                              |
| `src/dae/bngl-to-dae.ts`              | `lowerBnglToDae` direct lowering of expanded species, observables, and fluxes into `DAEBuilder` linear memory      |
| `src/dae/index.ts`                    | DAE lowering barrel exports                                                                                        |
| `src/projections/bngl-projections.ts` | `bnglToModelica` and `bnglToSbmlXml` translators to Modelica 3.x and SBML Level 3 XML                              |
| `src/projections/index.ts`            | Projections barrel exports                                                                                         |
| `src/workspace-index.ts`              | `BnglWorkspaceIndex` implementing `IWorkspaceIndex` across `.bngl` files                                           |
| `src/lsp.ts`                          | LSP validation, document symbol outline, hover, completion, and action handlers                                    |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                   | Severity  | Description                                                                                                            |
| ------- | -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `M9051` | `molecule-type-undeclared`             | `error`   | Molecule type `'moleculeName'` is not declared in `'molecule types'`.                                                  |
| `M9052` | `component-site-undeclared`            | `error`   | Component site `'siteName'` is not declared on molecule type `'moleculeName'`.                                         |
| `M9053` | `invalid-internal-state`               | `error`   | Internal state `'~stateName'` is not allowed for component `'siteName'` of molecule type `'moleculeName'`.             |
| `M9054` | `dangling-bond-label`                  | `error`   | Bond label `'!bondLabel'` in complex pattern `'patternText'` appears $\ne 2$ times; each bond must connect 2 sites.    |
| `M9055` | `undefined-rate-parameter`             | `warning` | Reaction rule `'ruleId'` references undeclared rate parameter `'parameterName'`.                                       |
| `M9056` | `reversible-rule-missing-reverse-rate` | `error`   | Reversible reaction rule `'ruleId'` (`'<->'`) is missing a reverse rate constant.                                      |
| `M9057` | `negative-seed-concentration`          | `error`   | Seed species `'speciesPattern'` has negative initial concentration.                                                    |
| `M9058` | `empty-bionetgen-model`                | `error`   | BioNetGen model `'modelName'` contains no molecule types, seed species, or reaction rules.                             |
| `M9059` | `duplicate-observable-name`            | `error`   | Observable `'observableName'` is defined multiple times in `'observables'`.                                            |
| `M9060` | `unbounded-polymerization-rule`        | `warning` | Reaction rule `'ruleId'` forms intermolecular bonds on multi-site molecule `'moleculeName'` with unbounded elongation. |

---

## Programmatic Usage

```typescript
import {
  bnglToModelica,
  bnglToSbmlXml,
  generateBnglNetwork,
  lintBngl,
  lowerBnglToDae,
  parseBngl,
  solveBngl,
} from "@modelscript/bngl";

const bnglSource = `
begin model
begin parameters
  L0 100
  R0 200
  kp1 0.001
  km1 0.1
  k_phos 0.5
  k_dephos 0.05
end parameters

begin molecule types
  L(r)
  R(l,Y~U~P)
end molecule types

begin seed species
  L(r) L0
  R(l,Y~U) R0
end seed species

begin observables
  Molecules BoundR L(r!1).R(l!1)
  Molecules PhosphoR R(Y~P)
  Molecules TotalR R()
end observables

begin reaction rules
  Bind: L(r) + R(l) <-> L(r!1).R(l!1) kp1, km1
  Phos: L(r!1).R(l!1,Y~U) -> L(r!1).R(l!1,Y~P) k_phos
  Dephos: R(Y~P) -> R(Y~U) k_dephos
end reaction rules
end model

generate_network({overwrite=>1})
simulate({method=>"ode",t_end=>20,n_steps=>200})
`;

// 1. Parse BNGL document and run M9051-M9060 pre-flight diagnostics
const doc = parseBngl(bnglSource, "receptor.bngl");
const diagnostics = lintBngl(doc);

// 2. Expand rule-based reaction network and integrate ODE + observable trajectories via RK4
const network = generateBnglNetwork(doc);
const simResult = solveBngl(doc, { duration: 20.0, timeStep: 0.05 });
console.log(simResult.finalObservables.BoundR, simResult.finalObservables.PhosphoR);

// 3. Lower to DAEBuilder linear memory or export to Modelica 3.x & SBML Level 3 XML
const dae = lowerBnglToDae(doc);
const modelicaCode = bnglToModelica(doc);
const sbmlXml = bnglToSbmlXml(doc);
```

---

## Scripts

| Command             | Description                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                               |
| `npm test`          | Run BioNetGen parser, serializer, linter, network expansion, RK4 solver, DAE, and LSP tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                       |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                        |
| `npm run clean`     | Remove `dist/` build artifacts                                                              |
