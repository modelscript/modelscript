---
title: ReqIF Requirements Engineering & Formal Contract Entailment
description: Native compiler support for OMG ReqIF (.reqif, .reqifz) requirements archives, Nelson-Oppen formal contract entailment prover, and SysML v2 / Modelica verification block projections in ModelScript.
---

# ReqIF Requirements Engineering & Formal Verification

ModelScript delivers first-class support for **ReqIF** (Requirements Interchange Format, OMG ReqIF 1.0/1.2), the global standard for exchanging structured requirements across aerospace, automotive (ISO 26262), and medical device systems. ModelScript elevates requirements from dead documentation into **computable digital contracts** verifiable against physics simulations and architectural constraints.

---

## Capabilities & Supported Formats

| Format                       | Extension         | Description                                                                                                                  |
| :--------------------------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **OMG ReqIF XML Document**   | `.reqif`, `.xml`  | XML document defining specification types, spec-objects, hierarchical spec-relations, data types, and attribute definitions. |
| **ReqIF Compressed Archive** | `.reqifz`, `.zip` | Zip archive packaging `.reqif` manifests alongside embedded media, diagrams, and attachments.                                |

### Key Architectural Features

- **Full OMG ReqIF 1.2 Ingestion & Roundtrip:**
  - Robust XML reader and serializer preserving internal identifiers (`IDENTIFIER`), specification hierarchies, multi-level parent-child relations, and custom attribute types (String, Integer, Real, Boolean, Date, Enumeration).
- **Formal Contract Extraction:**
  - Automatically parses mathematical constraints from natural language requirement text (e.g. `latency <= 50 ms`, `pressure >= 15 bar`, `temp in [20, 80] C`).
- **Nelson-Oppen Mathematical Entailment Prover:**
  - Uses the SMT/Nelson-Oppen theory coordinator in `@modelscript/runtime` to prove whether child sub-requirements strictly entail parent system-level requirements:
    $$\bigwedge_{i} \text{SubReq}_i \models \text{ParentReq}$$
  - Generates concrete numeric counterexamples when an entailment gap exists (e.g. child requirements permit a state that violates the parent requirement).
- **Automated Verification Projections:**
  - **OMG SysML v2:** Translates spec-objects into formal `requirement def` items with `doc` annotations, attribute definitions, and `satisfy` links.
  - **Modelica Verification Blocks:** Generates acausal Modelica monitor blocks with assertions that trigger simulation failure when requirement bounds are breached.
- **Requirements Linters (`M7001`–`M7008`):**
  - Detects dangling requirement relations, circular requirement hierarchies, unbounded safety contracts on ASIL requirements, and missing mandatory attributes.

---

## Command Line Interface (`msx reqif`)

```bash
msx reqif <action> [files...] [options]
```

| Action            | Description                                                                        | Key Options            |
| :---------------- | :--------------------------------------------------------------------------------- | :--------------------- |
| **`import`**      | Parses a ReqIF 1.2 document and prints requirements, hierarchy, and relations.     | `--format table\|json` |
| **`export`**      | Exports SysML v2 requirements into ReqIF 1.2 XML.                                  | `--output`, `--title`  |
| **`lint`**        | Runs structural consistency checks, link validation, and safety contract analysis. | —                      |
| **`verify`**      | Runs Nelson-Oppen formal entailment proofs across requirement hierarchies.         | —                      |
| **`to-sysml`**    | Projects ReqIF specifications into OMG SysML v2 requirement definitions.           | `--out=<file.sysml>`   |
| **`to-modelica`** | Generates Modelica assertion blocks for in-simulation verification.                | `--out=<file.mo>`      |

### Examples

```bash
# Import requirement specifications and hierarchies
msx reqif import SystemRequirements.reqif

# Run pre-flight linting on ASIL safety requirements
msx reqif lint BrakeSafetyRequirements.reqif

# Formally prove requirement hierarchy entailment with SMT counterexample generation
msx reqif verify PowertrainContracts.reqif

# Project requirements to SysML v2 definitions
msx reqif to-sysml AvionicsRequirements.reqif --out=AvionicsRequirements.sysml

# Synthesize executable Modelica verification blocks
msx reqif to-modelica ThermalLimits.reqif --out=ThermalMonitors.mo
```

---

## Requirements Linters & Diagnostic Rules

<LintRules lang="reqif" />
