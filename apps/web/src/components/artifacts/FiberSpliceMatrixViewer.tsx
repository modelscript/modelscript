// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

export interface FiberSpliceEntry {
  inStrand: number;
  outStrand: number;
  lossDb: number;
  spliceType?: "fusion" | "mechanical" | undefined;
  trayNumber?: number | undefined;
  operator?: string | undefined;
}

export interface FiberSpliceMatrixViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    title?: string | undefined;
    inCableName?: string | undefined;
    outCableName?: string | undefined;
    inStrandCount?: number | undefined;
    outStrandCount?: number | undefined;
    splices?: FiberSpliceEntry[] | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const TIA_598_COLORS = [
  { num: 1, name: "Blue", hex: "#0055FF", textDark: false },
  { num: 2, name: "Orange", hex: "#FF8800", textDark: true },
  { num: 3, name: "Green", hex: "#00AA00", textDark: false },
  { num: 4, name: "Brown", hex: "#8B4513", textDark: false },
  { num: 5, name: "Slate", hex: "#708090", textDark: false },
  { num: 6, name: "White", hex: "#FFFFFF", textDark: true },
  { num: 7, name: "Red", hex: "#EE0000", textDark: false },
  { num: 8, name: "Black", hex: "#1A1A1A", textDark: false },
  { num: 9, name: "Yellow", hex: "#FFDD00", textDark: true },
  { num: 10, name: "Violet", hex: "#8A2BE2", textDark: false },
  { num: 11, name: "Rose", hex: "#FF69B4", textDark: true },
  { num: 12, name: "Aqua", hex: "#00CED1", textDark: true },
];

function getStrandColorInfo(strand1Based: number) {
  const zeroBased = Math.max(0, strand1Based - 1);
  const tubeIndex = Math.floor(zeroBased / 12);
  const fiberIndex = zeroBased % 12;
  const tubeCol = TIA_598_COLORS[tubeIndex % 12]!;
  const fiberCol = TIA_598_COLORS[fiberIndex % 12]!;
  const hasTracer = tubeIndex >= 12 || fiberIndex >= 12;
  return {
    tubeNum: tubeIndex + 1,
    tubeColor: tubeCol,
    fiberNum: fiberIndex + 1,
    fiberColor: fiberCol,
    hasTracer,
  };
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "520px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "400")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  background: ${(props) => (props.$active ? "var(--color-canvas-default)" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "var(--color-border-default)" : "transparent")};
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    background: var(--color-canvas-default);
  }
`;

const ContentArea = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ColorSwatchBadge = styled.span<{ $bgColor: string; $isDark: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background-color: ${(props) => props.$bgColor};
  color: ${(props) => (props.$isDark ? "#111" : "#fff")};
  border: 1px solid rgba(0, 0, 0, 0.15);
  min-width: 60px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    padding: 8px 10px;
    border: 1px solid var(--color-border-muted);
    text-align: left;
  }

  th {
    background: var(--color-canvas-subtle);
    font-weight: 600;
    color: var(--color-fg-muted);
  }

  tr:hover td {
    background: var(--color-canvas-subtle);
  }
`;

const LossPill = styled.span<{ $loss: number }>`
  display: inline-block;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: ${(props) =>
    props.$loss <= 0.1
      ? "var(--color-success-subtle, #dafbe1)"
      : props.$loss <= 0.3
        ? "var(--color-attention-subtle, #fff8c5)"
        : "var(--color-danger-subtle, #ffebe9)"};
  color: ${(props) =>
    props.$loss <= 0.1
      ? "var(--color-success-fg, #1a7f37)"
      : props.$loss <= 0.3
        ? "var(--color-attention-fg, #9a6700)"
        : "var(--color-danger-fg, #cf222e)"};
`;

