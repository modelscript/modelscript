// SPDX-License-Identifier: AGPL-3.0-or-later

import { LawIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styledImport from "styled-components";
import { getPublicDomainBlocks, type PublicDomainBlockItem } from "../api/admin";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import {
  DEFAULT_INSTANCE_RULES,
  InlineCode,
  LegalLayout,
  LegalSection,
  LegalTable,
  PillBadge,
  TldrBox,
  type TocItem,
} from "./legal/LegalLayout";

const styled: typeof styledImport = (styledImport as { default?: typeof styledImport }).default ?? styledImport;

const RulesGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0 24px;
`;

const RuleCard = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
`;

const RuleNumber = styled.span`
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  background: rgba(6, 182, 212, 0.14);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: var(--color-accent-cyan, #06b6d4);
  font-size: 13px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
`;

const TERMS_TOC: TocItem[] = [
  { id: "rules", label: "1. Server Ground Rules" },
  { id: "registration", label: "2. Registration & Anti-Sybil" },
  { id: "federation", label: "3. Federation & Visibility" },
  { id: "moderation", label: "4. Moderation & Appeals" },
  { id: "aup", label: "5. Compute Credits & Export Control" },
  { id: "ip-licensing", label: "6. IP, SPDX & AGPLv3 § 13" },
  { id: "disclaimer", label: "7. Engineering Disclaimers" },
];

export default function TermsPage() {
  usePageTitle("Terms of Service & Server Rules");
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const contactEmail = branding.contactEmail || "admin@ansatz.social";

  const [domainBlocks, setDomainBlocks] = useState<PublicDomainBlockItem[]>([]);
  const [domainBlocksLoaded, setDomainBlocksLoaded] = useState(false);

  useEffect(() => {
    if (!branding.domainBlocksPublic) return;
    let cancelled = false;
    getPublicDomainBlocks()
      .then((res) => {
        if (!cancelled && Array.isArray(res.domainBlocks)) {
          setDomainBlocks(res.domainBlocks);
          setDomainBlocksLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setDomainBlocksLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [branding.domainBlocksPublic]);

  const activeRules =
    branding.rules && branding.rules.length > 0
      ? branding.rules.map((r) => ({ id: r.id, text: r.text, hint: r.hint }))
      : DEFAULT_INSTANCE_RULES.map((r, idx) => ({ id: idx + 1, text: r.text, hint: r.hint }));

  const isCustomRules = Boolean(branding.rules && branding.rules.length > 0);

  return (
    <LegalLayout
      activeDoc="terms"
      title="Terms of Service & Server Rules"
      subtitle={`Community code of conduct, federated ActivityPub governance, Acceptable Use Policy (AUP), export control compliance, and simulation terms for ${brandName}.`}
      icon={<LawIcon size={32} />}
      toc={TERMS_TOC}
      customMarkdown={branding.customTermsMarkdown}
    >
      {/* 1. Server Ground Rules */}
      <LegalSection id="rules">
        <h2>
          1. Server Ground Rules &amp; Code of Conduct{" "}
          <PillBadge $tone={isCustomRules ? "cyan" : "neutral"}>
            {isCustomRules ? "Instance Configured" : "Standard Ruleset"}
          </PillBadge>
        </h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> These numbered ground rules govern all posts, peer reviews, repositories,
            and packages on <strong>{brandName}</strong>. Moderators cite these specific rule numbers when issuing
            content warnings or account strikes.
          </p>
        </TldrBox>

        <RulesGrid data-testid="terms-instance-rules-list">
          {activeRules.map((rule, idx) => (
            <RuleCard key={rule.id ?? idx}>
              <RuleNumber>{idx + 1}</RuleNumber>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-text-heading)" }}>{rule.text}</div>
                {rule.hint && (
                  <div
                    style={{ fontSize: "13.5px", color: "var(--color-text-muted)", marginTop: "4px", lineHeight: 1.5 }}
                  >
                    {rule.hint}
                  </div>
                )}
              </div>
            </RuleCard>
          ))}
        </RulesGrid>
      </LegalSection>

      {/* 2. Account Registration & Anti-Sybil */}
      <LegalSection id="registration">
        <h2>2. Account Registration, Eligibility &amp; Anti-Sybil Protections</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> By creating an account on {brandName}, you agree to these Terms and our{" "}
            <Link to="/privacy">Privacy Policy</Link>. Automated bot registrations, disposable email aliases, and
            duplicate accounts created to bypass compute quotas or moderation actions are blocked.
          </p>
        </TldrBox>
        <p>
          By accessing or registering on the <strong>{brandName}</strong> platform, web workbench, simulation API, or
          package registry (&ldquo;Services&rdquo;), you enter into a binding agreement with the instance operator (
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>).
        </p>
        <ul>
          <li>
            <strong>Active Registration Mode ({branding.registrationMode}):</strong>{" "}
            {branding.registrationMode === "open" &&
              "Public registration is currently open subject to email verification and anti-Sybil screening."}
            {branding.registrationMode === "invite_only" &&
              `Registration currently requires a valid invitation token${branding.waitlistEnabled ? " or approval through the public waitlist queue" : ""}.`}
            {branding.registrationMode === "domain_allowlist" &&
              "Registration is restricted to verified institutional or corporate email domains authorized by the instance administrator."}
            {branding.registrationMode === "closed" &&
              "Self-service registration is closed; accounts are provisioned directly by instance administrators."}
          </li>
          {branding.academicFastTrackEnabled && (
            <li>
              <strong>Academic &amp; Research Fast-Track:</strong> Verified institutional domains (including{" "}
              {(branding.academicDomainPatterns || ["*.edu", "*.ac.uk"]).slice(0, 6).join(", ")}) qualify for
              streamlined researcher verification and academic badge attribution.
            </li>
          )}
          <li>
            <strong>Anti-Sybil &amp; Canonical Email Screening:</strong> To protect shared solver clusters and prevent
            ban evasion, registration endpoints enforce canonical email normalization (stripping sub-address tags such
            as <InlineCode>+alias</InlineCode> and provider-specific dot-aliases), disposable email domain blocking, and
            CIDR subnet rate-limiting.
          </li>
          <li>
            <strong>Credential &amp; 2FA Security:</strong> You are responsible for safeguarding your account password,
            TOTP two-factor authentication tokens, personal access tokens, and cryptographic keys.
          </li>
        </ul>
      </LegalSection>

      {/* 3. Federation, Visibility Tiers & Moderated Peers */}
      <LegalSection id="federation">
        <h2>3. ActivityPub Federation, Content Visibility &amp; Moderated Peers</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> {brandName} implements the W3C ActivityPub federation protocol. You
            control who sees your posts across four Mastodon-compatible visibility tiers, and you can migrate your
            followers or verify your ORCID profile at any time.
          </p>
        </TldrBox>
        <p>
          <strong>{brandName}</strong> is currently configured in{" "}
          <InlineCode>{branding.federationMode || "open"}</InlineCode> federation topology
          {branding.authorizedFetchEnabled ? " with HTTP Signature Authorized Fetch (Secure Mode) enforced" : ""}.
        </p>
        <LegalTable>
          <thead>
            <tr>
              <th>Visibility Tier</th>
              <th>Local Discovery &amp; Timelines</th>
              <th>ActivityPub S2S Federation Delivery</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Public</strong> (<InlineCode>public</InlineCode>)
              </td>
              <td>Listed in Home, Local/Explore timelines, search indexes, and trending topics.</td>
              <td>
                Federated to follower inboxes and subscribed ActivityPub Relays (<InlineCode>FEP-ae97</InlineCode>) when
                federation is enabled.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Unlisted / Quiet Public</strong> (<InlineCode>unlisted</InlineCode>)
              </td>
              <td>Visible on your profile and via direct link, but excluded from public Explore and trending feeds.</td>
              <td>Delivered to followers without broadcasting to public relay timelines.</td>
            </tr>
            <tr>
              <td>
                <strong>Followers-Only</strong> (<InlineCode>followers</InlineCode>)
              </td>
              <td>Restricted to approved followers. Non-followers receive HTTP 403.</td>
              <td>
                Addressed strictly to your synchronized follower collection (<InlineCode>FEP-8fcf</InlineCode>).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Direct / Mentioned Only</strong> (<InlineCode>direct</InlineCode>)
              </td>
              <td>
                Accessible exclusively to the author and explicitly mentioned accounts (<InlineCode>@user</InlineCode>).
              </td>
              <td>Delivered only to the specific remote actor inboxes named in the post.</td>
            </tr>
          </tbody>
        </LegalTable>
        <ul>
          <li>
            <strong>Locked Accounts &amp; Profile Verification:</strong> You may enable manual follower approval (
            <InlineCode>manuallyApprovesFollowers</InlineCode>), opt out of search indexing (
            <InlineCode>indexable: false</InlineCode>) and directory discovery (
            <InlineCode>discoverable: false</InlineCode>), verify external links (
            <InlineCode>rel=&quot;me&quot;</InlineCode> and ORCID identifiers), and migrate followers to another
            ActivityPub server via cryptographic <InlineCode>Move</InlineCode> / <InlineCode>alsoKnownAs</InlineCode>{" "}
            activities.
          </li>
          <li>
            <strong>Federation Defederation &amp; Domain Tiers:</strong> Instance administrators may place remote
            domains on <InlineCode>silence</InlineCode> (limiting posts to existing followers),{" "}
            <InlineCode>suspend</InlineCode> (blocking all S2S traffic), or apply granular media/report rejection (
            <InlineCode>reject_media</InlineCode>, <InlineCode>reject_reports</InlineCode>). Unresponsive remote inboxes
            are automatically circuit-broken after consecutive delivery failures.
          </li>
        </ul>

        {branding.domainBlocksPublic && domainBlocksLoaded && domainBlocks.length > 0 && (
          <div style={{ marginTop: "16px" }} data-testid="terms-public-domain-blocks">
            <h3>Publicly Disclosed Moderated Federation Domains ({domainBlocks.length})</h3>
            <LegalTable>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Enforcement Tier</th>
                  <th>Public Moderation Rationale</th>
                </tr>
              </thead>
              <tbody>
                {domainBlocks.map((b) => (
                  <tr key={b.domain}>
                    <td>
                      <InlineCode>{b.domain}</InlineCode>
                    </td>
                    <td>
                      <PillBadge $tone={b.severity === "suspend" ? "amber" : "neutral"}>{b.severity}</PillBadge>
                    </td>
                    <td>{b.comment || "Policy enforcement"}</td>
                  </tr>
                ))}
              </tbody>
            </LegalTable>
          </div>
        )}
      </LegalSection>

      {/* 4. Moderation, Automated Filters & Appeals */}
      <LegalSection id="moderation">
        <h2>4. Moderation, Automated Filters, Graduated Enforcement &amp; Appeals</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Moderation follows a transparent, graduated workflow. If your content or
            account receives a warning or restriction, you are notified with the specific rule cited and can submit an
            appeal.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>Automated Content Filters &amp; Auto-Quarantine:</strong> Posts are screened against instance
            keyword and regular-expression safety filters (currently configured action:{" "}
            <InlineCode>{branding.autoFilterAction || "cw"}</InlineCode>) and community report thresholds
            (auto-quarantine at <InlineCode>{branding.autoQuarantineReportThreshold ?? 5}</InlineCode> pending reports).
            Users can also configure personal Mastodon v2 client/server content filters (
            <InlineCode>/api/v1/social/filters</InlineCode>).
          </li>
          <li>
            <strong>Graduated Enforcement Actions:</strong> Moderators may apply a Content Warning (
            <InlineCode>mark_sensitive</InlineCode>), silence a post to followers-only, delete violating content, issue
            a formal Account Warning / Strike citing specific Server Rules (
            <InlineCode>/api/v1/users/me/warnings</InlineCode>), temporarily freeze an account, or permanently suspend
            accounts for severe violations.
          </li>
          <li>
            <strong>Right to Appeal:</strong> Account holders may acknowledge warnings and submit formal moderation
            appeals or DMCA counter-notices, which are reviewed in the staff moderation queue and recorded in the
            tamper-evident SHA-256 administrative audit log.
          </li>
        </ul>
      </LegalSection>

      {/* 5. Acceptable Use Policy (AUP), Compute Credits & Export Control */}
      <LegalSection id="aup">
        <h2>5. Simulation Runtime, Cloud HPC Credits &amp; Export Compliance (AUP)</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Local WebAssembly simulations run in your own browser. Cloud HPC solvers
            consume compute credits and must never be used for crypto-mining, network attacks, or prohibited military /
            export-controlled weapons design.
          </p>
        </TldrBox>
        <p>
          <strong>{brandName}</strong> provides browser-native WebAssembly compilation (powered by ModelScript&rsquo;s
          linear-memory DAE arena) alongside optional cloud High-Performance Computing (HPC) simulation workers
          (SUNDIALS CVODE/IDA, FEA, CFD, and Slurm batch runners). You agree that you will <strong>NOT</strong>:
        </p>
        <ul>
          <li>
            <strong>Violate Export Control Laws (EAR / ITAR / EU Dual-Use):</strong> Upload, compile, simulate, or
            distribute technical data controlled under the U.S. International Traffic in Arms Regulations (ITAR), Export
            Administration Regulations (EAR), or European Union Dual-Use Regulation without required government
            authorization, or access the platform from comprehensively sanctioned jurisdictions.
          </li>
          <li>
            <strong>Prohibited Weapons &amp; Munitions Design:</strong> Use simulation solvers to design, optimize, or
            validate nuclear, chemical, or biological weapons, missile delivery systems, or unlawful military munitions.
          </li>
          <li>
            <strong>Abuse Cloud Compute Infrastructure:</strong> Engage in cryptocurrency mining, denial-of-service
            attacks, unauthorized port scanning, container escape attempts, or Sybil account creation to circumvent
            compute credit quotas.
          </li>
          <li>
            <strong>Distribute Malicious Artifacts:</strong> Publish packages, FMUs (<InlineCode>.fmu</InlineCode>), or
            scripts containing malware, credential harvesters, or deceptive dependency payloads.
          </li>
        </ul>
      </LegalSection>

      {/* 6. Intellectual Property, SPDX Licensing & AGPLv3 § 13 */}
      <LegalSection id="ip-licensing">
        <h2>6. Intellectual Property, SPDX Package Licensing &amp; AGPLv3 § 13 Disclosure</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> You own the models, code, and CAD files you create. Public packages are
            licensed under the SPDX identifier you choose, and the underlying open-core platform source code is freely
            available under GNU AGPLv3 § 13.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>User Ownership:</strong> You retain full copyright and intellectual property ownership over all
            Modelica, SysML v2, OpenSCAD, STEP, PSCAD, SIMPACK, and ModelScript models, repositories, and simulation
            trajectories you create.
          </li>
          <li>
            <strong>Public Registry Licensing:</strong> When publishing a package or public repository to the{" "}
            <strong>{brandName}</strong> Registry, you grant users a license in accordance with the SPDX license
            identifier declared in your package manifest (e.g., <InlineCode>MIT</InlineCode>,{" "}
            <InlineCode>BSD-3-Clause</InlineCode>, <InlineCode>Apache-2.0</InlineCode>, or{" "}
            <InlineCode>AGPL-3.0-or-later</InlineCode>).
          </li>
          <li>
            <strong>DMCA &amp; Copyright Takedowns:</strong> Copyright notices and counter-notices are processed via our
            structured DMCA compliance workflow. Contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a> for
            intellectual property inquiries.
          </li>
          <li>
            <strong>GNU AGPLv3 Section 13 Network Source Disclosure:</strong> In compliance with Section 13 of the GNU
            Affero General Public License v3.0 (<InlineCode>AGPL-3.0-or-later</InlineCode>), the Corresponding Source
            code for the open-core platform powering <strong>{brandName}</strong> is available at{" "}
            <a href="https://github.com/modelscript/modelscript" target="_blank" rel="noopener noreferrer">
              https://github.com/modelscript/modelscript
            </a>{" "}
            (machine-readable metadata at <InlineCode>/api/v1/compliance/policy</InlineCode>).
          </li>
        </ul>
      </LegalSection>

      {/* 7. Disclaimer of Engineering Warranties */}
      <LegalSection id="disclaimer">
        <h2>7. Disclaimer of Engineering Warranties &amp; Limitation of Liability</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Numerical solvers are mathematical approximations. Always perform
            independent physical testing and empirical verification before deploying any design in real-world hardware
            or safety-critical systems.
          </p>
        </TldrBox>
        <p>
          THE SERVICES, COMPILERS, NUMERICAL INTEGRATORS, AND SIMULATION RESULTS ARE PROVIDED &ldquo;AS IS&rdquo; AND
          &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
          WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR ENGINEERING PURPOSE, OR NUMERICAL CONVERGENCE.
        </p>
        <p>
          DIFFERENTIAL-ALGEBRAIC EQUATION (DAE) SOLVERS, FINITE ELEMENT ANALYSIS (FEA), COMPUTATIONAL FLUID DYNAMICS
          (CFD), ELECTROMAGNETIC TRANSIENT (EMT) SOLVERS, AND SURROGATE MODELS ARE MATHEMATICAL APPROXIMATIONS AND MUST
          NOT BE RELIED UPON AS THE SOLE BASIS FOR SAFETY-CRITICAL ENGINEERING DECISIONS (INCLUDING AEROSPACE,
          AUTOMOTIVE, MEDICAL DEVICE, NUCLEAR, OR POWER GRID PROTECTION SYSTEMS) WITHOUT INDEPENDENT EMPIRICAL AND
          PHYSICAL VALIDATION.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
