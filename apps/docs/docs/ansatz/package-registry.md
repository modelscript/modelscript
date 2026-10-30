# Polyglot Package Registry

The **Ansatz Package Registry** (`/packages`) provides versioned dependency management and artifact distribution for multi-domain engineering libraries. It supports native ModelScript packages alongside standard Modelica libraries, SysML v2 models, and STEP CAD repositories.

---

## Supported Package Formats

| Format             | Scope & Manifest                     | Primary Usage                                                 |
| :----------------- | :----------------------------------- | :------------------------------------------------------------ |
| **ModelScript**    | `package.json` (`modelscript` field) | Native multi-domain models, equations, and simulation scripts |
| **Modelica**       | `package.mo` / `package.order`       | Complete Modelica 3.x packages and component libraries        |
| **SysML v2**       | `sysml.library`                      | OMG Systems Modeling Language v2 and KerML domain models      |
| **STEP CAD**       | `step.json` manifest                 | ISO 10303 AP214/AP242 geometric parts and assemblies          |
| **SSP Containers** | `SystemStructure.ssd`                | System Structure and Parameterization multi-FMU packages      |

---

## Package Lifecycle

### 1. Authoring & Manifest Configuration

Packages include metadata declaring dependencies, license, and maturity:

```json
{
  "name": "@engineering/microgrid",
  "version": "1.2.0",
  "license": "Apache-2.0",
  "dependencies": {
    "@modelscript/modelica": "^4.1.0",
    "@modelscript/pscad": "^0.0.18"
  }
}
```

### 2. Publishing Packages

Engineers can publish packages through the web interface using the **Publish Package Modal** in `/packages`, or via the CLI:

```bash
msx publish ./my-package
```

### 3. Dependency Resolution & Integrity

- **Content-Addressable Storage:** Published tarballs are stored and indexed by SHA-256 digest.
- **SPDX License Auditing:** Manifests are analyzed during upload to verify valid SPDX identifiers and flag incompatible license pairings.
- **Dependency Trees:** The registry computes transitive dependency graphs and displays required dependencies in the web UI.

---

## Industry Standards & Export Gateways

Packages in the Ansatz registry can be exported into standardized industrial container formats with a single click:

- **Asset Administration Shell (AASX):** Generates an Industry 4.0 Asset Administration Shell package compatible with AASX Package Explorer.
- **Open Know-How (OKH):** Produces a DIN SPEC 3105 Open Know-How manifest (`okh.json`) for open-hardware traceability.
- **ISO/PAS 81346 Digital Data Package (DDP):** Packages system hierarchies according to international reference designation standards.
