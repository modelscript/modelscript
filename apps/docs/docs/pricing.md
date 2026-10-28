---
title: Pricing & Licensing
description: Flexible licensing options for open-source physical modeling, proprietary software embedding, and air-gapped utility appliances.
---

# Pricing & Commercial Licensing

ModelScript is an **open-core** computable digital thread for engineering. The core compilers, WebAssembly DAE arena, numerical solvers, and IDE tooling (`packages/`, `languages/`, `apps/`) are licensed under the **AGPL-3.0-or-later**, while enterprise governance, air-gapped compliance, Slurm HPC orchestration, operational digital twins, HIL codegen, and PLM connectors (`ee/`) are licensed under the **ModelScript Enterprise License (`LicenseRef-ModelScript-Enterprise`)**. We also provide Commercial OEM dual-license exemptions for teams embedding ModelScript into proprietary software.

::: tip DEVELOPMENT DRAFT
**Internal Development Preview**: The commercial tiers, dual-licensing models, and appliance packages below represent our proposed commercial offerings. The AGPL-3.0 Community Edition core is always free and open source.
:::

---

## Plan Overview

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 32px 0;">

<div style="border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 28px; background: var(--vp-c-bg-soft); display: flex; flex-direction: column; justify-content: space-between;">
<div>
<div style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: var(--vp-c-brand-1); letter-spacing: 0.05em; margin-bottom: 8px;">Community (Open Core)</div>
<div style="font-size: 32px; font-weight: 800; color: var(--vp-c-text-1); margin-bottom: 8px;">$0 <span style="font-size: 14px; font-weight: 500; color: var(--vp-c-text-2);">/ forever</span></div>
<p style="font-size: 14px; color: var(--vp-c-text-2); margin-bottom: 20px; line-height: 1.5;">Ideal for individual engineers, researchers, and open-source projects using ModelScript.</p>
<ul style="list-style: none; padding: 0; margin: 0; font-size: 14px; line-height: 1.8; color: var(--vp-c-text-1);">
  <li>✓ AGPL-3.0 open-core compiler &amp; solvers</li>
  <li>✓ In-browser WebAssembly DAE simulation</li>
  <li>✓ Core engineering language parsers</li>
  <li>✓ Local CLI toolchain (<code>msx</code>)</li>
  <li>✓ Nelson-Oppen multi-solver verification</li>
  <li>✓ Local stdio Model Context Protocol (MCP)</li>
  <li>✓ Public package registry access</li>
  <li>✓ Community GitHub Discussions &amp; Issues</li>
</ul>
</div>
<div style="margin-top: 24px;">
  <a href="/guide/getting-started" style="display: block; text-align: center; background: var(--vp-c-bg-elv); border: 1px solid var(--vp-c-border); color: var(--vp-c-text-1); padding: 10px 16px; border-radius: 8px; font-weight: 600; text-decoration: none;">Get Started Free</a>
</div>
</div>

<div style="border: 2px solid var(--vp-c-brand-1); border-radius: 12px; padding: 28px; background: var(--vp-c-bg-soft); display: flex; flex-direction: column; justify-content: space-between; position: relative;">
<div style="position: absolute; top: -12px; right: 20px; background: var(--vp-c-brand-1); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 2px 10px; border-radius: 10px;">Recommended for Vendors</div>
<div>
<div style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: var(--vp-c-brand-1); letter-spacing: 0.05em; margin-bottom: 8px;">Commercial SDK</div>
<div style="font-size: 32px; font-weight: 800; color: var(--vp-c-text-1); margin-bottom: 8px;">$12,000 <span style="font-size: 14px; font-weight: 500; color: var(--vp-c-text-2);">/ year</span></div>
<p style="font-size: 14px; color: var(--vp-c-text-2); margin-bottom: 20px; line-height: 1.5;">Dual-license exemption for vendors, AI agents, and CAD/CAE tools embedding ModelScript into closed software.</p>
<ul style="list-style: none; padding: 0; margin: 0; font-size: 14px; line-height: 1.8; color: var(--vp-c-text-1);">
  <li>✓ <strong>AGPL-3.0 Copyleft Exemption</strong></li>
  <li>✓ Embed into proprietary SaaS and desktop apps</li>
  <li>✓ Royalty-free redistribution</li>
  <li>✓ Hosted MCP SSE &amp; OMG SysML v2 REST APIs</li>
  <li>✓ Private Slack channel with core compiler team</li>
  <li>✓ 48-hour response time SLA on blocker issues</li>
  <li>✓ Backported security &amp; solver stability patches</li>
  <li>✓ Annual commercial license renewal</li>
