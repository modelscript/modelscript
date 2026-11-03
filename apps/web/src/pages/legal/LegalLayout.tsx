// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CodeSquareIcon,
  DownloadIcon,
  GlobeIcon,
  LawIcon,
  LockIcon,
  MailIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
} from "@primer/octicons-react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import styledImport from "styled-components";
import { useInstanceBranding, type InstanceBrandingState } from "../../InstanceBrandingContext";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

export interface TocItem {
  id: string;
  label: string;
}

export interface DefaultRuleTemplate {
  text: string;
  hint: string;
}

export const DEFAULT_INSTANCE_RULES: DefaultRuleTemplate[] = [
  {
    text: "Scientific Integrity & Reproducibility",
    hint: "Cite solver tolerances, boundary conditions, mesh parameters, and physical assumptions when publishing benchmark claims or validation results.",
  },
  {
    text: "Constructive Peer Review & Harassment-Free Discourse",
    hint: "Critique equations, models, and methodology—never attack individuals. Harassment, doxxing, hate speech, and targeted brigading are strictly prohibited.",
  },
  {
    text: "Export Control (EAR / ITAR) & Dual-Use Compliance",
    hint: "Do not upload, simulate, or distribute classified defense articles, ITAR/EAR-restricted technical data, or prohibited weapons designs without authorization.",
  },
  {
    text: "Compute & Registry Fair Use",
    hint: "Do not use browser or cloud HPC solvers for cryptocurrency mining, unauthorized network scanning, Sybil quota evasion, or malicious package distribution.",
  },
  {
    text: "Content Warnings (CW) & Sensitive Media",
    hint: "Apply Content Warnings (CW) to sensitive imagery, high-frequency flashing visualizations, or spoilers on active academic challenges.",
  },
  {
    text: "Attribution & Open Source Licensing",
    hint: "Respect SPDX license identifiers (MIT, BSD-3-Clause, AGPL-3.0-or-later) and credit original authors when forking repositories or publishing derivative packages.",
  },
];

export function interpolateLegalMarkdown(
  raw: string,
  branding: Pick<
    InstanceBrandingState,
    | "instanceName"
    | "contactEmail"
    | "legalJurisdiction"
    | "legalEffectiveDate"
    | "registrationMode"
    | "federationMode"
    | "ingressMode"
    | "cloudflareTunnelConfigured"
    | "remoteContentRetentionDays"
    | "remoteMediaCacheRetentionDays"
  >,
): string {
  if (!raw) return "";
  const brandName = branding.instanceName || "Ansatz";
  const contactEmail = branding.contactEmail || "admin@ansatz.social";
  const domain = typeof window !== "undefined" && window.location?.host ? window.location.host : "ansatz.social";
  const jurisdiction = branding.legalJurisdiction?.trim() || "Applicable International & Local Law";
  const effectiveDate = branding.legalEffectiveDate?.trim() || "November 2026";
  const isCloudflare = branding.ingressMode === "cloudflare" || Boolean(branding.cloudflareTunnelConfigured);
  const ingressLabel = isCloudflare ? "Cloudflare Edge Proxy / Zero-Trust Tunnel" : "Direct Origin Ingress";

  return raw
    .replace(/\{\{\s*instanceName\s*\}\}/g, brandName)
    .replace(/\{\{\s*contactEmail\s*\}\}/g, contactEmail)
    .replace(/\{\{\s*domain\s*\}\}/g, domain)
    .replace(/\{\{\s*jurisdiction\s*\}\}/g, jurisdiction)
    .replace(/\{\{\s*effectiveDate\s*\}\}/g, effectiveDate)
    .replace(/\{\{\s*registrationMode\s*\}\}/g, branding.registrationMode || "open")
    .replace(/\{\{\s*federationMode\s*\}\}/g, branding.federationMode || "open")
    .replace(/\{\{\s*ingressMode\s*\}\}/g, ingressLabel)
    .replace(/\{\{\s*remoteRetentionDays\s*\}\}/g, String(branding.remoteContentRetentionDays ?? 90))
    .replace(/\{\{\s*remoteMediaRetentionDays\s*\}\}/g, String(branding.remoteMediaCacheRetentionDays ?? 30));
}

