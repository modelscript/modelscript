---
title: Terms of Service
description: Terms of Service, open-core and enterprise licensing terms, export compliance, and engineering disclaimers for ModelScript and modelscript.org.
---

# ModelScript Terms of Service

**Effective Date:** November 4, 2026  
**Owner & Licensor:** Mohamad Omar Nachawati ("Maintainer")  
**Scope:** `modelscript.org` Website & Documentation Portal, ModelScript Open-Core Toolchain (`msx`, `@modelscript/*`), and Enterprise Licensing

---

## 1. Acceptance & Scope

By accessing `modelscript.org`, downloading or running the ModelScript command-line interface (`msx`), language servers, WebAssembly runtime, or documentation assets ("Services"), you agree to these Terms of Service and our [Privacy Policy](/privacy) and [Trademark Policy](/trademark).

If you access or register an account on the federated **Ansatz** platform (`ansatz.social`) or another independent Ansatz node, your use of that instance is additionally governed by its instance-specific [Ansatz Terms of Service & Server Rules](https://ansatz.social/terms).

---

## 2. Open-Core & Enterprise Licensing

ModelScript is distributed under a dual open-core model. Nothing in these Terms restricts any rights granted to you under an applicable open-source license:

1. **Open-Core Software (`AGPL-3.0-or-later`)**:
   The core compiler, language parsers (`packages/*`, `languages/*`), simulation solvers, CLI (`msx`), VS Code extension, and open-core web components are licensed under the **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)**.
2. **Optional 3D CAD Geometry Engine (`LGPL-2.1`)**:
   `@modelscript/cad` interfaces with Open CASCADE Technology WebAssembly binaries (`opencascade.js` and `occt-import-js`) licensed under the **GNU Lesser General Public License v2.1 (`LGPL-2.1`)**.
3. **Enterprise Edition (`LicenseRef-ModelScript-Enterprise`)**:
   Enterprise governance, air-gapped intranet appliance bundles (`ee/`), SSO/SAML, RBAC, Slurm HPC offload, and regulatory compliance modules require a valid commercial **ModelScript Enterprise License** key (`MSX_LICENSE_KEY`).
4. **Commercial OEM SDK**:
   Embedding ModelScript libraries inside closed-source commercial software without `AGPL-3.0-or-later` source-sharing obligations requires a separate written **Commercial SDK** agreement. See [Pricing & Licensing](/pricing) for details.

---

## 3. Trademarks & Brand Assets

Open-source copyright licenses do not grant trademark rights. All uses of the **ModelScript™**, **Ansatz™**, and **msx™** marks, logos, and `modelscript.org` / `ansatz.social` brand assets are governed by our [Trademark Policy](/trademark).

---

## 4. Acceptable Use & Export Control Compliance

You agree to use `modelscript.org`, official container registries, package downloads, and hosted evaluation endpoints strictly for lawful scientific, educational, and engineering purposes. You may not:

- Probe, disrupt, scrape excessively, or bypass rate limits or security controls on `modelscript.org` or its supporting infrastructure.
- Use ModelScript tools or services in violation of U.S. Export Administration Regulations (**EAR**), International Traffic in Arms Regulations (**ITAR § 126.1**), or European Union dual-use export control laws, or access hosted cloud services from sanctioned jurisdictions where restricted.
- Misrepresent modified forks or unofficial mirrors as official ModelScript releases.

---

## 5. Intellectual Property & User Content

- **Your Models & Code**: ModelScript claims no ownership over the models, CAD geometries, simulation scripts, or results you author or compile using the toolchain.
- **Documentation & Examples**: Unless otherwise noted, documentation text and examples on `modelscript.org` are part of the ModelScript repository and subject to the repository's licensing and attribution terms.

---

## 6. Engineering & Simulation Disclaimers

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MODELSCRIPT, ITS COMPILERS, NUMERICAL SOLVERS, FORMAL VERIFICATION ENGINES, AND DOCUMENTATION ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.**

Numerical ODE/DAE integrations, finite-element/fluid analyses, optimal power flow studies, and formal verification outputs are mathematical approximations subject to model assumptions, discretization, solver tolerances, and user inputs. **They must never be relied upon as the sole basis for safety-critical, medical, aerospace, nuclear, structural, or grid-control engineering decisions without independent verification, physical validation, and review by qualified licensed professionals.**

---

## 7. Limitation of Liability

To the fullest extent permitted by law, Mohamad Omar Nachawati and ModelScript contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or engineering hardware arising out of or related to your use of `modelscript.org` or ModelScript software.

---

## 8. Contact

- **General & Legal Inquiries**: `contact@modelscript.org` or `omar@modelscript.org`
- **Commercial SDK & Enterprise Licensing**: `sales@modelscript.org` or `enterprise@modelscript.org`
- **Source Repository**: [github.com/modelscript/modelscript](https://github.com/modelscript/modelscript)
