# ModelScript Privacy & Data Sovereignty Policy

**Effective Date:** November 4, 2026  
**License:** Open-Core (`AGPL-3.0-or-later` / `LicenseRef-ModelScript-Enterprise` for `ee/`)  
**Scope:** ModelScript Web Application, Cloud API, Intranet Appliance, IDE Workbench, and Package Registry

ModelScript ("we", "us", or "our") is committed to protecting your privacy, personal data, and engineering intellectual property. This policy outlines our data processing practices in full compliance with the European Union General Data Protection Regulation (**GDPR**), the UK GDPR, and the California Consumer Privacy Act / California Privacy Rights Act (**CCPA/CPRA**).

---

## 1. Architectural Modalities & Data Sovereignty

ModelScript operates under three distinct deployment models:

1. **Community Edition (Self-Hosted Open Source — `MSX_EDITION=ce`)**:
   Runs locally on user hardware or customer-managed servers under the GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`). Zero telemetry or personal data is transmitted to ModelScript.
2. **Enterprise Intranet Appliance (`MSX_EDITION=ee`, `AIRGAP_ENFORCED=true`)**:
   Operates strictly within customer air-gapped on-premise environments or sovereign private clouds. Cryptographic Ed25519 license verification (`MSX_LICENSE_KEY`) is 100% offline with zero network connectivity requirements. No outbound telemetry, crash analytics, engineering models, or license verification requests leave the customer's enterprise network boundary. The customer organization acts as the sole Data Controller.
3. **ModelScript Cloud / Hosted Platform (`modelscript.org`)**:
   Our managed cloud environment for engineering collaboration, cloud High-Performance Computing (HPC) simulations, and public package distribution. ModelScript acts as Data Controller for account authentication and Data Processor for customer repositories and simulation workspaces.

---

## 2. Core Privacy Principles

1. **Zero Third-Party Trackers**: We do not load third-party analytics (e.g., Google Analytics, PostHog Cloud, Mixpanel), behavioral advertising pixels, or cross-site tracking cookies anywhere on our platforms.
2. **Ephemeral In-Memory Telemetry & Geo-Resolution**: When accessing ModelScript web endpoints or the documentation portal, client IP addresses are resolved purely in volatile system memory (RAM) to coarse ISO-3166 country/region codes and immediately discarded. Daily unique visitor counts are deduplicated using a 32-byte cryptographic salt regenerated in RAM every UTC midnight. **Raw IP addresses are never written to analytics tables.**
3. **Engineering Model Sovereignty & Zero AI Training on Private Data**: Client-side parsing (`parser.wasm`), DAE flattening, and numerical simulations execute locally in your browser's WebAssembly linear memory arena. **We never train foundation models or public neural surrogates on private repositories, private simulation traces, or direct messages.**
4. **Data Minimization**: We collect only the minimum data strictly necessary to authenticate accounts, allocate cloud compute quotas, maintain package registries, and fulfill statutory legal obligations.

---

## 3. Categories of Data We Collect

| Category                               | Specific Elements                                                                                                                 | Lawful Basis (GDPR Art. 6)                                          | Retention Policy                                            |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :---------------------------------------------------------- |
| **Account Credentials**                | Username, email (canonicalized), password hash (bcrypt), optional TOTP 2FA secret, RSA-2048 / Ed25519 ActivityPub actor keypair   | Performance of a contract (Art. 6(1)(b))                            | Retained until account erasure                              |
| **Enterprise SSO Identity**            | Corporate OIDC/SAML Subject ID (`sub`), institutional email claims, given/family name, IdP group-to-role mappings                 | Performance of a contract & legitimate interest (Art. 6(1)(b), (f)) | Retained until unlinked or account erasure                  |
| **User Models & Code**                 | Modelica, SysML v2, STEP CAD, social posts, replies, likes, bookmarks, simulation job configurations                              | Performance of a contract (Art. 6(1)(b))                            | Retained until author deletion or account erasure           |
| **Industrial & OT Telemetry**          | TimescaleDB sensor time-series, operational digital twin states, hardware birth certificates / serial numbers, MQTT co-sim frames | Performance of a contract (Art. 6(1)(b))                            | Configurable hypertable retention or customer-controlled    |
| **Billing & Compute Quotas**           | Stripe transaction identifiers, compute credit wallet ledger, CPU/GPU execution minutes                                           | Statutory legal obligation & contract (Art. 6(1)(b), (c))           | 7 years (statutory accounting and tax requirements)         |
| **Operational & Security Logs**        | Timestamped audit records of authentication events, admin actions, rate-limiting, and export blocks                               | Legitimate interest in platform defense (Art. 6(1)(f))              | **Auto-purged after 30 days**                               |
| **Regulatory Compliance Attestations** | Ed25519-signed FDA 21 CFR Part 11 DHF dossiers, NERC CIP / FERC CEII / IEEE 2800 certificates and audit ledger head hashes        | Statutory legal obligation (Art. 6(1)(c), Art. 17(3)(b))            | Retained for statutory device/asset lifecycle (7–10+ years) |
| **Scrubbed Route Telemetry**           | Daily route path aggregate view counts and coarse ISO country/region tallies                                                      | Legitimate interest (Recital 26 — Non-PII)                          | Indefinite (anonymized aggregate data)                      |

---

## 4. Cookies, Functional Browser Storage & WebCrypto Keystores

ModelScript does **not** use tracking, profiling, or cross-site advertising cookies. We only use strictly necessary and functional storage mechanisms:

- **`modelscript_token`** (`HttpOnly`, `SameSite=Lax`, 7 Days): Cryptographically signed JSON Web Token (JWT) authenticating API requests and embedded IDE workbench sessions.
- **`oauth_state` / `oidc_state`** (`HttpOnly`, `SameSite=Lax`, 10 Minutes): Short-lived cryptographic state nonces preventing Cross-Site Request Forgery (CSRF) during OAuth2 (GitHub, Google, ORCID) and Enterprise SSO (OIDC / SAML) authentication flows.
- **`__cf_bm` / `cf_clearance`** (Conditional): Set by Cloudflare only when the instance operator deploys behind Cloudflare edge proxying or Cloudflare Tunnel (`ingressMode = "cloudflare"`) to protect ActivityPub inboxes and API endpoints from automated DDoS attacks.
- **`localStorage`**: UI theme preferences (`ms-theme: "light" | "night"`), functional solver preferences (`modelscript.modeling_preferences`), AI assistant modes (`modelscript.ai_engine`), and local unsaved scratchpad drafts (`modelscript.artifact_scratch`).
- **`sessionStorage`**: Tab-scoped post dwell-time deduplication (`modelscript.viewed_posts`) and simulation comparison baselines (`modelscript.sim_baseline.*`), automatically destroyed when the browser tab closes.
- **IndexedDB Keystore**: Client-side cryptographic keys stored as non-exportable `CryptoKey` objects (`keystore.ts`) to prevent script exfiltration.

Because our storage mechanisms are strictly necessary to deliver the service requested by you, **no cookie consent banner is legally required** under Article 5(3) of the EU ePrivacy Directive. Users can inspect and clear local caches at any time using the live storage inspector in our web interface.

---

## 5. Network Ingress & Cloudflare Edge Disclosure

Depending on how an instance is deployed by its operator:

1. **Direct Origin Ingress (`ingressMode = "direct"`)**:
   TLS connections terminate directly at the operator's reverse proxy with no third-party CDN or intermediary in the request path. Mandatory in Enterprise Air-Gapped Appliance deployments.
2. **Optional Cloudflare Edge Proxy & Zero-Trust Tunnel (`ingressMode = "cloudflare"`)**:
   When an instance operator enables Cloudflare edge proxying or `cloudflared` tunnel ingress to protect ActivityPub inboxes and API endpoints from distributed denial-of-service (DDoS) attacks:
   - Network traffic traverses Cloudflare's global edge network, which processes connection IPs and TLS handshakes in accordance with Cloudflare's security and DDoS mitigation policies.
   - Cloudflare forwards standard edge headers (`CF-Connecting-IP`, `CF-IPCountry`, `CF-Region-Code`, `CF-Ray`) to the origin server.
   - Our geolocation service prioritizes Cloudflare's `CF-IPCountry` and `CF-Region-Code` headers in memory so that local tunnel/proxy hop IPs are never misattributed and raw client IPs never need to be logged for analytics.
   - When anti-bot security challenges or Cloudflare Turnstile are enabled, Cloudflare may issue strictly necessary security cookies (`__cf_bm`, `cf_clearance`) as documented in our Cookie Policy.
   - Cloudflare Turnstile is used solely as a privacy-preserving anti-abuse verification mechanism and does not set tracking cookies or perform behavioral profiling. Turnstile is completely bypassed in air-gapped enterprise deployments.

---

## 6. Export Controls and International Trade Compliance

In accordance with U.S. Export Administration Regulations (EAR), International Traffic in Arms Regulations (ITAR § 126.1), and European Union Dual-Use Regulations, ModelScript enforces an **Overcompliance Export Control Policy**. Engineering computation, cloud simulation dispatch, and package publishing are blocked for users connecting from **24 sanctioned jurisdictions** (CU, IR, KP, SY, RU, BY, VE, MM, AF, CF, CD, CN, ER, HT, IQ, KH, LB, LY, NI, SO, SS, SD, YE, ZW) and **5 occupied Ukrainian regions** (Crimea, Donetsk, Luhansk, Zaporizhzhia, Kherson).

Geographic verification is conducted transiently in volatile memory using MaxMind GeoIP databases, edge proxy headers (`CF-IPCountry`), and verified user profile country metadata. Attempted unauthorized access is recorded in security audit logs (`export_control_blocked`) for regulatory reporting.

---

## 7. Model Context Protocol (MCP) & AI Data Governance

1. **Model Context Protocol (MCP) Gateways**: ModelScript exposes compilation, simulation, and analysis tools to AI assistants via Hosted MCP Server-Sent Events (SSE) gateways (`/api/v1/mcp`) and client-side stdio. When an AI agent connects, requests execute strictly within the scope of your authorized workspaces. Prompt contents and simulation results transmitted over MCP are never retained to train public foundation models.
2. **Automated AI PR Reviews & Composer AI**: For automated pull request reviews (`/api/v1/repos/:id/reviews`) and workbench code synthesis, requests sent to upstream commercial LLM providers operate under zero-data-retention (ZDR) enterprise terms. In Enterprise Appliance mode, outbound AI API traffic is completely blocked; all AI assistance runs exclusively through local intranet inference engines (e.g., Ollama, vLLM).
3. **Public AI Mirrors & `llms.txt`**: ModelScript publishes token-dense Markdown mirrors and `llms.txt` catalogs for public packages, public classes, and open documentation. **Private repositories, private models, and user accounts are strictly excluded from AI search manifests and crawler endpoints.**

---

## 8. Your Legal Rights (GDPR & CCPA/CPRA)

You possess statutory privacy rights regarding your personal information:

1. **Right to Access & Data Portability (GDPR Art. 15 & 20 / CCPA § 1798.100)**:
   - **Offline Standalone ZIP Archive**: Download a complete, self-contained `.zip` archive containing your profile, posts, models, repositories, and compute ledger, bundled with an offline HTML viewer with zero external CDN dependencies (**Settings → Data Archive**).
   - **Personal Activity Git Vault**: Clone your entire personal activity, posts, simulation studies, and security logs in real time via standard Git Smart HTTP (`git clone https://...`). Git vault caches are generated on-demand with a 24-hour TTL and can be instantly purged via a self-service button in your settings.
