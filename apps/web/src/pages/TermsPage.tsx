// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, LawIcon } from "@primer/octicons-react";
import { Link } from "react-router-dom";
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

const HighlightBox = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  border-left: 4px solid var(--color-accent-cyan);
  border-radius: var(--radius-md, 8px);
  padding: 16px 20px;
  margin: 20px 0;
`;

export default function TermsPage() {
  usePageTitle("Terms of Service");

  return (
    <Container>
      <BackLink to="/">
        <ArrowLeftIcon size={16} /> Back to ModelScript
      </BackLink>

      <Header>
        <Title>
          <LawIcon size={32} /> Terms of Service
        </Title>
        <LastUpdated>Last updated: October 2026</LastUpdated>
      </Header>

      <Section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account, accessing, or using the ModelScript platform, web workbench, simulation API, or
          package registry (&ldquo;Services&rdquo;), you agree to be bound by these Terms of Service
          (&ldquo;Terms&rdquo;) and our Acceptable Use Policy. If you do not agree to these terms, do not access or use
          the Services.
        </p>
      </Section>

      <Section>
        <h2>2. Simulation &amp; Cloud Compute Credits</h2>
        <p>
          ModelScript provides browser-native WebAssembly solvers, differential algebraic equation (DAE) compilation,
          and optional cloud High-Performance Computing (HPC) simulation runners.
        </p>
        <ul>
          <li>
            <strong>Fair Use of Free Tier:</strong> Free accounts receive initial compute credits upon verified email
            activation. Creating duplicate or Sybil accounts to bypass compute quotas is strictly prohibited.
          </li>
          <li>
            <strong>Resource Allocation:</strong> Cloud jobs (FEA, CFD, batch sweeps) are executed subject to queue
            availability, worker concurrency limits, and your account tier.
          </li>
        </ul>
      </Section>

      <Section id="aup">
        <h2>3. Acceptable Use Policy (AUP) &amp; Export Compliance</h2>
        <HighlightBox>
          <p style={{ margin: 0, fontWeight: 600 }}>
            ModelScript tools compile physical models and numerical simulation systems. You agree not to use the
            Services for unlawful or prohibited purposes.
          </p>
        </HighlightBox>
        <p>You agree that you will NOT:</p>
        <ul>
          <li>
            Use the platform in violation of United States, European Union, or applicable international export control
            laws (including EAR and ITAR restrictions).
          </li>
          <li>
            Develop, design, simulate, or optimize weapons of mass destruction, military munitions, or prohibited
            dual-use aerospace and defense technologies where export authorization is required and lacking.
          </li>
          <li>
            Engage in cryptocurrency mining, unauthorized denial-of-service testing, or port scanning using ModelScript
            cloud compute runners.
          </li>
          <li>
            Publish or transmit malicious code, exploits, or deceptive package artifacts targeting the ModelScript
            registry ecosystem.
          </li>
        </ul>
      </Section>

      <Section>
        <h2>4. Intellectual Property &amp; Package Publishing</h2>
        <p>
          You retain all rights and ownership to the cyber-physical models, SysML diagrams, Modelica code, and CAD
          artifacts you create. When publishing packages to the public ModelScript Registry, you grant other users a
          license according to the SPDX license identifier specified in your package manifest (such as MIT,
          BSD-3-Clause, or AGPL-3.0).
        </p>
      </Section>

      <Section>
        <h2>5. Disclaimer of Engineering Warranties</h2>
        <p>
          THE SERVICES AND SIMULATION RESULTS ARE PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTY OF ANY KIND. NUMERICAL
          SIMULATIONS, FEA/CFD SOLVERS, AND PHYSICAL DYNAMICS SOLVERS ARE APPROXIMATIONS AND SHOULD NOT BE RELIED UPON
          AS THE SOLE BASIS FOR SAFETY-CRITICAL ENGINEERING DECISIONS (SUCH AS MEDICAL, AEROSPACE, OR NUCLEAR SYSTEMS)
          WITHOUT RIGOROUS PHYSICAL EMPIRICAL VALIDATION.
        </p>
      </Section>
    </Container>
  );
}