export function getDefaultTermsTemplate(): string {
  return `# {{instanceName}} Terms of Service & Acceptable Use Policy

Effective Date: {{effectiveDate}} | Governing Jurisdiction: {{jurisdiction}}

## 1. Acceptance of Terms & Instance Governance
By registering an account, accessing, or using **{{instanceName}}** (\`{{domain}}\`), its WebAssembly simulation workbench, package registry, or federated ActivityPub endpoints, you agree to abide by these Terms of Service and our numbered Server Rules. Operator inquiries may be directed to **{{contactEmail}}**.

## 2. Account Registration & Anti-Sybil Policy
Registration on {{instanceName}} currently operates in **{{registrationMode}}** mode. Creating duplicate or automated Sybil accounts to evade compute quotas, rate limits, or moderation blocks is prohibited. Email addresses undergo canonical anti-abuse normalization at signup.

## 3. Federation & Content Visibility
{{instanceName}} operates with federation mode set to **{{federationMode}}**. Public and unlisted posts, profile fields, and packages may be federated to compatible ActivityPub peers using cryptographic HTTP Signatures.

## 4. Acceptable Use, Export Control (EAR/ITAR) & Compute Quotas
Cloud HPC solvers (SUNDIALS, FEA, CFD, Slurm workers) and registry storage must be used exclusively for lawful scientific and engineering workloads in compliance with US EAR, ITAR, and EU dual-use export regulations.

## 5. Disclaimer of Engineering Warranties
ALL SIMULATION SOLVERS AND MODELS ARE PROVIDED "AS IS" WITHOUT WARRANTY. NUMERICAL SIMULATIONS ARE APPROXIMATIONS AND MUST NOT BE RELIED UPON AS THE SOLE BASIS FOR SAFETY-CRITICAL ENGINEERING DECISIONS.`;
}

export function getDefaultPrivacyTemplate(): string {
  return `# {{instanceName}} Privacy & Data Sovereignty Policy

Effective Date: {{effectiveDate}} | Data Controller Contact: {{contactEmail}}

## 1. Zero Third-Party Trackers & First-Party Analytics
**{{instanceName}}** does not load Google Analytics, Meta Pixel, or third-party advertising trackers. First-party pageview and post dwell-time metrics resolve client IP addresses to coarse ISO-3166 country/region codes **purely in-memory** and deduplicate daily visitors using an ephemeral 32-byte HMAC-SHA256 salt in RAM that rotates every UTC midnight. Raw IP addresses are never stored in analytics tables.

## 2. Network Ingress & Optional Cloudflare Edge Routing
This instance currently operates in **{{ingressMode}}** mode. When Cloudflare proxy or Cloudflare Tunnel (\`cloudflared\`) is enabled by the operator, edge requests traverse Cloudflare for TLS termination and DDoS mitigation, passing \`CF-IPCountry\` and \`CF-Connecting-IP\` headers processed in memory.

## 3. Federation Retention & Data Portability
Remote federated content is cached for **{{remoteRetentionDays}} days** (remote media cache: **{{remoteMediaRetentionDays}} days**). You may export a self-contained offline ZIP archive of your data or permanently erase your account under GDPR Art. 17 / CCPA § 1798.105 at any time via Account Settings.`;
}