2. **Right to Erasure / "Right to be Forgotten" (GDPR Art. 17 / CCPA § 1798.105)**:
   - Request permanent erasure of your account and personal data at any time (**Settings → Privacy & Data Protection → Delete Account**).
   - Upon execution, profile data is anonymized, credentials and tokens are destroyed, cryptographic keys are erased, and signed `Delete(Actor)` tombstones are broadcast to federated ActivityPub peers.
   - _Statutory Exemption (GDPR Art. 17(3)(b)):_ In accordance with statutory medical device, energy grid, and critical infrastructure regulations (FDA 21 CFR Part 11, ISO 13485, NERC CIP), immutable compliance attestation dossiers and audit ledger head hashes are retained for the statutory duration required by law.
3. **Right to Rectification (GDPR Art. 16)**:
   - Edit username, email, display name, bio, and verified profile links (`rel="me"`, ORCID) directly in **Settings → Your Account**.
4. **No Sale of Personal Data**:
   - ModelScript does not sell, rent, or monetize personal data with data brokers or advertising third parties (CCPA § 1798.120).

---

## 9. Security Safeguards & Infrastructure

We employ industry-standard technical and operational safeguards:

- Salted `bcrypt` password hashing and mandatory TOTP 2FA step-up for sensitive actions.
- Enforced Transport Layer Security (TLS 1.3 / HTTPS) on all web and API endpoints.
- Ephemeral in-memory IP processing with zero raw IP persistence in analytics tables.
- Tamper-evident SHA-256 administrative audit chaining (`prev_hash` → `entry_hash`).
- Strict Content-Security-Policy (CSP) with `X-Airgap-Enforced` and `X-CEII-Compliance: FERC-18-CFR-388.113` in Enterprise Appliance deployments.

---

## 10. Contact and Data Protection Officer

For privacy inquiries, Data Subject Access Requests (DSARs), or regulatory communications:

- **Data Protection Officer**: `omar@modelscript.org`
- **Enterprise Licensing & Appliance Support**: `enterprise@modelscript.org`
- **Security Inquiries**: See [SECURITY.md](./SECURITY.md)
- **Source Repository**: [https://github.com/modelscript/modelscript](https://github.com/modelscript/modelscript)
