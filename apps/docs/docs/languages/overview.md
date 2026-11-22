---
title: "Polyglot Language Ecosystem"
description: "ModelScript is not a single-language compiler—it is a polyglot systems engineering framework. All 105 documented engineering, scientific, and clinical formats share the same WebAssembly GLR parser compiler..."
---

# Polyglot Language Ecosystem

ModelScript is not a single-language compiler—it is a **polyglot systems engineering framework**. All **105 documented engineering, scientific, and clinical formats** (106 total workspace language packages) share the same WebAssembly GLR parser compiler (`@modelscript/dsl`), the same `SymbolIndex` and `WorkspaceIndex` architecture, and the same Triple Graph Grammar (TGG) synchronization engine.

---

## Language Maturity Tiers

Every language package under `languages/<slug>/` declares an explicit maturity tier in `package.json#modelscript.tier`, continuously audited in CI by `scripts/lint/lint-package-manifests.ts` and `scripts/lint/audit-language-maturity.ts` (**32 visible Beta** / 33 total workspace Beta, **72 Alpha**, **1 Pre-Alpha**):

| Tier          |    Badge    | Criteria & Guarantees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :------------ | :---------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Beta**      |   `Beta`    | Production-ready (**32 visible documented formats** / 33 workspace packages) with complete Ahead-of-Time WASM GLR parser, static domain linter, `DAEBuilder` / solver lowering, and verification against official industry benchmarks, standard library snapshots, or homologation suites (Modelica, AMPL, SysML v2, ReqIF, SSP, OWL 2, SPARQL 1.1, MagicDraw / Cameo, Simulink, STEP, OpenSCAD, CSV, atopile, KiCad, ROCETS, CCSDS, EASY5, OpenDRIVE, GENSYS, PSCAD, PSS/E, DIgSILENT PowerFactory, OLGA, PipelineStudio, RELAP5, SPICE, Fiber OSP, URDF, ADAMS, EPANET, SWMM, and Cantera).                                                                                                                                                                |
| **Alpha**     |   `Alpha`   | Domain-complete (**72 languages**) with native WASM GLR parser, static domain linter, `DAEBuilder` / domain solver lowering, cross-language projections, and $\ge 5$ unit and integration test suites (including OpenDSS, MATPOWER, CYME, GridLAB-D, PowerWorld, PyPSA, RTDS, PLS-CADD, IEEE C37.118, IEC 60870-5-104, IEEE COMTRADE, IEC 61850 SCL, IWA ASM, OGC WaterML 2.0, ATP-EMTP, IEEE 1815 DNP3, ASPEN OneLiner, SEL Settings, USACE HEC-HMS, GE PSLF, CIM/CGMES, OCPP, OpenADR, Optical/DWDM, 5G/6G RAN, EnergyPlus, HEC-RAS, TOUGH, MODFLOW 6, LandGEM, GTFS, AUTOSAR, SIMPACK, PLCopen, AutomationML, NIST OSCAL, ISO 23952 QIF, OpenUSD, C, Fortran, CFD, FEA, Chemical/Bio, MLXTRAN, NMODL, and the Radiology / Oncology / Surgical CAS suite). |
| **Pre-Alpha** | `Pre-Alpha` | Early-access tier (**1 documented language**: [LAS Well Log ASCII](./las.md), `@modelscript/las`) providing native parsing, dataset conversion, Modelica export, and structural linting prior to full benchmark verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## Explore by Domain & Maturity Tier

Search by name, file extension, maturity tier, or engineering domain, or filter by industry. See [Industries](/industries/) for domain-specific workflows and [Radiology, Oncology & Surgical CAS](/reference/radiology-and-surgery) for clinical and biomedical pipelines.

<LanguageExplorer />

## Language Capability Matrix

Filter by platform group, maturity tier (`Beta`, `Alpha`, `Pre-Alpha`), industry, or capability across all engineering languages to inspect simulation engines, linear-memory DAE lowering, and polyglot projections:

<CapabilityMatrix />

---

## Unified Polyglot Pipeline

Every language plugin implements the `LanguageDefinition` interface (`packages/dsl/src/dsl/language.ts`):

1. **Grammar DSL (`defineGrammar`)**: Compiled Ahead-of-Time into a compact `.wasm` binary parser table.
2. **Symbol Indexer (`SymbolIndexer`)**: Walks the linear-memory CST and populates `SymbolEntry` declarations into the global `WorkspaceIndex`.
3. **Salsa Queries (`queries`)**: Memoized semantic analyses (type resolution, unit inference, structural validation).
4. **Compiler Lints (`lints`)**: Real-time diagnostics surfaced identically in the CLI (`msx lint`), LSP server, and Studio.
5. **TGG Rules (`tggRules`)**: Declarative bidirectional synchronization rules linking AST nodes across languages (e.g., `SysMLv2 PartUsage` $\leftrightarrow$ `Modelica Component` $\leftrightarrow$ `STEP Product` $\leftrightarrow$ `ModelScript Struct`).
