// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphIcon } from "@primer/octicons-react";
import { Spinner, Text, useTheme } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { VegaEmbed } from "react-vega";
import styled from "styled-components";
import Box from "../Box";

interface VegaViewerProps {
  viewConfig: any; // expects { spec: any, data?: any, title?: string }
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
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
  background: rgba(168, 85, 247, 0.12);
  color: var(--color-accent-purple, #a855f7);
  border: 1px solid rgba(168, 85, 247, 0.25);
  font-weight: 600;
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
    display: flex;
    justify-content: center;

    details summary {
      color: var(--color-fg-muted);
      cursor: pointer;
    }
  }
`;

const VegaViewer: React.FC<VegaViewerProps> = ({ viewConfig, isFullScreen }) => {
  const { resolvedColorMode } = useTheme();
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isDark = resolvedColorMode === "dark";
  const title = viewConfig?.title || "Statistical Visualization";

  useEffect(() => {
    async function loadSpec() {
      if (!viewConfig) {
        setError("Missing view configuration");
        setLoading(false);
        return;
      }

      try {
        let loadedSpec = null;
        if (typeof viewConfig.spec === "string") {
          if (viewConfig.spec.startsWith("http") || viewConfig.spec.startsWith("/")) {
            const res = await fetch(viewConfig.spec);
            if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch Vega spec`);
            loadedSpec = await res.json();
          } else {
            loadedSpec = JSON.parse(viewConfig.spec);
          }
        } else if (viewConfig.spec) {
          loadedSpec = JSON.parse(JSON.stringify(viewConfig.spec));
        }

        if (loadedSpec && viewConfig.data) {
          loadedSpec.data = Array.isArray(viewConfig.data) ? { values: viewConfig.data } : viewConfig.data;
        }

        // Apply dark mode & transparent background optimizations
        if (loadedSpec) {
          loadedSpec.background = "transparent";
          if (!loadedSpec.autosize) {
            loadedSpec.autosize = { type: "fit", contains: "padding" };
          }
        }

        setSpec(loadedSpec);
      } catch (err: any) {
        console.error("Failed to load Vega spec", err);
        setError(err.message || "Failed to load Vega spec");
      } finally {
        setLoading(false);
      }
    }

    loadSpec();
  }, [viewConfig]);

  const embedOptions = useMemo(() => {
    return {
      theme: isDark ? ("dark" as const) : undefined,
      renderer: "svg" as const,
      actions: {
        export: true,
        source: false,
        compiled: false,
        editor: false,
      },
      config: {
        background: "transparent",
        autosize: { type: "fit", contains: "padding" },
        axis: isDark
          ? {
              domainColor: "#30363d",
              gridColor: "rgba(255, 255, 255, 0.08)",
              labelColor: "#8b949e",
              tickColor: "#30363d",
              titleColor: "#f1f5f9",
            }
          : undefined,
        legend: isDark
          ? {
              labelColor: "#8b949e",
              titleColor: "#f1f5f9",
            }
          : undefined,
      },
    };
  }, [isDark]);

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
        height={isFullScreen ? "100%" : "340px"}
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
      </Toolbar>

      <PlotContainer>
        <VegaEmbed spec={spec} options={embedOptions as any} />
      </PlotContainer>
    </Wrapper>
  );
};

export default VegaViewer;
