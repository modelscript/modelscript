<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/oscal

NIST OSCAL 1.1.2 (Open Security Controls Assessment Language) Cybersecurity, NIST SP 800-53 Rev 5 / SP 800-82 OT/ICS Compliance, and Cyber-Physical Systems (CPS) Architecture Auditing package (`.oscal`, `.oscal.json`, `.oscal.xml`) for ModelScript. Features a unified OSCAL JSON & XML parser and serializer (`parseOscal`, `serializeOscal`), multi-file workspace indexing (`OscalWorkspaceIndex`), profile resolution & tailoring engine (`resolveOscalProfile`), CPS architecture compliance auditor (`auditCpsArchitectureCompliance`), 8 cybersecurity & OT/ICS lint rules (`M8201`–`M8208`, `lintOscalDocument`, `OscalErrorCode`), SysML v2 and OMG ReqIF 1.2 projections (`oscalToSysML2`, `oscalToReqif`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **OSCAL 1.1.2 JSON & XML Parser & Roundtrip Serializer (`parseOscal`, `serializeOscal`)**: Parses and serializes all 7 NIST OSCAL models:
  - **Control Layer**: `catalog` (`NIST_800_53_REV5_CATALOG`), `profile` (`imports`, `modify`, `set-parameters`, `alters`).
  - **Implementation Layer**: `component-definition`, `system-security-plan` (`SSP` — `system-characteristics`, `system-implementation`, `control-implementation`).
  - **Assessment Layer**: `assessment-plan` (`AP`), `assessment-results` (`AR` — `findings`, `observations`, `risks`), and `plan-of-action-and-milestones` (`POA&M`).
- **Profile Resolution & Tailoring Engine (`resolveOscalProfile`)**: Resolves profile `include-controls` / `exclude-controls` selectors, applies parameter constraints (`set-parameters`), and merges `alter` additions against built-in NIST SP 800-53 Rev 5 and NIST SP 800-82 Rev 3 OT/ICS control baselines (`MANDATORY_OT_ICS_CONTROLS`).
- **CPS Architecture Compliance Auditor (`auditCpsArchitectureCompliance`)**: Cross-audits OSCAL System Security Plans against SysML v2 (`@modelscript/sysml2`) and AutomationML (`@modelscript/automationml`) architectural blocks, verifying that every PLC, RTU, IED, actuator, and network bus is mapped and satisfies NIST SP 800-82 OT overlay controls.
- **8 Cybersecurity & OT/ICS Lint Rules (`M8201`–`M8208`, `lintOscalDocument`)**: Static verification of RFC 4122 UUIDs, control ID resolution, unset control parameters, unimplemented baseline controls, orphaned `by-component` references, unmapped CPS architecture blocks, OT/ICS overlay violations, and unmitigated high/critical POA&M findings.
- **SysML v2 & ReqIF 1.2 Projections (`oscalToSysML2`, `oscalToReqif`)**: Projects OSCAL security controls and SSP implementations into SysML v2 `requirement def` / `satisfy` blocks and OMG ReqIF 1.2 requirements interchange packages (`@modelscript/reqif`).

---

## Package Structure

| Path                       | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                                |
| `src/language.ts`          | `oscalLanguage` definition, compiler actions, and MCP tool (`oscal_audit_cps_compliance`)             |
| `src/types.ts`             | `OscalDocument`, `OscalCatalog`, `OscalProfile`, `OscalSsp`, `OscalAssessmentResults`, `OscalPoam`    |
| `src/catalog/index.ts`     | Built-in `NIST_800_53_REV5_CATALOG` and `MANDATORY_OT_ICS_CONTROLS` (NIST SP 800-82 Rev 3 OT overlay) |
| `src/parser/index.ts`      | `parseOscal` and `serializeOscal` lossless JSON/XML parser and format converter                       |
| `src/lints/rules.ts`       | `OscalErrorCode` and `lintOscalDocument` cybersecurity & OT/ICS linter (`M8201`–`M8208`)              |
| `src/resolver/index.ts`    | `resolveOscalProfile` and `auditCpsArchitectureCompliance` profile tailoring and CPS auditing engine  |
| `src/projections/index.ts` | `oscalToSysML2` and `oscalToReqif` cross-language translators                                         |
| `src/workspace-index.ts`   | `OscalWorkspaceIndex` implementing `IWorkspaceIndex` across `.oscal`, `.json`, and `.xml` files       |
| `src/lsp.ts`               | LSP validation, document symbols, control hover cards, completion, and definition providers           |

---

## Pre-Flight Semantic Lint Rules (`M8201`–`M8208`)

| Code    | Rule                                    | Severity  | Description                                                                                                            |
| ------- | --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `M8201` | `oscal-invalid-uuid`                    | `error`   | Malformed RFC 4122 UUID or duplicate UUID declared within an OSCAL document.                                           |
| `M8202` | `oscal-unresolved-control-id`           | `error`   | Referenced `control-id` does not exist in the imported catalog or built-in NIST SP 800-53 / 800-82 baseline.           |
| `M8203` | `oscal-unset-required-parameter`        | `warning` | Control parameter required by a control statement has no value assigned in `set-parameters`.                           |
| `M8204` | `oscal-unimplemented-baseline-control`  | `error`   | Control mandated by the resolved baseline profile is missing from `control-implementation.implemented-requirements`.   |
| `M8205` | `oscal-orphaned-by-component`           | `error`   | `by-component` implementation statement references a `component-uuid` not declared in `system-implementation`.         |
| `M8206` | `oscal-cps-unmapped-architecture-block` | `warning` | CPS architecture block from a linked SysML v2 / AutomationML model has no corresponding component in the OSCAL SSP.    |
| `M8207` | `oscal-ot-ics-overlay-violation`        | `error`   | OT/ICS component (`plc`, `ied`, `rtu`, `ot-controller`) is missing mandatory NIST SP 800-82 safety/isolation controls. |
| `M8208` | `oscal-unmitigated-high-finding`        | `error`   | Open `high` or `critical` risk finding in `assessment-results` lacks a remediation milestone in the linked `POA&M`.    |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx oscal`)

```bash
# Lint an OSCAL Catalog, Profile, SSP, AR, or POA&M document (M8201-M8208)
npx msx oscal lint substation_ssp.oscal.json

# Audit an OSCAL SSP against a SysML v2 / AutomationML CPS architecture
npx msx oscal audit-cps substation_ssp.oscal.json --archblocks PLC_Main,IED_Breaker1,SCADA_Gateway

# Resolve an OSCAL Profile or convert between JSON and XML
npx msx oscal resolve-profile ics_baseline_profile.oscal.json
npx msx oscal convert substation_ssp.oscal.json --format xml

# Project OSCAL controls to SysML v2 (.sysml) or OMG ReqIF 1.2 (.reqif)
npx msx oscal to-sysml2 substation_ssp.oscal.json
npx msx oscal to-reqif substation_ssp.oscal.json
```

### Programmatic API

```typescript
import {
  auditCpsArchitectureCompliance,
  lintOscalDocument,
  oscalToReqif,
  oscalToSysML2,
  parseOscal,
  serializeOscal,
} from "@modelscript/oscal";

// 1. Parse OSCAL 1.1.2 SSP (JSON or XML) and run NIST SP 800-53 / 800-82 lints (M8201-M8208)
const doc = parseOscal(sspJson, "substation_ssp.oscal.json");
const diagnostics = lintOscalDocument(doc, { architectureBlocks: ["PLC_Main", "IED_Relay_01"] });

// 2. Audit CPS architecture compliance and NIST SP 800-82 OT/ICS coverage
const audit = auditCpsArchitectureCompliance(doc, ["PLC_Main", "IED_Relay_01"]);
console.log(`Compliance Score: ${audit.complianceScorePct.toFixed(1)}%, Passed: ${audit.passed}`);

// 3. Project to SysML v2 requirements, ReqIF 1.2 XML, or convert to OSCAL XML
const sysmlCode = oscalToSysML2(doc);
const reqifXml = oscalToReqif(doc);
const oscalXml = serializeOscal(doc, "xml");
```

---

## Scripts

| Command             | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                 |
| `npm test`          | Run OSCAL 1.1.2 parser, NIST 800-53/800-82 linter, CPS audit, and ReqIF tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                         |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                          |
| `npm run clean`     | Remove `dist/` build artifacts                                                |

---

## License

`AGPL-3.0-or-later`