export function getDefaultCookiesTemplate(): string {
  return `# {{instanceName}} Cookie & Browser Storage Policy

Effective Date: {{effectiveDate}} | Operator Contact: {{contactEmail}}

## 1. Strictly Necessary First-Party Cookies Only
**{{instanceName}}** uses zero advertising or cross-site tracking cookies. We set only strictly necessary HTTP cookies required for authentication and security:
- \`modelscript_token\` (\`HttpOnly\`, \`SameSite=Lax\`): Active session JWT for API and IDE workbench authentication.
- \`oauth_state\` / \`oidc_state\` (\`HttpOnly\`, 10-minute TTL): CSRF protection during OAuth2 and enterprise OIDC sign-in flows.
- \`__cf_bm\` / \`cf_clearance\` (Conditional): Set by Cloudflare only when the operator runs **{{instanceName}}** behind Cloudflare edge protection ({{ingressMode}}).

## 2. Browser LocalStorage, SessionStorage & WebAssembly Memory
Workspace preferences (\`ms-theme\`, \`modelscript.modeling_preferences\`), unsaved scratchpad drafts (\`modelscript.artifact_scratch\`), and tab-scoped post dwell-time deduplication (\`modelscript.viewed_posts\`) are stored locally in your browser and can be cleared at any time.`;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <InlineCode key={idx}>{part.slice(1, -1)}</InlineCode>;
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch?.[1] && linkMatch[2]) {
      const href = linkMatch[2].trim();
      const isSafe = href.startsWith("/") || href.startsWith("https://") || href.startsWith("mailto:");
      if (isSafe) {
        return (
          <a key={idx} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        );
      }
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const LegalMarkdownRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  const lines = markdown.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`${keyPrefix}-list`}>
          {listItems.map((item, i) => (
            <li key={i}>{renderInlineFormatting(item)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(`line-${index}`);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2).trim());
      return;
    }
    flushList(`line-${index}`);
    if (line.startsWith("# ")) {
      elements.push(<h2 key={index}>{renderInlineFormatting(line.slice(2).trim())}</h2>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={index}>{renderInlineFormatting(line.slice(3).trim())}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={index}>{renderInlineFormatting(line.slice(4).trim())}</h3>);
    } else if (line.startsWith("> ")) {
      elements.push(
        <TldrBox key={index}>
          <p style={{ margin: 0 }}>{renderInlineFormatting(line.slice(2).trim())}</p>
        </TldrBox>,
      );
    } else {
      elements.push(<p key={index}>{renderInlineFormatting(line)}</p>);
    }
  });
  flushList("end");

  return <LegalSection>{elements}</LegalSection>;
};

export const PageContainer = styled.div`
  max-width: 1140px;
  margin: 0 auto;
  padding: 40px 24px 96px;
  color: var(--color-text-primary);
`;

export const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 20px;
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-accent-cyan, #06b6d4);
    text-decoration: none;
  }
`;

export const HeaderCard = styled.header`
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--color-border);
`;

export const DocSwitcher = styled.nav`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 9999px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  margin-bottom: 20px;
`;

export const DocPill = styled(Link)<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  background: ${(props) => (props.$active ? "var(--color-bg-card)" : "transparent")};
  box-shadow: ${(props) => (props.$active ? "0 1px 3px rgba(0, 0, 0, 0.14)" : "none")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-heading);
    text-decoration: none;
  }
`;

export const TitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
`;

export const Title = styled.h1`
  font-size: 32px;
  font-weight: 800;
  color: var(--color-text-heading);
  letter-spacing: -0.025em;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const Subtitle = styled.p`
  font-size: 15px;
  line-height: 1.55;
  color: var(--color-text-muted);
  margin: 0 0 14px 0;
  max-width: 760px;
`;

export const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--color-text-muted);
`;

export const PostureStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 32px;
`;

export const PostureCard = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const PostureLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const PostureValue = styled.span`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const PostureSub = styled.span`
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.35;
`;

export const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 36px;
  align-items: start;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

export const MainColumn = styled.main`
  min-width: 0;
`;

export const StickySidebar = styled.aside`
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  @media (max-width: 960px) {
    position: static;
  }
`;

export const SidebarCard = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
`;

