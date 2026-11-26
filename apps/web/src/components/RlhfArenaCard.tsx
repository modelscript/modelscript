// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";

export interface RlhfFormalCertSummary {
  gate1GlrSyntax: boolean;
  gate2QudvUnits: boolean;
  gate3SmtFeasibility: boolean;
  gate4DaeBalance: boolean;
  cadClearance?: boolean | undefined;
  diagnostics?: string[] | undefined;
}

export interface RlhfArenaCardCandidate {
  id: number;
  label: string;
  dialect: string;
  mInit: number;
  tokenCount: number;
  formalCert: RlhfFormalCertSummary | null;
}

export interface RlhfArenaCardProps {
  id: number;
  challengeType: "pairwise_arena" | "fix_it_bounty" | "tolerance_labeling";
  dialect: string;
  title: string;
  prompt: string;
  deltaTTrigger?: number | null | undefined;
  annotationCount: number;
  candidates: RlhfArenaCardCandidate[];
}

const CardRoot = styled.article`
  border: 1px solid var(--ms-border-default, rgba(56, 189, 248, 0.25));
  border-radius: 12px;
  padding: 16px;
  background: var(--ms-surface-panel, rgba(13, 17, 23, 0.9));
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const HeaderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const Pill = styled.span<{ $tone?: "cyan" | "emerald" | "amber" | "violet" | "rose" }>`
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "emerald"
        ? "rgba(52, 211, 153, 0.45)"
        : $tone === "amber"
          ? "rgba(251, 191, 36, 0.45)"
          : $tone === "violet"
            ? "rgba(167, 139, 250, 0.45)"
            : $tone === "rose"
              ? "rgba(248, 113, 113, 0.45)"
              : "rgba(56, 189, 248, 0.45)"};
  background: ${({ $tone }) =>
    $tone === "emerald"
      ? "rgba(52, 211, 153, 0.12)"
      : $tone === "amber"
        ? "rgba(251, 191, 36, 0.12)"
        : $tone === "violet"
          ? "rgba(167, 139, 250, 0.12)"
          : $tone === "rose"
            ? "rgba(248, 113, 113, 0.12)"
            : "rgba(56, 189, 248, 0.12)"};
  color: ${({ $tone }) =>
    $tone === "emerald"
      ? "#34d399"
      : $tone === "amber"
        ? "#fbbf24"
        : $tone === "violet"
          ? "#c4b5fd"
          : $tone === "rose"
            ? "#fda4af"
            : "#38bdf8"};
`;

const Title = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ms-text-1, #f8fafc);
`;

const PromptText = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ms-text-2, #94a3b8);
`;

const CandidateRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
`;

const CandidateTile = styled.div`
  border: 1px solid var(--ms-border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(255, 255, 255, 0.02);
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const LaunchLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  background: linear-gradient(135deg, #0284c7, #6366f1);
  color: #ffffff;
  &:hover {
    opacity: 0.92;
  }
`;

const TYPE_LABELS: Record<RlhfArenaCardProps["challengeType"], string> = {
  pairwise_arena: "RLHF Pairwise Arena",
  fix_it_bounty: "Verified Fix-It Bounty",
  tolerance_labeling: "Zonotope Tolerance Labeling",
};

export const RlhfArenaCard: React.FC<RlhfArenaCardProps> = ({
  id,
  challengeType,
  dialect,
  title,
  prompt,
  deltaTTrigger,
  annotationCount,
  candidates,
}) => {
  return (
    <CardRoot>
      <HeaderRow>
        <Pill $tone="violet">{TYPE_LABELS[challengeType]}</Pill>
        <Pill $tone="cyan">{dialect.toUpperCase()}</Pill>
        {typeof deltaTTrigger === "number" && (
          <Pill $tone="amber" title="Escalated by output zonotope spread Δ_t > τ">
            Δ_t = {deltaTTrigger.toFixed(2)}
          </Pill>
        )}
      </HeaderRow>

      <Title>{title}</Title>
      <PromptText>{prompt}</PromptText>

      {candidates.length > 0 && (
        <CandidateRow>
          {candidates.map((cand) => {
            const cert = cand.formalCert;
            const allPass =
              cert && cert.gate1GlrSyntax && cert.gate2QudvUnits && cert.gate3SmtFeasibility && cert.gate4DaeBalance;
            return (
              <CandidateTile key={cand.id}>
                <HeaderRow>
                  <strong style={{ fontSize: 12 }}>Candidate {cand.label}</strong>
                  <Pill $tone={allPass ? "emerald" : "rose"}>{allPass ? "4/4 Gates Pass" : "Gate Warning"}</Pill>
                </HeaderRow>
                <span style={{ fontSize: 11, opacity: 0.8, fontFamily: "monospace" }}>
                  m_init = {cand.mInit} · {cand.tokenCount} tokens
                </span>
              </CandidateTile>
            );
          })}
        </CandidateRow>
      )}

      <FooterRow>
        <span style={{ fontSize: 12, color: "var(--ms-text-2, #94a3b8)" }}>
          {annotationCount} verified community {annotationCount === 1 ? "annotation" : "annotations"}
        </span>
        <LaunchLink to={`/annotate/${id}`}>Open Split-View Ansatz Annotator →</LaunchLink>
      </FooterRow>
    </CardRoot>
  );
};

export default RlhfArenaCard;
