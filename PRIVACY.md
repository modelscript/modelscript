# ModelScript Privacy Policy

**Effective Date:** September 30, 2026  
**License:** AGPL-3.0-or-later  
**Scope:** ModelScript Web Application, API, IDE, Documentation, and Published Packages

ModelScript ("we", "us", or "our") is committed to protecting your privacy. This policy outlines our data processing practices in full compliance with the European Union General Data Protection Regulation (**GDPR**), the UK GDPR, and the California Consumer Privacy Act / California Privacy Rights Act (**CCPA/CPRA**).

---

## 1. Core Privacy Principles

1. **Zero Third-Party Trackers**: We do not use third-party analytics (e.g., Google Analytics, PostHog Cloud, Mixpanel), behavioral advertising pixels, or third-party tracking cookies anywhere on our platforms.
2. **Privacy by Design & Ephemeral IP Processing**: When you access ModelScript services, your IP address is processed transiently in volatile system memory (RAM) solely to resolve geographic jurisdiction (country/region) and detect malicious automated abuse. **Raw IP addresses are immediately scrubbed and discarded; they are never stored in our analytics database.**
3. **Data Minimization**: We collect only the minimum data strictly necessary to authenticate your account, run physical simulations, maintain the package registry, and fulfill statutory legal obligations.

---

## 2. Categories of Data We Collect

| Category                        | Specific Elements                                                                                           | Lawful Basis (GDPR Art. 6)                             | Retention Policy                                  |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- | :------------------------------------------------ |
| **Account Credentials**         | Username, email address, password hash (bcrypt), display name, bio, avatar/banner URLs                      | Performance of a contract (Art. 6(1)(b))               | Retained until account deletion                   |
| **User-Generated Content**      | Physical modeling code (Modelica, SysML2, STEP CAD), social posts, replies, likes, bookmarks                | Performance of a contract (Art. 6(1)(b))               | Retained until author deletion or account erasure |
| **Public Key Cryptography**     | User public RSA/Ed25519 keys for commit signing and ActivityPub federation                                  | Performance of a contract (Art. 6(1)(b))               | Retained until key revocation or account erasure  |
| **Billing & Compute Quotas**    | Credits balance, transaction ledger, simulation CPU/GPU execution minutes                                   | Legal obligation & contract (Art. 6(1)(b), (c))        | 7 years (statutory accounting requirements)       |
| **Operational & Security Logs** | Timestamped audit records of critical security events (login, password reset, rate-limiting)                | Legitimate interest in platform defense (Art. 6(1)(f)) | **Auto-purged after 30 days**                     |
| **Scrubbed Post Analytics**     | Aggregated view count per country and region (e.g. `(post_id: 42, country: "US", region: "CA", views: 10)`) | Legitimate interest (Recital 26 — Non-PII)             | Indefinite (anonymized aggregate data)            |

---

## 3. Cookies and Local Storage

ModelScript does **not** use tracking, profiling, or cross-site advertising cookies. We only use strictly necessary storage:

- **Authentication Tokens**: A cryptographically signed JSON Web Token (JWT) stored in `localStorage` or `HttpOnly` cookie to keep you securely authenticated across page reloads.
- **Theme Preferences**: Local storage flag (`ms-theme: "light" | "night"`) to remember your preferred visual appearance.

Because our storage mechanisms are strictly necessary to deliver the service requested by you, **no cookie consent banner is legally required** under Article 5(3) of the EU ePrivacy Directive.

---

## 4. Export Controls and Sanction Compliance

In accordance with international export regulations, U.S. Export Administration Regulations (EAR), and International Traffic in Arms Regulations (ITAR § 126.1), ModelScript enforces geographic restrictions on certain engineering computation and software publishing endpoints for sanctioned jurisdictions. Geographic verification is conducted transiently in volatile memory using MaxMind GeoIP databases and edge reverse proxy headers.

---

## 5. Your Legal Rights (GDPR & CCPA/CPRA)

You possess statutory privacy rights regarding your personal information:

1. **Right to Access & Data Portability (GDPR Art. 15 & 20 / CCPA § 1798.100)**:
   - You can download a complete, machine-readable archive (`.zip`) containing all your account data, posts, published libraries, and billing history, along with a standalone offline HTML viewer.
   - Navigate to **Settings &rarr; Privacy & Data Protection &rarr; Download Data Archive**.
2. **Right to Erasure / "Right to be Forgotten" (GDPR Art. 17 / CCPA § 1798.105)**:
   - You may request permanent deletion of your account and personal data at any time.
   - Navigate to **Settings &rarr; Privacy & Data Protection &rarr; Delete Account**.
   - Upon execution, your personal profile is redacted, tokens and bookmarks are destroyed, and cryptographic keys are erased.
3. **Right to Rectification (GDPR Art. 16)**:
   - You can edit your username, email, display name, and profile information directly in **Settings &rarr; Your Account**.
4. **No Sale of Personal Data**:
   - ModelScript does not sell, rent, or share personal data with data brokers or advertising third parties (CCPA § 1798.120).

---

## 6. Security & Infrastructure

We employ industry-standard security safeguards to protect your personal information:

- Password hashing utilizing salted `bcrypt` algorithms.
- Enforced Transport Layer Security (TLS 1.3 / HTTPS) on all web endpoints.
- Ephemeral in-memory IP processing with zero raw IP persistence in analytics tables.
- Automated 30-day log rotation and retention policies.

---

## 7. Contact and Data Protection Officer

For privacy inquiries, Data Subject Access Requests (DSARs), or regulatory communications:

- **Email**: `omar@modelscript.org`
- **Security Inquiries**: See [SECURITY.md](./SECURITY.md)
- **Repository**: [https://github.com/modelscript/modelscript](https://github.com/modelscript/modelscript)