</ul>
</div>
<div style="margin-top: 24px;">
  <a href="mailto:omar@modelscript.org?subject=%5BCommercial%20SDK%20Inquiry%5D%20ModelScript%20Evaluation" style="display: block; text-align: center; background: var(--vp-c-brand-1); color: #ffffff; padding: 10px 16px; border-radius: 8px; font-weight: 600; text-decoration: none;">Request Commercial Pilot</a>
</div>
</div>

<div style="border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 28px; background: var(--vp-c-bg-soft); display: flex; flex-direction: column; justify-content: space-between;">
<div>
<div style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: var(--vp-c-brand-1); letter-spacing: 0.05em; margin-bottom: 8px;">Enterprise Appliance (ee/)</div>
<div style="font-size: 32px; font-weight: 800; color: var(--vp-c-text-1); margin-bottom: 8px;">$18,000 <span style="font-size: 14px; font-weight: 500; color: var(--vp-c-text-2);">/ year</span></div>
<p style="font-size: 14px; color: var(--vp-c-text-2); margin-bottom: 20px; line-height: 1.5;">Air-gapped on-premise deployment for electric utilities, aerospace, automotive, and defense with strict regulatory firewalls.</p>
<ul style="list-style: none; padding: 0; margin: 0; font-size: 14px; line-height: 1.8; color: var(--vp-c-text-1);">
  <li>✓ <strong>100% Air-Gapped Container Image (<code>ee/deploy/</code>)</strong></li>
  <li>✓ Offline Ed25519 license key (<code>MSX_LICENSE_KEY</code>)</li>
  <li>✓ NERC CIP, FERC CEII, ITAR/EAR &amp; FDA 21 CFR Part 11 DHF</li>
  <li>✓ SAML 2.0 / OIDC SSO &amp; Multi-Org RBAC</li>
  <li>✓ On-premise Slurm HPC &amp; Distributed CAE Sweeps</li>
  <li>✓ Operational Digital Twins &amp; TimescaleDB Historian</li>
  <li>✓ Real-Time HIL (dSPACE/Speedgoat/AUTOSAR/PLCopen)</li>
  <li>✓ Enterprise PLM/CAE Bridges (OSLC, ReqIF, DDP, Simulink)</li>
</ul>
</div>
<div style="margin-top: 24px;">
  <a href="mailto:omar@modelscript.org?subject=%5BEnterprise%20Appliance%20Inquiry%5D%20Utility%20Evaluation" style="display: block; text-align: center; background: var(--vp-c-bg-elv); border: 1px solid var(--vp-c-border); color: var(--vp-c-text-1); padding: 10px 16px; border-radius: 8px; font-weight: 600; text-decoration: none;">Request Appliance Demo</a>
</div>
</div>

</div>

---

## Detailed Capability Comparison

