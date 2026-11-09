---
title: Pricing & Licensing
description: Plans for individuals, teams, vendors embedding ModelScript, and air-gapped enterprise deployments.
pageClass: pricing-page
---

# Pricing

Start free, and move up when you need more compute, collaboration, or a commercial license. The core compilers, solvers, and IDE are open source under the **AGPL-3.0-or-later**. Cloud compute, team features, and enterprise deployments will be paid plans. They are still in development (see the notice below), so only Community is available today.

<PricingPlans />

---

## Which plan do I need?

| If you are...                                                          | Choose                                     |
| :--------------------------------------------------------------------- | :----------------------------------------- |
| Learning, doing research, or building open-source models               | **Community**                              |
| An engineer who needs cloud compute for large models                   | **Pro**                                    |
| A team that shares compute, private packages, and access control       | **Team**                                   |
| Shipping a closed-source product that includes ModelScript             | **Commercial SDK**                         |
| Running ModelScript internally with SSO, air-gapped or regulated needs | **Enterprise Appliance**                   |
| Not sure                                                               | [Contact us](mailto:sales@modelscript.org) |

---

## Frequently Asked Questions

### How is ModelScript licensed?

ModelScript is **open core** with a dual license:

- **Open core (`AGPL-3.0-or-later`).** The language parsers, runtime, solvers, language server, and IDE are open source.
- **Enterprise Edition (`LicenseRef-ModelScript-Enterprise`).** Governance, air-gapped deployment, single sign-on, on-premise HPC, digital twins, hardware-in-the-loop code generation, and PLM connectors are in the `ee/` directory. They need a valid license key.

### Can my team use the Community edition internally without paying?

**Yes.** Internal use inside your company, academic research, and evaluation do not trigger the AGPL's source-sharing requirements, as long as you don't offer the software as a service to people outside your organization.

### When do I need the Commercial SDK?

You need it if any of these apply:

1. You embed ModelScript libraries (for example `@modelscript/modelica`, `@modelscript/runtime`, `@modelscript/mcp`) in a closed-source SaaS or desktop product.
2. You can't publish your application's source under the AGPL.
3. Your company's legal policy prohibits AGPL dependencies.

### What third-party dependencies are in the Commercial SDK, and are there copyleft terms?

The core ModelScript compiler SDK (`@modelscript/dsl`, `@modelscript/runtime`, `@modelscript/simulate`, `@modelscript/diagram`, `@modelscript/react`, and polyglot languages) relies exclusively on permissive open-source dependencies (`MIT`, `Apache-2.0`, `BSD`, `ISC`, `zlib`) with zero copyleft obligations.

If your product embeds the optional 3D CAD/STEP geometry engine (`@modelscript/cad`), it interfaces with Open CASCADE Technology WebAssembly binaries (`opencascade.js` and `occt-import-js`), which are licensed under the **GNU Lesser General Public License v2.1 (LGPL-2.1)**. Under LGPL-2.1 Section 6, commercial customers can embed `@modelscript/cad` within proprietary, closed-source applications provided that Open CASCADE is loaded as a dynamically linked WebAssembly module (as natively implemented via WebWorker isolation in `src/worker.ts`) and standard Open CASCADE attribution and LGPL-2.1 terms are passed through to end users.

### How is the Commercial SDK priced?

Commercial SDK pricing is customized based on your product architecture, distribution model, and support requirements. Please [contact us](mailto:sales@modelscript.org?subject=%5BCommercial%20SDK%20Inquiry%5D%20Pricing) at sales@modelscript.org for a quote.

### How is the Enterprise Appliance priced?

Enterprise Appliance pricing is customized based on the number of sites and seats, deployment environment (air-gapped, on-premise HPC clusters), and support level. Please [contact us](mailto:sales@modelscript.org?subject=%5BEnterprise%20Appliance%20Inquiry%5D%20Pricing) at sales@modelscript.org for a custom quote after a short scoping call.

### I'm a large company using ModelScript internally. Do I need the Commercial SDK?

**No.** The Commercial SDK is a redistribution license for vendors who ship ModelScript inside a product. Internal use is already covered by the AGPL. What a large organization usually needs are the Enterprise Edition features (single sign-on, air-gapped deployment, on-premise HPC, compliance documentation, hardware-in-the-loop and PLM integrations). Those come with the Enterprise Appliance, not the SDK. The SDK does not include any `ee/` code.

### Can an enterprise just buy the Commercial SDK instead of the Enterprise Appliance?

Not to get Enterprise Edition features. The `ee/` code is under a separate license and needs an Enterprise license key. The SDK only removes the AGPL obligations for the open-core code.

### What if I'm a vendor and I also want Enterprise features?

The Commercial SDK and the Enterprise Appliance are separate licenses. The Enterprise license is for internal use. If you want Enterprise features in a product you ship, [contact us](mailto:sales@modelscript.org?subject=%5BCombined%20License%5D%20ModelScript) about a combined agreement.

### Can I use Pro or Team for commercial work?

**Yes.** Pro and Team are service subscriptions. They cover cloud compute and collaboration features. They don't license you to embed ModelScript in a closed-source product. For that, you need the Commercial SDK.

### How do the credits in Pro and Team work?

Credits pay for cloud HPC and GPU jobs. Pro includes 200 credits per month and Team includes 600 shared across the organization. You can buy more from **Settings → Billing**.

### What happens if I cancel or my license lapses?

- **Pro and Team:** you drop back to Community at the end of the billing period. Your public work and local tools keep working.
- **Commercial SDK:** the license is annual. Versions you received during the term remain covered for the term. After it ends you need to renew to ship new releases that include ModelScript.
- **Enterprise Appliance:** an expired offline license key switches enterprise features off. Contact us before the renewal date to get a new key.

### Do you offer academic, startup, or nonprofit discounts?

Academic research can use Community at no cost. For startups and nonprofits who need paid features, [get in touch](mailto:sales@modelscript.org?subject=%5BDiscount%20Request%5D%20ModelScript) and we'll work something out.

### How does the Enterprise Appliance work without internet access?

It is a self-contained container bundle (`ghcr.io/modelscript/appliance`) with Docker Compose and Kubernetes manifests (`ee/deploy/`). It runs fully disconnected from the internet. User credentials, models, and simulation results are stored on an encrypted local volume.

### Does the Enterprise Appliance make us compliant with NERC CIP, FERC CEII, ITAR, or FDA 21 CFR Part 11?

No product can do that on its own. The appliance provides the technical controls (offline operation, audit logs, access control, approvals) and supporting documentation that help your compliance program. Compliance itself depends on how you deploy and operate it. Please have your compliance or legal team review the documentation.

### Can we try the Commercial SDK or Enterprise Appliance first?

**Yes.** We offer 30-day evaluation agreements with direct technical support. [Contact us](mailto:sales@modelscript.org?subject=%5BEvaluation%20Request%5D%20ModelScript%2030-Day%20Evaluation) to start.

### What is the refund policy?

Pro and Team can be cancelled at any time. Annual plans can be refunded within 14 days of purchase if you haven't used the included credits. Commercial SDK and Enterprise contracts are covered by the evaluation period instead.
