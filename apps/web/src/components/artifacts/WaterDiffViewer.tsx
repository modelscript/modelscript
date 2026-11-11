// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  diffEpanetNetworks,
  diffSwmmNetworks,
  renderEpanetDiffSvg,
  type EpanetNetworkDiff,
} from "@modelscript/diagram/water-network-diff";
import { parseInp } from "@modelscript/epanet";
import { parseSwmm } from "@modelscript/swmm";
import { DiffIcon, DownloadIcon, EyeIcon, TableIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton, SegmentedControl, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { useThemeTokens } from "../../theme-tokens";

export interface WaterDiffViewerProps {
  baseInp: string;
  targetInp: string;
  kind?: "epanet" | "swmm" | undefined;
  baseTitle?: string | undefined;
  targetTitle?: string | undefined;
  height?: number | string | undefined;
  onClose?: (() => void) | undefined;
}

type ViewMode = "diff" | "table";

const Container = styled.div<{ $height?: number | string | undefined }>`
  position: relative;
  width: 100%;
  height: ${({ $height }) => (typeof $height === "number" ? `${$height}px` : $height || "580px")};
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface-hud, var(--color-canvas-subtle, rgba(22, 27, 34, 0.95)));
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  z-index: 10;
  gap: 12px;
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Badge = styled.span<{ $bg: string; $color: string }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 12px;
  background: ${({ $bg }) => $bg};
  color: ${({ $color }) => $color};
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const ViewportArea = styled.div`
  flex: 1;
  position: relative;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-canvas-inset, #010409);
`;

const SvgCanvasWrapper = styled.div`
  padding: 16px;
  svg {
    max-width: 100%;
    height: auto;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
  }
`;

const TableContainer = styled.div`
  width: 100%;
  height: 100%;
  padding: 20px;
  overflow: auto;
  color: var(--color-fg-default, #c9d1d9);
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--fontStack-monospace, monospace);

  th,
  td {
    padding: 8px 12px;
    border: 1px solid var(--color-border-default, #30363d);
    text-align: left;
  }

  th {
    background: var(--color-canvas-subtle, #161b22);
    font-weight: 600;
  }

  tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }
`;

export const WaterDiffViewer: React.FC<WaterDiffViewerProps> = ({
  baseInp,
  targetInp,
  kind = "epanet",
  baseTitle,
  targetTitle,
  height,
  onClose,
}) => {
  const { isDark } = useThemeTokens();
  const [viewMode, setViewMode] = useState<ViewMode>("diff");

  const diffResult = useMemo(() => {
    try {
      if (kind === "swmm") {
        const baseNet = parseSwmm(baseInp);
        const targetNet = parseSwmm(targetInp);
        return {
          kind: "swmm" as const,
          diff: diffSwmmNetworks(baseNet, targetNet),
          error: null,
        };
      } else {
        const baseNet = parseInp(baseInp, baseTitle || "base.inp");
        const targetNet = parseInp(targetInp, targetTitle || "target.inp");
        return {
          kind: "epanet" as const,
          diff: diffEpanetNetworks(baseNet, targetNet),
          error: null,
        };
      }
    } catch (err: unknown) {
      return {
        kind,
        diff: null,
        error: (err as Error).message || "Failed to parse network decks for diff",
      };
    }
  }, [baseInp, targetInp, kind, baseTitle, targetTitle]);

  const diffSvg = useMemo(() => {
    if (!diffResult.diff || diffResult.kind !== "epanet") return "";
    return renderEpanetDiffSvg(diffResult.diff as EpanetNetworkDiff, {
      theme: isDark ? "dark" : "light",
    });
  }, [diffResult, isDark]);

  const cleanSvg = useMemo(() => {
    if (!diffSvg) return "";
    return DOMPurify.sanitize(diffSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["filter", "feDropShadow"],
      ADD_ATTR: ["style", "class", "id", "xmlns", "viewBox", "filter", "dx", "dy", "stdDeviation", "flood-opacity"],
    });
  }, [diffSvg]);

  const handleDownloadSvg = () => {
    if (!diffSvg) return;
    const blob = new Blob([diffSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `water-network-diff-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    if (!diffResult.diff) return;
    const blob = new Blob([JSON.stringify(diffResult.diff, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `water-network-diff-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (diffResult.error) {
    return (
      <Container $height={height}>
        <Toolbar>
          <Text sx={{ fontWeight: 600, color: "danger.fg" }}>Water Network Diff Error</Text>
          {onClose && <IconButton aria-label="Close" icon={XIcon} size="small" onClick={onClose} />}
        </Toolbar>
        <ViewportArea>
          <Text sx={{ color: "danger.fg", p: 4 }}>{diffResult.error}</Text>
        </ViewportArea>
      </Container>
    );
  }

  const stats = diffResult.diff?.stats;

  return (
    <Container $height={height}>
      <Toolbar>
        <ToolbarGroup>
          <DiffIcon size={16} />
          <Text sx={{ fontWeight: 600, fontSize: 13 }}>
            {kind === "swmm" ? "SWMM Drainage Diff" : "EPANET Hydraulic Diff"}
          </Text>
          {stats && (
            <>
              <Badge $bg="rgba(35, 134, 54, 0.2)" $color="#3fb950">
                +{stats.addedNodes + stats.addedLinks} added
              </Badge>
              <Badge $bg="rgba(218, 54, 51, 0.2)" $color="#f85149">
                -{stats.deletedNodes + stats.deletedLinks} deleted
              </Badge>
              <Badge $bg="rgba(210, 153, 34, 0.2)" $color="#d29922">
                ~{stats.modifiedNodes + stats.modifiedLinks} modified
              </Badge>
              {stats.maxPressureDeltaM !== undefined && stats.maxPressureDeltaM > 0 && (
                <Badge $bg="rgba(56, 139, 253, 0.2)" $color="#58a6ff">
                  ΔP: +{stats.maxPressureDeltaM.toFixed(1)}m
                </Badge>
              )}
            </>
          )}
        </ToolbarGroup>

        <ToolbarGroup>
          <SegmentedControl aria-label="Diff view mode">
            <SegmentedControl.Button
              selected={viewMode === "diff"}
              onClick={() => setViewMode("diff")}
              leadingIcon={EyeIcon}
            >
              Visual Diff
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={viewMode === "table"}
              onClick={() => setViewMode("table")}
              leadingIcon={TableIcon}
            >
              Changes Table
            </SegmentedControl.Button>
          </SegmentedControl>

          {diffSvg && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadSvg}>
              Export SVG
            </Button>
          )}
          <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadJson}>
            Export JSON
          </Button>

          {onClose && <IconButton aria-label="Close" icon={XIcon} size="small" onClick={onClose} />}
        </ToolbarGroup>
      </Toolbar>

      <ViewportArea>
        {viewMode === "diff" ? (
          <SvgCanvasWrapper dangerouslySetInnerHTML={{ __html: cleanSvg }} />
        ) : (
          <TableContainer>
            <Table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Attribute Changes & Hydraulic Delta</th>
                </tr>
              </thead>
              <tbody>
                {diffResult.diff &&
                  Array.from(diffResult.diff.nodes.values()).map((node) => (
                    <tr key={`node-${node.id}`}>
                      <td>Node ({node.type})</td>
                      <td>{node.id}</td>
                      <td>
                        <span
                          style={{
                            color:
                              node.status === "added"
                                ? "#3fb950"
                                : node.status === "deleted"
                                  ? "#f85149"
                                  : node.status === "modified"
                                    ? "#d29922"
                                    : "#8b949e",
                            fontWeight: 600,
                          }}
                        >
                          {node.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {node.propertyDeltas.length > 0
                          ? node.propertyDeltas
                              .map(
                                (d) =>
                                  `${d.property}: ${d.baseValue} -> ${d.targetValue} (${(d.delta ?? 0) >= 0 ? "+" : ""}${d.delta})`,
                              )
                              .join("; ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                {diffResult.diff &&
                  Array.from(diffResult.diff.links.values()).map((link) => (
                    <tr key={`link-${link.id}`}>
                      <td>Link ({link.type})</td>
                      <td>{link.id}</td>
                      <td>
                        <span
                          style={{
                            color:
                              link.status === "added"
                                ? "#3fb950"
                                : link.status === "deleted"
                                  ? "#f85149"
                                  : link.status === "modified"
                                    ? "#d29922"
                                    : "#8b949e",
                            fontWeight: 600,
                          }}
                        >
                          {link.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {link.propertyDeltas.length > 0
                          ? link.propertyDeltas
                              .map(
                                (d) =>
                                  `${d.property}: ${d.baseValue} -> ${d.targetValue} (${(d.delta ?? 0) >= 0 ? "+" : ""}${d.delta})`,
                              )
                              .join("; ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </TableContainer>
        )}
      </ViewportArea>
    </Container>
  );
};