| Feature                                   | Community (`MSX_EDITION=ce`) |       Commercial SDK       |   Enterprise Appliance (`MSX_EDITION=ee`)   |
| :---------------------------------------- | :--------------------------: | :------------------------: | :-----------------------------------------: |
| **License Type**                          |     `AGPL-3.0-or-later`      | Proprietary Commercial OEM |     `LicenseRef-ModelScript-Enterprise`     |
| **Copyleft Exemption (Section 13)**       |              —               |        **Included**        |                **Included**                 |
| **Embed in Closed-Source SaaS**           |    Requires AGPL release     |       **Permitted**        |                **Permitted**                |
| **WASM GLR Parser & Arena DAE**           |             Yes              |            Yes             |                     Yes                     |
| **Nelson-Oppen Multi-Solver**             |             Yes              |            Yes             |                     Yes                     |
| **Air-Gapped Deployment (`ee/deploy/`)**  |              —               |             —              |    **Turnkey Containers (Docker / K8s)**    |
| **Regulatory & DHF Attestations**         |              —               |             —              | **NERC CIP, FERC CEII, ITAR & FDA Part 11** |
| **Enterprise SSO & Multi-Org RBAC**       |          Basic JWT           |      Scoped API Keys       |       **SAML 2.0 / OIDC & Org RBAC**        |
| **Slurm HPC & Distributed 3D CAE Sweeps** |              —               |     Priority Dispatch      |     **Dedicated On-Premise Partition**      |
| **Operational Digital Twins & Historian** |              —               |          Optional          |      **Included (MHE + TimescaleDB)**       |
| **Digital Thread Governance & Approvals** |              —               |          Optional          |    **Included (Proposals + Audit Log)**     |
| **Real-Time HIL, AUTOSAR & PLC Codegen**  |         Baseline FMI         |        **Included**        |   **dSPACE, Speedgoat, AUTOSAR, PLCopen**   |
| **Enterprise PLM & Legacy CAE Bridges**   |              —               |        **Included**        | **OSLC, ReqIF, DDP, AASX, Simulink, OLGA**  |
| **Support SLA**                           |         Best-effort          |    48-Hour Business SLA    |        24-Hour Mission-Critical SLA         |

---

## Frequently Asked Questions

### How is ModelScript licensed?

ModelScript uses an **open-core and dual-license** structure:

- **Open Core (`AGPL-3.0-or-later`)**: The core language parsers, WebAssembly DAE arena, numerical solvers, LSP, and IDE under `packages/`, `languages/`, and `apps/` are open source under the GNU Affero General Public License v3.0.
- **Enterprise Edition (`LicenseRef-ModelScript-Enterprise`)**: Enterprise governance, air-gapped security headers, FDA/NERC compliance attestations, corporate OIDC/SAML SSO, Slurm HPC offload, operational digital twins, HIL codegen, and PLM connectors reside in the `ee/` directory and require a valid `MSX_LICENSE_KEY`.

### When do I need the Commercial SDK license?

You require a Commercial SDK license if:

1. You are embedding ModelScript libraries (e.g. `@modelscript/modelica`, `@modelscript/runtime`, `@modelscript/mcp`) into a closed-source commercial SaaS application or desktop product.
2. You cannot disclose the source code of your proprietary application under the terms of the AGPL-3.0.
3. Your corporate legal policy prohibits AGPL-3.0 dependencies in commercial products.

### Can my team use the Community Edition internally without paying?

**Yes.** Under copyright law and the AGPL-3.0, private internal use within your company, academic research, and evaluation do not trigger copyleft distribution obligations as long as the service is not provided to third parties outside your organization.

### How does the Enterprise Appliance work in zero-internet networks?

The Enterprise Appliance is distributed as a self-contained container bundle (`ghcr.io/modelscript/appliance`) accompanied by Docker Compose and Kubernetes manifests (`ee/deploy/`). It operates completely disconnected from the public internet, storing all user credentials, models, and simulation trajectories in an encrypted local volume.

### Can we evaluate the Commercial SDK or Appliance before purchasing?

**Yes.** We offer 30-day proof-of-concept evaluation agreements with direct technical support to verify that ModelScript meets your simulation, verification, and integration requirements. Contact [omar@modelscript.org](mailto:omar@modelscript.org?subject=%5BEvaluation%20Request%5D%20ModelScript%2030-Day%20Evaluation) to initiate a pilot.
