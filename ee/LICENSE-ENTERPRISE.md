# ModelScript Enterprise License (`LicenseRef-ModelScript-Enterprise`)

Copyright (c) 2026 ModelScript Contributors. All rights reserved.

This software directory (`ee/`, `@modelscript/ee`) and all files bearing the SPDX identifier `LicenseRef-ModelScript-Enterprise` constitute the **ModelScript Enterprise Edition ("Enterprise Software")**.

Unlike the ModelScript Open-Core packages (`packages/*`, `languages/*`, and open-core components of `apps/*`), which are licensed under the **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)**, the Enterprise Software is proprietary commercial software governed by the terms below.

---

## 1. Grant of Limited Evaluation & Development License

Subject to your compliance with these terms, ModelScript Contributors grant you a non-exclusive, non-transferable, revocable, royalty-free license to view, compile, and execute the Enterprise Software **solely for internal non-production evaluation, local development, and automated testing**.

## 2. Production & Commercial Deployment Requires a Valid Enterprise License Key

You may **not** deploy, host, or operate the Enterprise Software in any production, commercial, government, utility, or multi-user environment without a valid, cryptographically signed **ModelScript Enterprise License Key (`MSX_LICENSE_KEY`)** obtained under a written commercial agreement with ModelScript:

1. **Enterprise Intranet Appliance Subscription (`tier: "appliance"`):** Permits on-premise or air-gapped deployment of the Enterprise Software (including NERC CIP / FERC CEII / FDA 21 CFR Part 11 compliance controls, OIDC/SAML SSO, Organization RBAC, Slurm/Kubernetes HPC dispatching, Digital Twin Historian, OMG SysML v2 / OSLC / PLM bridges, and HIL code generation) for up to the licensed seat count.
2. **Commercial OEM / Embedded SDK License (`tier: "commercial-sdk"`):** Permits embedding ModelScript compilers, solvers, and Enterprise subsystems inside proprietary, closed-source desktop, cloud, or hardware products without AGPLv3 Section 13 source-code disclosure obligations.
3. **Managed Enterprise Cloud (`tier: "enterprise-cloud"`):** Permits dedicated multi-seat enterprise operation on `modelscript.org` cloud infrastructure.

## 3. Restrictions

Without a signed commercial license agreement with ModelScript, you may **not**:

- Remove, bypass, alter, disable, or circumvent any cryptographic license verification (`MSX_LICENSE_KEY`, `MSX_LICENSE_ENFORCE`, `MSX_EDITION`), seat-count check, or feature entitlement guard in the Enterprise Software;
- Relicence, sublicense, redistribute, or publish the Enterprise Software under the AGPLv3, MIT, Apache-2.0, or any other open-source license;
- Offer the Enterprise Software as a managed service, SaaS, or hosted bureau to third parties.

## 4. Community Edition (`MSX_EDITION=ce`)

To run ModelScript strictly under the open-source `AGPL-3.0-or-later` license without any `LicenseRef-ModelScript-Enterprise` code active, set `MSX_EDITION=ce` in your environment or omit the `ee/` directory at build/runtime.

## 5. Licensing Inquiries

For Enterprise Intranet Appliance subscriptions, Commercial OEM / Embedded SDK dual-licensing, or custom air-gapped deployments, visit `https://modelscript.org/pricing` or contact `enterprise@modelscript.org`.
