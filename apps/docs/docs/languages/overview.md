---
title: "Polyglot Language Ecosystem"
description: "ModelScript is not a single-language compiler—it is a polyglot systems engineering framework. All 68 engineering, scientific, and clinical languages share the same WebAssembly GLR parser compiler..."
---

# Polyglot Language Ecosystem

ModelScript is not a single-language compiler—it is a **polyglot systems engineering framework**. All **68 engineering, scientific, and clinical languages** share the same WebAssembly GLR parser compiler (`@modelscript/dsl`), the same `SymbolIndex` and `WorkspaceIndex` architecture, and the same Triple Graph Grammar (TGG) synchronization engine.

---

## Language Maturity Tiers

Every language package under `languages/<slug>/` declares an explicit maturity tier in `package.json#modelscript.tier`, continuously audited in CI by `scripts/lint-package-manifests.ts`:

| Tier        |   Badge   | Criteria & Guarantees                                                                                                                                                                                                                                                                                                                                       |
| :---------- | :-------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stable**  | `Stable`  | Production-ready with complete Ahead-of-Time WASM GLR parser, static domain linter, `DAEBuilder` / solver lowering, and verification against official industry benchmarks, standard library snapshots, or homologation suites (e.g., OpenModelica & MSL 4.1.0, OMG KerML standard library, EN 14363 Manchester Benchmark, IEEE 2800-2022, NIST STEP AP242). |
| **Beta**    |  `Beta`   | Domain-complete with native WASM GLR parser, static domain linter, `DAEBuilder` / domain solver lowering, cross-language projections, and $\ge 5$ unit and integration test suites (including AUTOSAR, Simulink, SIMPACK, ADAMS, URDF, PLCopen, AutomationML, NIST OSCAL, ISO 23952 QIF, and the Radiology / Oncology / Surgical CAS suite).                |
| **Preview** | `Preview` | Specialized domain and dialect support with native WASM parser, static diagnostics, core AST/DAE lowering, and baseline verification test suites (including CFD, FEA, PSS/E, CIM / CGMES, OpenDSS, Aspen Plus, gPROMS, Cantera, PHREEQC, SMILES, and the Systems & Synthetic Biology suite).                                                                |

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
4. **Compiler Lints (`lints`)**: Real-time diagnostics surfaced identically in the CLI (`msx lint`), LSP server, and Web IDE.
5. **TGG Rules (`tggRules`)**: Declarative bidirectional synchronization rules linking AST nodes across languages (e.g., `SysMLv2 PartUsage` $\leftrightarrow$ `Modelica Component` $\leftrightarrow$ `STEP Product` $\leftrightarrow$ `ModelScript Struct`).
