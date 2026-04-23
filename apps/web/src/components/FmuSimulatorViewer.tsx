// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU Simulator Viewer Component
 *
 * Interactive panel for viewing FMU artifact metadata.
 * When WASM is available, provides a parameter panel and simulation plots.
 * Otherwise shows a read-only summary of model variables and platforms.
 */

import { Label, Text } from "@primer/react";
import React, { useState } from "react";
import styled, { css, keyframes } from "styled-components";

/* ─── types ─── */

interface FmuVariable {
  name: string;
  valueReference: number;
  causality: string;
  variability: string;
  description?: string;
  type: string;
  start?: string;
  unit?: string;
}

interface FmuViewerProps {
  config: {
    fmiVersion?: string;
    modelName?: string;
    hasWasm?: boolean;
    inputs?: FmuVariable[];
    outputs?: FmuVariable[];
    parameters?: FmuVariable[];
    platforms?: string[];
  };
  artifactPath: string;
}

/* ─── styled ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const glassCard = css`
  background: var(--color-glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
`;

const ViewerWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 16px;
  animation: ${fadeIn} 0.3s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
`;

const Title = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Badges = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const PlatformBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.2);
`;

const WasmBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(139, 92, 246, 0.15);
  color: #8b5cf6;
  border: 1px solid rgba(139, 92, 246, 0.25);
`;

const VariableSection = styled.div`
  margin-bottom: 16px;
`;

const SectionLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
`;

const VarTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 6px 10px;
    color: var(--color-text-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--color-border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  td {
    padding: 6px 10px;
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: var(--color-glass-bg-hover);
  }
`;

const TabRow = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
`;

const VarTab = styled.button<{ $active: boolean }>`
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  border-bottom: 2px solid ${(p) => (p.$active ? "var(--color-accent, #6366f1)" : "transparent")};
  margin-bottom: -1px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text-heading);
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 24px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-style: italic;
`;

/* ─── component ─── */

type VarTabId = "parameters" | "inputs" | "outputs";

const FmuSimulatorViewer: React.FC<FmuViewerProps> = ({ config, artifactPath }) => {
  const [activeVarTab, setActiveVarTab] = useState<VarTabId>("parameters");

  const { fmiVersion, modelName, hasWasm, inputs, outputs, parameters, platforms } = config;

  const tabVars: Record<VarTabId, FmuVariable[]> = {
    parameters: parameters ?? [],
    inputs: inputs ?? [],
    outputs: outputs ?? [],
  };

  const currentVars = tabVars[activeVarTab];

  return (
    <ViewerWrap>
      <Header>
        <Title>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          {modelName || artifactPath}
        </Title>
        <Badges>
          {fmiVersion && (
            <Label variant="accent" style={{ fontSize: 11, padding: "2px 8px" }}>
              FMI {fmiVersion}
            </Label>
          )}
          {hasWasm && <WasmBadge>⚡ WASM</WasmBadge>}
          {platforms?.map((p) => (
            <PlatformBadge key={p}>{p}</PlatformBadge>
          ))}
        </Badges>
      </Header>

      {/* Variable tabs */}
      <TabRow>
        {(["parameters", "inputs", "outputs"] as VarTabId[]).map((tab) => (
          <VarTab key={tab} $active={activeVarTab === tab} onClick={() => setActiveVarTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tabVars[tab].length > 0 && (
              <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", marginLeft: 6 }}>
                {tabVars[tab].length}
              </Label>
            )}
          </VarTab>
        ))}
      </TabRow>

      {/* Variable table */}
      {currentVars.length > 0 ? (
        <VariableSection>
          <VarTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Start</th>
                <th>Unit</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {currentVars.map((v) => (
                <tr key={v.valueReference}>
                  <td style={{ fontWeight: 500, color: "var(--color-text-heading)" }}>{v.name}</td>
                  <td>
                    <Label variant="secondary" style={{ fontSize: 10, padding: "1px 6px" }}>
                      {v.type}
                    </Label>
                  </td>
                  <td>{v.start ?? "—"}</td>
                  <td style={{ color: "var(--color-text-muted)" }}>{v.unit ?? "—"}</td>
                  <td
                    style={{
                      color: "var(--color-text-muted)",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {v.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </VarTable>
        </VariableSection>
      ) : (
        <EmptyState>No {activeVarTab} defined for this model.</EmptyState>
      )}

      {/* WASM simulation hint */}
      {hasWasm && (
        <VariableSection>
          <SectionLabel>In-Browser Simulation</SectionLabel>
          <Text style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            This FMU includes a WebAssembly binary. In-browser simulation with interactive parameter tuning and live
            plots will be available in a future release.
          </Text>
        </VariableSection>
      )}
    </ViewerWrap>
  );
};

export default FmuSimulatorViewer;
