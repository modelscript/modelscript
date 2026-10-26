<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/reqif

OMG ReqIF 1.2 / 1.1 / 1.0 (Requirements Interchange Format - ISO/IEC 17506) engineering language package for ModelScript. Features zero-regex WebAssembly XML parsing (`@modelscript/dsl/xml`), multi-file workspace indexing (`ReqIfWorkspaceIndex`), formal contract entailment proving via Nelson-Oppen (`EntailmentTheoryOracle`), 10 pre-flight requirements engineering lint rules (`M7001`–`M7010`), and bidirectional projections / TGG rules linking ReqIF with SysML v2 and Modelica.

---

## Core Capabilities

- **Lossless WASM XML Parser (`parseReqIf`, `serializeReqIf`)**: Parses standard OMG ReqIF 1.2 XML with 1-indexed source line/column coordinates, typed attribute definitions (`String`, `Integer`, `Real`, `Boolean`, `Enumeration`, `XHTML`), hierarchical specifications, and semantic relations (`satisfies`, `verifies`, `refines`, `derives`).
- **Multi-File Workspace Indexer (`ReqIfWorkspaceIndex`)**: Implements `IWorkspaceIndex` to catalog all requirement specifications, individual requirements (`SPEC-OBJECT`), and traceability links across multi-document repositories for instant LSP navigation and cross-file reference finding.
- **Formal V-Model Entailment Prover (`verifyReqIfEntailment`)**: Extracts numeric requirement contracts and couples them directly with `@modelscript/runtime`'s `EntailmentTheoryOracle`. Proves whether sub-requirements mathematically guarantee parent specifications ($\bigwedge R_{\text{child}} \models R_{\text{parent}}$) and emits cryptographically signed proof manifests.
- **Pre-Flight Diagnostic Linter (`lintReqIf`, `M7001`–`M7010`)**: 10 static semantics and quality rules detecting dangling relations, circular hierarchies, unbounded safety contracts, unverified leaf requirements, and type mismatches with 1-click Quick-Fix actions.
- **SysML v2 Bidirectional Projection (`reqifToSysml2`, `sysml2ToReqIf`)**: Translates ReqIF requirement trees directly into KerML / SysML v2 `requirement def` blocks, usages, and satisfaction declarations.
- **Modelica Verifier Block Synthesis (`reqifToModelicaVerifier`)**: Generates production Modelica 3.x verification blocks with input plant connectors, Boolean compliance flags, and runtime `assert()` equations.
- **Polyglot Triple Graph Grammar (TGG) Rules**: 6 declarative bidirectional rules synchronizing ReqIF requirements, specifications, and relations with SysML v2 and Modelica.

---

## Pre-Flight Lint Rules (`M7001`–`M7010`)

| Code    | Rule                             | Severity  | Description                                                                          |
| :------ | :------------------------------- | :-------- | :----------------------------------------------------------------------------------- |
| `M7001` | `dangling-requirement-relation`  | `error`   | Requirement relation references missing source or target requirement.                |
| `M7002` | `type-attribute-mismatch`        | `error`   | Attribute value violates data type definition or enum value list.                    |
| `M7003` | `circular-requirement-hierarchy` | `error`   | Directed cycle detected in requirement tree or refinement hierarchy.                 |
| `M7004` | `unverified-leaf-requirement`    | `warning` | Requirement marked functional/safety has no outgoing 'verifies' or 'satisfies' link. |
| `M7005` | `unbounded-formal-contract`      | `warning` | Requirement marked safety/functional lacks a bounded mathematical contract.          |
| `M7006` | `duplicate-spec-object-id`       | `error`   | Duplicate requirement identifier declared in specification.                          |
| `M7007` | `missing-mandatory-attribute`    | `error`   | Requirement is missing an attribute declared as mandatory in its type.               |
| `M7008` | `empty-specification`            | `warning` | Specification contains no requirement hierarchies.                                   |
| `M7009` | `unresolved-type-reference`      | `error`   | Element references undefined type definition.                                        |
| `M7010` | `invalid-contract-comparator`    | `error`   | Requirement specifies invalid contract comparator.                                   |

---

## Programmatic Usage

```typescript
import {
  lintReqIf,
  parseReqIf,
  reqifToModelicaVerifier,
  reqifToSysml2,
  serializeReqIf,
  verifyReqIfEntailment,
} from "@modelscript/reqif";

// 1. Parse standard OMG ReqIF 1.2 XML
const doc = parseReqIf(xmlContent);
console.log(doc.header.title, doc.specObjects.size);

// 2. Run static diagnostics (M7001-M7010)
const diagnostics = lintReqIf(doc);
for (const diag of diagnostics) {
  console.log(`[${diag.code}] ${diag.message}`);
}

// 3. Formally prove requirement decomposition completeness
const report = verifyReqIfEntailment(doc);
console.log(
  `Entailment queries: ${report.totalQueries}, Certified: ${report.certifiedCount}, Gaps: ${report.gapCount}`,
);

// 4. Project to SysML v2 or Modelica
const sysmlCode = reqifToSysml2(doc);
const modelicaBlock = reqifToModelicaVerifier(doc, "PowertrainVerifier");
```
