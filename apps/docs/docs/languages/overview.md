---
title: "Polyglot Language Ecosystem"
description: "ModelScript is not a single-language compiler—it is a polyglot systems engineering framework. All 81 engineering, scientific, and clinical languages share the same WebAssembly GLR parser compiler..."
---

# Polyglot Language Ecosystem

ModelScript is not a single-language compiler—it is a **polyglot systems engineering framework**. All **81 engineering, scientific, and clinical languages** share the same WebAssembly GLR parser compiler (`@modelscript/dsl`), the same `SymbolIndex` and `WorkspaceIndex` architecture, and the same Triple Graph Grammar (TGG) synchronization engine.

---

## Language Maturity Tiers

Every language package under `languages/<slug>/` declares an explicit maturity tier in `package.json#modelscript.tier`, continuously audited in CI by `scripts/lint-package-manifests.ts` and `scripts/audit-language-maturity.ts` (**24 Stable**, **57 Beta**, **0 Preview**):

| Tier        |   Badge   | Criteria & Guarantees                                                                                                                                                                                                                                                                                                                                       |
| :---------- | :-------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stable**  | `Stable`  | Production-ready (**24 languages**) with complete Ahead-of-Time WASM GLR parser, static domain linter, `DAEBuilder` / solver lowering, and verification against official industry benchmarks, standard library snapshots, or homologation suites (including ModelScript, Modelica, AMPL, SysML v2, ReqIF, SSP, OWL 2, CSV, C, PSCAD, PSS/E, OpenDSS, SPICE, OLGA, PipelineStudio, EPANET, SWMM, EnergyPlus, GENSYS, URDF, PLCopen, STEP, OpenSCAD, and OpenUSD). |
| **Beta**    |  `Beta`   | Domain-complete (**57 languages**) with native WASM GLR parser, static domain linter, `DAEBuilder` / domain solver lowering, cross-language projections, and $\ge 5$ unit and integration test suites (including DIgSILENT PowerFactory, GE PSLF, CIM/CGMES, OCPP, OpenADR, Optical/DWDM, 5G/6G RAN, Fiber OSP, HEC-RAS, TOUGH, MODFLOW 6, LandGEM, GTFS, AUTOSAR, Simulink, SIMPACK, ADAMS, AutomationML, NIST OSCAL, ISO 23952 QIF, CFD, FEA, Chemical/Bio, and the Radiology / Oncology / Surgical CAS suite). |
| **Preview** | `Preview` | Early-access tier (**0 languages currently in Preview** — all 81 language packages meet or exceed `Beta` or `Stable` verification requirements).                                                                                                                                                                                                            |

---

## Explore by Domain & Maturity Tier

Search by name, file extension, maturity tier, or engineering domain, or filter by industry. See [Industries](/industries/) for domain-specific workflows and [Radiology, Oncology & Surgical CAS](/reference/radiology-and-surgery) for clinical and biomedical pipelines.

<LanguageExplorer />

## Language Capability Matrix

Filter by platform group, maturity tier (`Stable`, `Beta`, `Preview`), industry, or capability across all engineering languages to inspect simulation engines, linear-memory DAE lowering, and polyglot projections:

<CapabilityMatrix />

---

## Unified Polyglot Pipeline

Every language plugin implements the `LanguageDefinition` interface (`packages/dsl/src/language.ts`):

1. **Grammar DSL (`defineGrammar`)**: Compiled Ahead-of-Time into a compact `.wasm` binary parser table.
2. **Symbol Indexer (`SymbolIndexer`)**: Walks the linear-memory CST and populates `SymbolEntry` declarations into the global `WorkspaceIndex`.
3. **Salsa Queries (`queries`)**: Memoized semantic analyses (type resolution, unit inference, structural validation).
4. **Compiler Lints (`lints`)**: Real-time diagnostics surfaced identically in the CLI (`msx lint`), LSP server, and Studio.
5. **TGG Rules (`tggRules`)**: Declarative bidirectional synchronization rules linking AST nodes across languages (e.g., `SysMLv2 PartUsage` $\leftrightarrow$ `Modelica Component` $\leftrightarrow$ `STEP Product` $\leftrightarrow$ `ModelScript Struct`).
