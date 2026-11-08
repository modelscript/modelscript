// SPDX-License-Identifier: AGPL-3.0-or-later

import { GraphIcon, TableIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { VegaEmbed } from "react-vega";
import styled from "styled-components";
import { useTheme } from "../../theme";
import { useThemeTokens } from "../../theme-tokens";
import Box from "../Box";
import Spinner from "../Spinner";
import CsvViewer from "./CsvViewer";

interface VegaViewerProps {
  viewConfig: any; // expects { spec: any, data?: any, title?: string }
  isFullScreen?: boolean | undefined;
}

const SANS_FONT = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";
const MONO_FONT = "JetBrains Mono, monospace";

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 10;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--ms-brand-soft, rgba(8, 145, 178, 0.12));
  color: var(--ms-brand, #0891b2);
  border: 1px solid var(--color-border-default, #30363d);
  font-weight: 600;
`;

const ModeToggleGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border-default, #30363d);
`;

const ModeToggleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  background: ${(p) => (p.$active ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted, #8b949e)")};
  transition:
    background 0.12s ease,
    color 0.12s ease;

  &:hover {
    color: var(--color-fg-default, #f1f5f9);
  }
`;

const PlotContainer = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--color-canvas-default, #0d1117);

  .vega-embed {
    max-width: 100%;
    width: 100%;
    display: flex;
    justify-content: center;

    details summary {
      color: var(--color-fg-muted);
      cursor: pointer;
    }
  }
`;

const VegaViewer: React.FC<VegaViewerProps> = ({ viewConfig, isFullScreen }) => {
  const { theme } = useTheme();
  const tokens = useThemeTokens();
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");

  const title = viewConfig?.title || "Statistical Visualization";

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();
    setError(null);
    setLoading(true);

    async function loadSpec() {
      if (!viewConfig) {
        if (active) {
          setError("Missing view configuration");
          setLoading(false);
        }
        return;
      }

      try {
        let loadedSpec = null;
        if (typeof viewConfig.spec === "string") {
          if (viewConfig.spec.startsWith("http") || viewConfig.spec.startsWith("/")) {
            const res = await fetch(viewConfig.spec, { signal: abortController.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch Vega spec`);
            loadedSpec = await res.json();
          } else {
            loadedSpec = JSON.parse(viewConfig.spec);
          }
        } else if (viewConfig.spec) {
          loadedSpec = JSON.parse(JSON.stringify(viewConfig.spec));
        }

        if (!active || abortController.signal.aborted) return;

        if (loadedSpec && viewConfig.data) {
          const dataValues = Array.isArray(viewConfig.data)
            ? viewConfig.data
            : Array.isArray(viewConfig.data?.values)
              ? viewConfig.data.values
              : null;

          if (Array.isArray(loadedSpec.data)) {
            if (loadedSpec.data.length > 0 && dataValues) {
              loadedSpec.data = [{ ...loadedSpec.data[0], values: dataValues }, ...loadedSpec.data.slice(1)];
            } else if (dataValues) {
              loadedSpec.data = [{ name: "table", values: dataValues }];
            }
          } else {
            loadedSpec.data = Array.isArray(viewConfig.data) ? { values: viewConfig.data } : viewConfig.data;
          }
        }

        // Apply transparent background & responsive fit optimizations
        if (loadedSpec) {
          loadedSpec.background = "transparent";
          if (!loadedSpec.autosize) {
            loadedSpec.autosize = { type: "fit", contains: "padding" };
          }
        }

        if (active) {
          setSpec(loadedSpec);
        }
      } catch (err: any) {
        if (!active || abortController.signal.aborted || err?.name === "AbortError") return;
        console.error("Failed to load Vega spec", err);
        setError(err.message || "Failed to load Vega spec");
      } finally {
        if (active && !abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadSpec();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [viewConfig]);

  const tabularMatrix = useMemo<string[][] | null>(() => {
    const specValues = Array.isArray(spec?.data)
      ? (spec.data.find((d: any) => Array.isArray(d?.values))?.values ?? spec.data[0]?.values)
      : spec?.data?.values;
    const rawValues = Array.isArray(viewConfig?.data) ? viewConfig.data : Array.isArray(specValues) ? specValues : null;
    if (!rawValues || rawValues.length === 0) return null;
    if (Array.isArray(rawValues[0])) {
      return rawValues.map((row: unknown[]) => row.map((cell) => String(cell ?? "")));
    }
    if (typeof rawValues[0] === "object" && rawValues[0] !== null) {
      const headerSet = new Set<string>();
      for (const r of rawValues as Record<string, unknown>[]) {
        if (r && typeof r === "object") {
          for (const k of Object.keys(r)) {
            headerSet.add(k);
          }
        }
      }
      const headers = Array.from(headerSet);
      if (headers.length === 0) return null;
      const rows = rawValues.map((r: Record<string, unknown>) =>
        headers.map((h) => (r?.[h] === null || r?.[h] === undefined ? "" : String(r[h]))),
      );
      return [headers, ...rows];
    }
    return null;
  }, [viewConfig?.data, spec]);

  const hasTabularData = Boolean(
    tabularMatrix || typeof viewConfig?.rawData === "string" || typeof viewConfig?.sourceUrl === "string",
  );

  const embedOptions = useMemo(() => {
    return {
      renderer: "svg" as const,
      actions: {
        export: true,
        source: false,
        compiled: false,
        editor: false,
      },
      config: {
        background: "transparent",
        font: SANS_FONT,
        autosize: { type: "fit", contains: "padding" },
        axis: {
          domainColor: tokens.borderStrong,
          gridColor: tokens.divider,
          labelColor: tokens.textSecondary,
          tickColor: tokens.borderStrong,
          titleColor: tokens.textPrimary,
          labelFont: SANS_FONT,
          titleFont: SANS_FONT,
        },
        legend: {
          labelColor: tokens.textSecondary,
          titleColor: tokens.textPrimary,
          labelFont: SANS_FONT,
          titleFont: SANS_FONT,
        },
        title: {
          color: tokens.textPrimary,
          subtitleColor: tokens.textSecondary,
          font: SANS_FONT,
          subtitleFont: MONO_FONT,
        },
        range: {
          category: [
            tokens.domains.core.color,
            tokens.domains.power.color,
            tokens.domains.fluid.color,
            tokens.domains.mechanics.color,
            tokens.domains.aero.color,
            tokens.domains.cad.color,
            tokens.domains.bio.color,
            tokens.domains.med.color,
          ],
        },
      },
    };
  }, [tokens, theme]);

  if (loading) {
    return (
      <Box
        p={4}
        backgroundColor="var(--color-canvas-subtle)"
        borderRadius="8px"
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        height={isFullScreen ? "100%" : "440px"}
        gap={2}
      >
        <Spinner size="medium" />
        <Text fontSize="12.5px" color="var(--color-fg-muted)">
          Rendering visualization...
        </Text>
      </Box>
    );
  }

  if (error || !spec) {
    return (
      <Box
        p={3}
        backgroundColor="var(--color-canvas-subtle)"
        borderRadius="8px"
        border="1px solid var(--color-border-default)"
      >
        <Text color="var(--color-danger-fg)" fontWeight="bold">
          Vega Plot Error:
        </Text>
        <Text color="var(--color-fg-muted)" fontSize="12px" display="block" mt={1}>
          {error || "Invalid Vega specification"}
        </Text>
      </Box>
    );
  }

  const isVegaLite = spec.$schema && spec.$schema.includes("vega-lite");

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <GraphIcon size={13} />
            {isVegaLite ? "VEGA-LITE" : "VEGA"}
          </Badge>
          <Text
            fontWeight="bold"
            fontSize="12.5px"
            color="var(--color-fg-default)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
        </Box>

        {hasTabularData && (
          <ModeToggleGroup role="tablist" aria-label="Vega view mode">
            <ModeToggleButton
              type="button"
              role="tab"
              aria-selected={activeTab === "chart"}
              $active={activeTab === "chart"}
              onClick={() => setActiveTab("chart")}
              title="Show Vega-Lite Visualization"
            >
              <GraphIcon size={12} />
              <span>Chart</span>
            </ModeToggleButton>
            <ModeToggleButton
              type="button"
              role="tab"
              aria-selected={activeTab === "table"}
              $active={activeTab === "table"}
              onClick={() => setActiveTab("table")}
              title="Inspect Underlying Tabular Dataset"
            >
              <TableIcon size={12} />
              <span>Data ({tabularMatrix ? tabularMatrix.length - 1 : "Table"})</span>
            </ModeToggleButton>
          </ModeToggleGroup>
        )}
      </Toolbar>

      {activeTab === "table" && hasTabularData ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <CsvViewer
            viewConfig={{
              title,
              initialMode: "table",
              data: tabularMatrix ?? (typeof viewConfig?.rawData === "string" ? viewConfig.rawData : undefined),
              url: typeof viewConfig?.sourceUrl === "string" ? viewConfig.sourceUrl : undefined,
            }}
            isFullScreen={isFullScreen}
          />
        </div>
      ) : (
        <PlotContainer>
          <VegaEmbed
            spec={spec}
            options={embedOptions as unknown as React.ComponentProps<typeof VegaEmbed>["options"]}
            onError={(err: any) => setError(err?.message || "Vega rendering error")}
          />
        </PlotContainer>
      )}
    </Wrapper>
  );
};

export default VegaViewer;
