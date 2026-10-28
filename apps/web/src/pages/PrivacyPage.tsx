// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, LawIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

const Container = styled.div`
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 20px 80px;
  color: var(--color-text-primary);
`;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 24px;
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-accent-cyan);
    text-decoration: none;
  }
`;

const Header = styled.div`
  margin-bottom: 36px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 24px;
`;

const DocSwitcher = styled.nav`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 9999px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  margin-bottom: 18px;
`;

const DocPill = styled(Link)<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  background: ${(props) => (props.$active ? "var(--color-bg-card)" : "transparent")};
  box-shadow: ${(props) => (props.$active ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "none")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-heading);
    text-decoration: none;
  }
`;

const Title = styled.h1`
  font-size: 32px;
  font-weight: 800;
  color: var(--color-text-heading);
  letter-spacing: -0.02em;
  margin: 0 0 10px 0;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const LastUpdated = styled.p`
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
`;

const Section = styled.section`
  margin-bottom: 32px;

  h2 {
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-heading);
    margin: 0 0 12px 0;
    letter-spacing: -0.01em;
  }

  p,
  li {
    font-size: 15px;
    line-height: 1.65;
    color: var(--color-text-primary);
    margin: 0 0 12px 0;
  }

  ul {
    padding-left: 24px;
    margin: 0 0 16px 0;
  }

  li {
    margin-bottom: 8px;
  }
`;

export default function PrivacyPage() {
  usePageTitle("Privacy Policy");
  const navigate = useNavigate();

  return (
    <Container>
      <BackLink
        to="/"
        onClick={(e) => {
          if (window.history.length > 1) {
            e.preventDefault();
            navigate(-1);
          }
        }}
      >
        <ArrowLeftIcon size={16} /> Back to ModelScript
      </BackLink>

      <Header>
        <DocSwitcher aria-label="Legal documents">
          <DocPill to="/terms" replace>
            <LawIcon size={14} /> Terms of Service
          </DocPill>
          <DocPill to="/privacy" replace $active aria-current="page">
            <ShieldCheckIcon size={14} /> Privacy Policy
          </DocPill>
        </DocSwitcher>
        <Title>
          <ShieldCheckIcon size={32} /> Privacy Policy
        </Title>
        <LastUpdated>Last updated: October 2026</LastUpdated>
      </Header>

      <Section>
        <h2>1. Information We Collect</h2>
        <p>
          We collect account information (username, email address, password hash, and optional profile metadata such as
          organization and bio), operational telemetry necessary to run and monitor simulations, and transaction history
          related to compute credits.
        </p>
      </Section>

      <Section>
        <h2>2. How We Use Information</h2>
        <p>Information collected is used strictly to:</p>
        <ul>
          <li>Authenticate and manage your access to the ModelScript platform.</li>
          <li>Provision cloud compute instances and run requested simulation workloads.</li>
          <li>Prevent abuse, Sybil attacks, and ensure compliance with international export regulations.</li>
          <li>Communicate vital platform alerts, security notices, and job completion notifications.</li>
        </ul>
      </Section>

      <Section>
        <h2>3. Data Sovereignty &amp; Model Privacy</h2>
        <p>
          Private repositories, private models, and private simulation trajectories remain strictly confidential to your
          account or authorized organization members. ModelScript does not train public AI surrogate models on private
          user repositories without explicit user consent.
        </p>
      </Section>

      <Section>
        <h2>4. Your Rights (GDPR / CCPA)</h2>
        <p>
          You have the right to request an export of your personal data archive or request full account and data
          deletion at any time via your <Link to="/settings?tab=dataArchive">Account Settings</Link>.
        </p>
      </Section>
    </Container>
  );
}
