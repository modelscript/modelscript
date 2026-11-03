<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/oscal

NIST Open Security Controls Assessment Language (OSCAL 1.1.x) and NIST SP 800-53 / SP 800-82 Cyber-Physical Systems (CPS) compliance package for ModelScript.

---

## Core Capabilities

- **NIST OSCAL 1.1.x Multi-Model Parser**: Native parser for OSCAL JSON and XML definitions across Catalogs, Profiles, Component Definitions, and System Security Plans (SSPs).
- **SP 800-53 rev 5 Catalog & Profile Resolver**: Automated resolution and tailoring of security control baselines (Low, Moderate, High, FedRAMP, CMMC).
- **Cyber-Physical Systems (CPS) Security Bridge**: Maps physical control loops, sensors, actuators, and network topologies to NIST SP 800-82 industrial control security controls.
- **Rule-Based Security Linter**: Pre-flight validation for unsatisfied parameter values, broken control references, and missing component implementations.
- **LSP Integration**: Language Server Protocol features with diagnostics, definition navigation, and control-to-component traceability code lenses.

---

## Package Structure

| Path                     | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports            |
| `src/language.ts`        | OSCAL language definition and schema configuration               |
| `src/parser/`            | Multi-model OSCAL JSON and XML parser                            |
| `src/catalogs/`          | NIST SP 800-53 rev 5 catalog snapshots and baseline definitions  |
| `src/resolver/`          | Profile import, tailoring, and parameter resolution engine       |
| `src/lints/`             | Structural and regulatory compliance diagnostic rules            |
| `src/cps-bridge/`        | Cyber-physical systems control and asset mapping                 |
| `src/projections/`       | Projections to SysML v2 and DHF compliance attestations          |
| `src/workspace-index.ts` | Workspace-wide catalog and component definition indexer          |
| `src/lsp.ts`             | Language Server Protocol document symbol and diagnostic provider |