export const SidebarHeading = styled.h3`
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const TocList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;

  a {
    display: block;
    font-size: 13px;
    color: var(--color-text-muted);
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s ease;

    &:hover {
      color: var(--color-text-heading);
      background: var(--color-bg-card);
    }
  }
`;

export const LegalSection = styled.section`
  margin-bottom: 36px;
  scroll-margin-top: 24px;

  h2 {
    font-size: 21px;
    font-weight: 800;
    color: var(--color-text-heading);
    margin: 0 0 12px 0;
    letter-spacing: -0.015em;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  h3 {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-heading);
    margin: 18px 0 8px 0;
  }

  p,
  li {
    font-size: 15px;
    line-height: 1.68;
    color: var(--color-text-primary);
    margin: 0 0 12px 0;
  }

  ul,
  ol {
    padding-left: 22px;
    margin: 0 0 16px 0;
  }

  li {
    margin-bottom: 8px;
  }

  a {
    color: var(--color-accent-cyan, #06b6d4);
    text-decoration: none;
    font-weight: 500;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export const TldrBox = styled.div`
  background: var(--surface-overlay, var(--color-canvas-subtle));
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-accent-cyan, #06b6d4);
  border-radius: 10px;
  padding: 14px 18px;
  margin: 0 0 18px 0;

  strong {
    color: var(--color-text-heading);
  }
