<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sbml

Systems Biology Markup Language (SBML Level 2/3) biochemical reaction network, enzyme kinetics, and metabolic pathway modeling package (`.sbml`, `.xml`) for ModelScript. Features a zero-regex SBML XML & Content MathML parser (`parseSbml`), multi-file workspace indexing (`SbmlWorkspaceIndex`), a deterministic RK4 chemical reaction kinetics ODE solver with zero-eval formula compilation (`solveReactions`), direct linear-memory `DAEBuilder` stoichiometric lowering (`lowerSbmlToDae`), 10 pre-flight biochemical & stoichiometric lint rules (`M8801`–`M8810`), Modelica 3.x biochemical reaction projections (`sbmlToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **SBML Level 2/3 & Content MathML Parser (`parseSbml`)**: Zero-regex XML parser extracting `<sbml>` `level`/`version` attributes and `<model>` hierarchies:
  - **`<listOfCompartments>` & `<listOfSpecies>`**: Cellular compartments (`size`, `spatialDimensions`, `constant`) and chemical species (`compartment`, `initialConcentration`, `initialAmount`, `boundaryCondition`, `constant`).
  - **`<listOfParameters>` & `<listOfReactions>`**: Global and local `<kineticLaw>` parameters, `<listOfReactants>`, `<listOfProducts>`, `<listOfModifiers>` (`speciesReference` with `stoichiometry`), and `<math>` Content MathML (`<apply>`, `<plus/>`, `<minus/>`, `<times/>`, `<divide/>`, `<power/>`, `<ci>`, `<cn>`) or `formula` infix rate laws.
- **Deterministic RK4 Biochemical Reaction Kinetics Solver (`solveReactions`)**: Compiles `<kineticLaw>` formulas via a safe, zero-eval recursive-descent mathematical expression compiler and integrates the stoichiometric rate equations $\frac{d[\text{S}_i]}{dt} = \frac{1}{V_{\text{comp}}} \sum_{j} N_{ij} v_j(\mathbf{S}, \mathbf{k})$ using 4th-order Runge-Kutta (RK4) integration across mass-action, Michaelis-Menten, and Hill cooperativity pathways.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSbmlToDae`)**: Compiles compartment volumes, global/local kinetic parameters, reaction velocity flux equations ($v_r$), and species molar balance ODEs ($\frac{dS_i}{dt} = \sum \nu_{\text{prod}} v_r - \sum \nu_{\text{react}} v_r$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Biochemical & Stoichiometric Lint Rules (`M8801`–`M8810`, `lintSbml`)**: Static verification of `<model>` identifiers, species compartment references, reactant/product/modifier species references, compartment volume positivity, non-negative initial concentrations/amounts, empty reactions, missing `<kineticLaw>` rate equations, positive stoichiometric coefficients, undefined kinetic formula identifiers, and redundant reactant/product modifier species.
- **Modelica 3.x Biochemical Pathway Projection (`sbmlToModelica`)**: Synthesizes standalone Modelica 3.x biochemical reaction kinetics models for coupled pharmacokinetic/pharmacodynamic (PK/PD) and physiological co-simulation.
- **Multi-File Workspace Indexing & LSP (`SbmlWorkspaceIndex`, `provideSbmlHover`, `provideSbmlCompletions`)**: Implements `IWorkspaceIndex` across `.sbml` and `.xml` models with species/reaction hover inspection, tag completions, and AST writeback.

---

## Package Structure

| Path                                  | Description                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                                                          |
| `src/language.ts`                     | `sbmlLanguage` definition and LSP actions (`lint_sbml`, `sbml_simulate`, `sbml_to_dae`, `sbml_to_modelica`)     |
| `src/types.ts`                        | `SbmlDocument`, `SbmlModel`, `SbmlCompartment`, `SbmlSpecies`, `SbmlParameter`, `SbmlReaction`, and range types |
| `src/errors.ts`                       | `SbmlErrorCode` diagnostic registry (`M8801`–`M8810`)                                                           |
| `src/parser/sbml-parser.ts`           | `parseSbml` zero-regex SBML XML and Content MathML parser                                                       |
| `src/parser/index.ts`                 | Parser barrel exports                                                                                           |
| `src/lints/sbml-linter.ts`            | `lintSbml` compartment, species, stoichiometry, and kinetic law diagnostic engine                               |
| `src/lints/index.ts`                  | Linter barrel exports                                                                                           |
| `src/solvers/reaction-solver.ts`      | `solveReactions` RK4 biochemical reaction network ODE integrator with zero-eval expression compiler             |
| `src/solvers/index.ts`                | Solver barrel exports                                                                                           |
| `src/dae/sbml-to-dae.ts`              | `lowerSbmlToDae` direct lowering of stoichiometric matrices and reaction fluxes into `DAEBuilder` linear memory |
| `src/dae/index.ts`                    | DAE lowering barrel exports                                                                                     |
| `src/projections/sbml-to-modelica.ts` | `sbmlToModelica` translator to Modelica 3.x biochemical reaction models                                         |
| `src/projections/index.ts`            | Projections barrel exports                                                                                      |
| `src/workspace-index.ts`              | `SbmlWorkspaceIndex` implementing `IWorkspaceIndex` across `.sbml` and `.xml` files                             |
| `src/lsp.ts`                          | LSP hover, completion, and symbol providers                                                                     |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                    | Severity  | Description                                                                                                                                   |
| ------- | --------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `M8801` | `missing-model-id`                      | `error`   | SBML `<model>` element is missing the required `'id'` attribute.                                                                              |
| `M8802` | `undefined-compartment-reference`       | `error`   | Species `'speciesId'` references undefined compartment `'compartmentId'`.                                                                     |
| `M8803` | `undefined-species-reference`           | `error`   | Reaction `'reactionId'` references undefined reactant, product, or modifier species `'speciesId'`.                                            |
| `M8804` | `negative-compartment-size`             | `error`   | Compartment `'compartmentId'` defines a non-positive size ($\le 0$).                                                                          |
| `M8805` | `negative-initial-amount-concentration` | `error`   | Species `'speciesId'` specifies a negative initial amount or concentration ($< 0$).                                                           |
| `M8806` | `empty-reaction`                        | `error`   | Reaction `'reactionId'` must define at least one reactant or product.                                                                         |
| `M8807` | `missing-kinetic-law`                   | `warning` | Reaction `'reactionId'` does not define a `<kineticLaw>` rate equation.                                                                       |
| `M8808` | `negative-stoichiometry`                | `error`   | Species reference for `'speciesId'` in reaction `'reactionId'` specifies non-positive stoichiometry ($\le 0$).                                |
| `M8809` | `undefined-kinetic-parameter`           | `warning` | Kinetic law formula in reaction `'reactionId'` references identifier `'id'` not found in parameters, species, or compartments.                |
| `M8810` | `circular-species-assignment`           | `info`    | Reaction `'reactionId'` lists `'speciesId'` as both reactant and product with identical stoichiometry; consider `<modifierSpeciesReference>`. |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect compartments, species, parameters, and reactions in an SBML model
npx msx sbml inspect enzyme_kinetics.sbml

# Run pre-flight compartment, species, stoichiometry, and kinetic law checks (M8801-M8810)
npx msx sbml lint enzyme_kinetics.sbml

# Simulate biochemical reaction network ODEs using 4th-order Runge-Kutta
npx msx sbml simulate enzyme_kinetics.sbml --duration 10.0

# Lower species stoichiometry and reaction fluxes to DAEBuilder linear memory
npx msx sbml to-dae enzyme_kinetics.sbml

# Project SBML reaction network to a Modelica 3.x biochemical model
npx msx sbml to-modelica enzyme_kinetics.sbml -o EnzymeKinetics.mo
```

### Programmatic Usage

```typescript
import { lintSbml, lowerSbmlToDae, parseSbml, sbmlToModelica, solveReactions } from "@modelscript/sbml";

const sbmlXml = `
<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="MichaelisMenten" name="Michaelis-Menten Enzyme Kinetics">
    <listOfCompartments>
      <compartment id="cell" size="1.0" spatialDimensions="3" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="S" compartment="cell" initialConcentration="10.0"/>
      <species id="P" compartment="cell" initialConcentration="0.0"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="Vmax" value="2.5"/>
      <parameter id="Km" value="1.5"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="v_cat" reversible="false">
        <listOfReactants><speciesReference species="S" stoichiometry="1"/></listOfReactants>
        <listOfProducts><speciesReference species="P" stoichiometry="1"/></listOfProducts>
        <kineticLaw formula="(Vmax * S) / (Km + S)"/>
      </reaction>
    </listOfReactions>
  </model>
</sbml>
`;

// 1. Parse SBML document and run M8801-M8810 pre-flight diagnostics
const doc = parseSbml(sbmlXml, "michaelis_menten.sbml");
const diagnostics = lintSbml(doc);

// 2. Simulate reaction kinetics ODEs via RK4
const simResult = solveReactions(doc, { duration: 10.0, timeStep: 0.02 });
console.log(simResult.finalConcentrations.S, simResult.finalConcentrations.P);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerSbmlToDae(doc);
const modelicaCode = sbmlToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                      |
| `npm test`          | Run SBML XML/MathML parser, linter, RK4 reaction solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                              |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                               |
| `npm run clean`     | Remove `dist/` build artifacts                                                     |
