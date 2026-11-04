# NIST OSCAL Cyber-Physical Security & Compliance (`.oscal.json`, `.oscal.yaml`, `.oscal.xml`)

`@modelscript/oscal` (`languages/oscal`) provides native WebAssembly parsing, NIST SP 800-53 Rev. 5 and SP 800-82 Cyber-Physical Systems (CPS) compliance auditing, profile baseline resolution, and SysML v2 / ReqIF projections for **NIST Open Security Controls Assessment Language (OSCAL 1.1.x)** catalogs, profiles, system security plans (SSPs), assessment results, and Plans of Action and Milestones (POA&M).

---

## Supported Extensions & Document Models

| Extension              | Format     | Description                                                                                             |
| :--------------------- | :--------- | :------------------------------------------------------------------------------------------------------ |
| `.oscal.json`, `.json` | OSCAL JSON | Standard NIST OSCAL 1.1 JSON representation for Catalogs, Profiles, SSPs, Assessment Results, and POA&M |
| `.oscal.yaml`, `.yaml` | OSCAL YAML | Human-readable YAML representation of OSCAL security artifacts                                          |
| `.oscal.xml`, `.xml`   | OSCAL XML  | XML serialization of NIST OSCAL security control catalogs and system security plans                     |

---

## Key Capabilities

### 1. Full OSCAL 1.1 Lifecycle Support

- Parses and serializes all core NIST OSCAL document layers:
  - **Catalog (`catalog`)**: Hierarchical security control families (e.g., `AC`, `AU`, `CM`, `IA`, `SC`, `SI`), control enhancements, parameters, and assessment objectives.
  - **Profile (`profile`)**: Baseline imports (`imports`), parameter setting (`modify.set-parameters`), and control tailoring (`alter`).
  - **System Security Plan (`system-security-plan`)**: System implementation components, inventory items, leveraged authorizations, and control implementation (`implemented-requirements`).
  - **Assessment Results & POA&M (`assessment-results`, `plan-of-action-and-milestones`)**: Security findings, risk observations, and remediation milestones.

### 2. Cyber-Physical Systems (CPS) Security Auditing

- Evaluates NIST SP 800-82 Industrial Control Systems (ICS) and safety-critical cyber-physical architecture rules across hardware components, network zones, and control implementations.
- Resolves profile baselines to verify that every imported mandatory control has a corresponding implementation statement and parameter assignment.

### 3. Bidirectional SysML v2 & ReqIF Projections

- **OMG SysML v2 (`oscalToSysML2`)**: Projects OSCAL controls and system components into formal `requirement def` and `part def` blocks with `@satisfies` links.
- **OMG ReqIF 1.2 (`oscalToReqif`)**: Exports security control catalogs and SSP implementations into structured ReqIF specifications for traceability alongside functional safety requirements.

---

## Pre-Flight Diagnostics

<LintRules lang="oscal" />

---

## CLI Usage

```bash
# Inspect OSCAL metadata, controls, components, and POA&M items
msx oscal inspect SystemSecurityPlan.oscal.json

# Run pre-flight security control and UUID validation
msx oscal verify SystemSecurityPlan.oscal.json

# Resolve an OSCAL profile against its imported baseline catalog
msx oscal resolve FedRAMPModerateProfile.oscal.json

# Audit Cyber-Physical Systems (CPS) NIST SP 800-82 compliance
msx oscal audit-cps MicrogridSSP.oscal.json

# Project OSCAL controls to SysML v2 or ReqIF 1.2
msx oscal to-sysml SystemSecurityPlan.oscal.json -o SecurityArchitecture.sysml
msx oscal to-reqif SystemSecurityPlan.oscal.json -o SecurityControls.reqif
```