`;

export const AddendumCard = styled.div`
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid var(--color-accent-cyan, #06b6d4);
  border-radius: 12px;
  padding: 20px 22px;
  margin-bottom: 32px;
`;

export const InlineCode = styled.code`
  font-family: var(--ms-font-mono, monospace);
  font-size: 12.5px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
`;

export const LegalTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  margin: 12px 0 20px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;

  th,
  td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    line-height: 1.45;
  }

  th {
    background: var(--color-canvas-subtle);
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  tr:last-child td {
    border-bottom: none;
  }
`;

export const PillBadge = styled.span<{ $tone?: "cyan" | "green" | "amber" | "neutral" | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: ${(p) =>
    p.$tone === "green"
      ? "rgba(16, 185, 129, 0.14)"
      : p.$tone === "amber"
        ? "rgba(245, 158, 11, 0.15)"
        : p.$tone === "cyan"
          ? "rgba(6, 182, 212, 0.14)"
          : "var(--color-canvas-subtle)"};
  color: ${(p) =>
    p.$tone === "green"
      ? "#10b981"
      : p.$tone === "amber"
        ? "#f59e0b"
        : p.$tone === "cyan"
          ? "var(--color-accent-cyan, #06b6d4)"
          : "var(--color-text-muted)"};
  border: 1px solid
    ${(p) =>
      p.$tone === "green"
        ? "rgba(16, 185, 129, 0.35)"
        : p.$tone === "amber"
          ? "rgba(245, 158, 11, 0.35)"
          : p.$tone === "cyan"
            ? "rgba(6, 182, 212, 0.35)"
            : "var(--color-border)"};
`;

export interface LegalLayoutProps {
  activeDoc: "terms" | "privacy" | "cookies";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  toc: TocItem[];
  customMarkdown?: string | undefined;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({
  activeDoc,
  title,
  subtitle,
  icon,
  toc,
  customMarkdown,
  children,
}) => {
  const navigate = useNavigate();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const contactEmail = branding.contactEmail || "admin@ansatz.social";
  const effectiveDate = branding.legalEffectiveDate?.trim() || "November 2026";
  const jurisdiction = branding.legalJurisdiction?.trim() || "International / Multi-Jurisdictional";
  const isCloudflare = branding.ingressMode === "cloudflare" || Boolean(branding.cloudflareTunnelConfigured);
  const policyMode = branding.legalPolicyMode === "override" ? "override" : "append";
  const interpolatedCustom = customMarkdown?.trim() ? interpolateLegalMarkdown(customMarkdown.trim(), branding) : "";

  const registrationLabel =
    branding.registrationMode === "invite_only"
      ? "Invite-Only"
      : branding.registrationMode === "domain_allowlist"
        ? "Corporate Domain Allowlist"
        : branding.registrationMode === "closed"
          ? "Closed (Admin Provisioned)"
          : "Open Public Registration";

  const federationLabel =
    branding.federationMode === "disabled"
      ? "Air-Gapped (Disabled)"
      : branding.federationMode === "allowlist"
        ? "Trusted Peer Allowlist"
        : "Open Fediverse (ActivityPub)";

  return (
    <PageContainer>
      <BackLink
        to="/"
        onClick={(e) => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            e.preventDefault();
            navigate(-1);
          }
        }}
      >
        <ArrowLeftIcon size={16} /> Back to {brandName}
      </BackLink>

      <HeaderCard>
        <DocSwitcher aria-label="Legal and transparency documents">
          <DocPill
            to="/terms"
            replace
            $active={activeDoc === "terms"}
            aria-current={activeDoc === "terms" ? "page" : undefined}
          >
            <LawIcon size={14} /> Terms &amp; Server Rules
          </DocPill>
          <DocPill
            to="/privacy"
            replace
            $active={activeDoc === "privacy"}
            aria-current={activeDoc === "privacy" ? "page" : undefined}
          >
            <ShieldCheckIcon size={14} /> Privacy &amp; Telemetry
          </DocPill>
          <DocPill
            to="/cookies"
            replace
            $active={activeDoc === "cookies"}
            aria-current={activeDoc === "cookies" ? "page" : undefined}
          >
            <ShieldLockIcon size={14} /> Cookies &amp; Storage
          </DocPill>
        </DocSwitcher>

        <TitleRow>
          <div>
            <Title>
              {icon}
              <span>{title}</span>
            </Title>
            <Subtitle>{subtitle}</Subtitle>
            <MetaRow>
              <span>
                <strong>Effective:</strong> {effectiveDate}
              </span>
              <span>·</span>
              <span>
                <strong>Instance:</strong> {brandName}
              </span>
              <span>·</span>
              <span>
                <strong>Jurisdiction:</strong> {jurisdiction}
              </span>
              {interpolatedCustom && (
                <>
                  <span>·</span>
                  <PillBadge $tone="cyan" data-testid="legal-custom-policy-badge">
                    {policyMode === "override" ? "Custom Instance Policy" : "Includes Instance Addendum"}
                  </PillBadge>
                </>
              )}
            </MetaRow>
          </div>
        </TitleRow>
      </HeaderCard>

      {/* Live Instance Posture Strip */}
      <PostureStrip data-testid="legal-instance-posture">
        <PostureCard>
          <PostureLabel>
            <LockIcon size={12} /> Registration Policy
          </PostureLabel>
          <PostureValue>{registrationLabel}</PostureValue>
          <PostureSub>
            {branding.academicFastTrackEnabled
              ? "Academic fast-track & anti-Sybil verification active"
              : "Canonical email & anti-Sybil screening active"}
          </PostureSub>
        </PostureCard>

        <PostureCard>
          <PostureLabel>
            <GlobeIcon size={12} /> Federation Topology
          </PostureLabel>
          <PostureValue>{federationLabel}</PostureValue>
          <PostureSub>
            {branding.authorizedFetchEnabled
              ? "HTTP Signature Authorized Fetch enforced"
              : `Remote cache retention: ${branding.remoteContentRetentionDays ?? 90}d`}
          </PostureSub>
        </PostureCard>

        <PostureCard>
          <PostureLabel>
            <ServerIcon size={12} /> Network Ingress &amp; Edge
          </PostureLabel>
          <PostureValue>
            {isCloudflare ? "Cloudflare Edge / Tunnel" : "Direct Origin Ingress"}
            <PillBadge $tone={isCloudflare ? "amber" : "green"}>{isCloudflare ? "Edge Proxy" : "Direct"}</PillBadge>
          </PostureValue>
          <PostureSub>
            {isCloudflare
              ? "DDoS/WAF edge headers & tunnel routing enabled"
              : "No third-party CDN proxy in request path"}
          </PostureSub>
        </PostureCard>

        <PostureCard>
          <PostureLabel>
            <CheckCircleIcon size={12} /> Analytics &amp; Telemetry
          </PostureLabel>
          <PostureValue>
            First-Party Only <PillBadge $tone="green">Zero Trackers</PillBadge>
          </PostureValue>
          <PostureSub>In-memory ISO geo lookup &amp; daily rotating RAM HMAC</PostureSub>
        </PostureCard>
      </PostureStrip>

      <ContentGrid>
        <MainColumn>
          {interpolatedCustom && policyMode === "override" ? (
            <div data-testid="legal-custom-override-content">
              <LegalMarkdownRenderer markdown={interpolatedCustom} />
            </div>
          ) : (
            <>
              {interpolatedCustom && policyMode === "append" && (
                <AddendumCard id="instance-addendum" data-testid="legal-custom-addendum-card">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <PillBadge $tone="cyan">Instance-Specific Addendum &amp; Local Policy</PillBadge>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      Configured by {brandName} Administration
                    </span>
                  </div>
                  <LegalMarkdownRenderer markdown={interpolatedCustom} />
                </AddendumCard>
              )}
              {children}
            </>
          )}
        </MainColumn>

        <StickySidebar>
          {toc.length > 0 && !(interpolatedCustom && policyMode === "override") && (
            <SidebarCard aria-label="On this page">
              <SidebarHeading>On This Page</SidebarHeading>
              <TocList>
                {interpolatedCustom && policyMode === "append" && (
                  <li>
                    <a href="#instance-addendum">Instance-Specific Addendum</a>
                  </li>
                )}
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`}>{item.label}</a>
                  </li>
                ))}
              </TocList>
            </SidebarCard>
          )}

          <SidebarCard>
            <SidebarHeading>
              <MailIcon size={13} /> Operator &amp; Legal Contact
            </SidebarHeading>
            <div style={{ fontSize: "13px", lineHeight: 1.55, color: "var(--color-text-primary)" }}>
              <div style={{ marginBottom: "8px" }}>
                <strong>Instance:</strong> {brandName}
              </div>
              <div style={{ marginBottom: "8px" }}>
                <strong>Contact / DPO / DMCA:</strong>{" "}
                <a
                  href={`mailto:${contactEmail}`}
                  style={{ color: "var(--color-accent-cyan, #06b6d4)", textDecoration: "none" }}
                >
                  {contactEmail}
                </a>
              </div>
              <div style={{ marginBottom: "8px" }}>
                <strong>Jurisdiction:</strong> {jurisdiction}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "10px" }}>
                <a
                  href="/.well-known/security.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  RFC 9116 security.txt
                </a>{" "}
                ·{" "}
                <a
                  href="/api/v1/compliance/policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  AGPLv3 § 13 Disclosure
                </a>
              </div>
            </div>
          </SidebarCard>

          <SidebarCard>
            <SidebarHeading>
              <DownloadIcon size={13} /> Self-Service Privacy Tools
            </SidebarHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
              <Link
                to="/settings/dataArchive"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-heading)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                <DownloadIcon size={14} /> Export Offline Data Archive (.ZIP)
              </Link>
              <Link
                to="/settings/privacy"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-heading)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                <ShieldCheckIcon size={14} /> GDPR / CCPA Privacy &amp; Erasure
              </Link>
              <Link
                to="/cookies#storage-inspector"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-heading)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                <CodeSquareIcon size={14} /> Live Browser Storage Inspector
              </Link>
            </div>
          </SidebarCard>
        </StickySidebar>
      </ContentGrid>
    </PageContainer>
  );
};