const StatCard = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const FiberSpliceMatrixViewer: React.FC<FiberSpliceMatrixViewerProps> = ({
  viewConfig,
  isFullScreen = false,
}) => {
  const [activeTab, setActiveTab] = useState<"matrix" | "colors" | "stats">("matrix");
  const [copied, setCopied] = useState(false);
  const [selectedStrand, setSelectedStrand] = useState<number>(1);

  const inCable = viewConfig.inCableName ?? "Cable-Alpha (72F)";
  const outCable = viewConfig.outCableName ?? "Cable-Bravo (72F)";
  const strandCount = viewConfig.inStrandCount ?? 24;

  const splices = useMemo<FiberSpliceEntry[]>(() => {
    if (viewConfig.splices && viewConfig.splices.length > 0) {
      return viewConfig.splices;
    }
    // Generate deterministic default splice schedule
    const result: FiberSpliceEntry[] = [];
    for (let i = 1; i <= strandCount; i++) {
      // Deterministic loss between 0.02 and 0.28 dB with occasional higher loss
      const pseudoLoss = 0.03 + ((i * 37) % 25) * 0.01;
      result.push({
        inStrand: i,
        outStrand: i,
        lossDb: Math.round(pseudoLoss * 100) / 100,
        spliceType: "fusion",
        trayNumber: Math.floor((i - 1) / 12) + 1,
      });
    }
    return result;
  }, [viewConfig.splices, strandCount]);

  const stats = useMemo(() => {
    if (splices.length === 0) return { meanLoss: 0, maxLoss: 0, passCount: 0, passRate: 100 };
    const losses = splices.map((s) => s.lossDb);
    const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
    const max = Math.max(...losses);
    const pass = losses.filter((l) => l <= 0.3).length;
    return {
      meanLoss: Math.round(mean * 100) / 100,
      maxLoss: Math.round(max * 100) / 100,
      passCount: pass,
      passRate: Math.round((pass / losses.length) * 1000) / 10,
    };
  }, [splices]);

  const handleCopy = () => {
    const text = JSON.stringify({ inCable, outCable, splices, stats }, null, 2);
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedColor = getStrandColorInfo(selectedStrand);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <ToolbarGroup>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-default)" }}>
            {viewConfig.title ?? "Fiber Splice Matrix & TIA-598-D Color Code"}
          </span>
        </ToolbarGroup>
        <ToolbarGroup>
          <TabButton $active={activeTab === "matrix"} onClick={() => setActiveTab("matrix")}>
            Splice Matrix ({splices.length})
          </TabButton>
          <TabButton $active={activeTab === "colors"} onClick={() => setActiveTab("colors")}>
            TIA-598-D Code
          </TabButton>
          <TabButton $active={activeTab === "stats"} onClick={() => setActiveTab("stats")}>
            Statistics
          </TabButton>
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={handleCopy}
            aria-label="Copy splice schedule"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <ContentArea>
        {activeTab === "matrix" && (
          <Box display="flex" flexDirection="column" gap={12}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                In: <strong>{inCable}</strong> ➔ Out: <strong>{outCable}</strong>
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Telcordia Pass Rate: <strong>{stats.passRate}%</strong> (≤ 0.30 dB)
              </span>
            </div>

            <Table>
              <thead>
                <tr>
                  <th>Tray</th>
                  <th>In-Strand</th>
                  <th>In Color</th>
                  <th>Out-Strand</th>
                  <th>Out Color</th>
                  <th>Loss (dB)</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {splices.map((s) => {
                  const inCol = getStrandColorInfo(s.inStrand);
                  const outCol = getStrandColorInfo(s.outStrand);
                  const isPass = s.lossDb <= 0.3;
                  return (
                    <tr key={s.inStrand}>
                      <td>Tray #{s.trayNumber ?? 1}</td>
                      <td>#{s.inStrand}</td>
                      <td>
                        <ColorSwatchBadge $bgColor={inCol.fiberColor.hex} $isDark={inCol.fiberColor.textDark}>
                          {inCol.fiberColor.name}
                        </ColorSwatchBadge>
                      </td>
                      <td>#{s.outStrand}</td>
                      <td>
                        <ColorSwatchBadge $bgColor={outCol.fiberColor.hex} $isDark={outCol.fiberColor.textDark}>
                          {outCol.fiberColor.name}
                        </ColorSwatchBadge>
                      </td>
                      <td>
                        <LossPill $loss={s.lossDb}>{s.lossDb.toFixed(2)} dB</LossPill>
                      </td>
                      <td>{s.spliceType ?? "fusion"}</td>
                      <td>
                        <span
                          style={{
                            color: isPass ? "var(--color-success-fg, #1a7f37)" : "var(--color-danger-fg, #cf222e)",
                            fontWeight: 600,
                          }}
                        >
                          {isPass ? "✓ Pass" : "⚠ Fail"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Box>
        )}

        {activeTab === "colors" && (
          <Box display="flex" flexDirection="column" gap={16}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Interactive Strand Inspector:</span>
              <input
                type="number"
                min={1}
                max={144}
                value={selectedStrand}
                onChange={(e) => setSelectedStrand(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: "70px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border-default)",
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Tube #{selectedColor.tubeNum} ({selectedColor.tubeColor.name}) ➔ Fiber #{selectedColor.fiberNum} (
                {selectedColor.fiberColor.name}){selectedColor.hasTracer ? " [Tracer Stripe]" : ""}
              </span>
            </div>

            <span style={{ fontSize: "13px", fontWeight: 600 }}>ANSI/TIA-598-D 12-Color Sequence:</span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: "10px",
              }}
            >
              {TIA_598_COLORS.map((c) => (
                <div
                  key={c.num}
                  style={{
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "6px",
                    padding: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      height: "28px",
                      borderRadius: "4px",
                      background: c.hex,
                      border: "1px solid rgba(0,0,0,0.15)",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <span>
                      #{c.num} {c.name}
                    </span>
                    <span style={{ color: "var(--color-fg-muted)" }}>{c.hex}</span>
                  </div>
                </div>
              ))}
            </div>
          </Box>
        )}

        {activeTab === "stats" && (
          <Box display="flex" flexDirection="column" gap={16}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "12px",
              }}
            >
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Total Splices</span>
                <span style={{ fontSize: "20px", fontWeight: 700 }}>{splices.length}</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Mean Loss</span>
                <span style={{ fontSize: "20px", fontWeight: 700 }}>{stats.meanLoss} dB</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Max Loss</span>
                <span style={{ fontSize: "20px", fontWeight: 700 }}>{stats.maxLoss} dB</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Telcordia Pass Rate</span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "var(--color-success-fg, #1a7f37)",
                  }}
                >
                  {stats.passRate}%
                </span>
              </StatCard>
            </div>
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default FiberSpliceMatrixViewer;
