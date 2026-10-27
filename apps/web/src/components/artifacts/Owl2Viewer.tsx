// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, OrganizationIcon, PlayIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, renderSourceToDiagramSvg } from "./PolyglotArtifactViewer";

export interface Owl2ViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    ontologyIri?: string | undefined;
    classCount?: number | undefined;
    individualCount?: number | undefined;
    propertyCount?: number | undefined;
    axiomCount?: number | undefined;
    classes?: number | string[] | undefined;
    axioms?: number | undefined;
    individuals?: number | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.35);
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
`;

const SvgCanvas = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  background: var(--color-canvas-inset, #010409);

  svg {
    max-width: 100%;
    max-height: 100%;
    height: auto;
  }
`;

const InspectorSidebar = styled.div`
  width: 250px;
  border-left: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px;
  gap: 12px;
`;

const StatItem = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);

  strong {
    color: var(--color-fg-default, #c9d1d9);
  }
`;

export const Owl2Viewer: React.FC<Owl2ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const title = viewConfig.title || "OWL2 Ontology Graph (.owl)";

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[Owl2Viewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedMetrics = useMemo(() => {
    const classes = new Set<string>();
    const objProps = new Set<string>();
    const individuals = new Set<string>();
    let axioms = 0;

    if (rawText) {
      for (const m of rawText.matchAll(/\bClass\(\s*([A-Za-z0-9_:#/-]+)/g)) classes.add(m[1]!);
      for (const m of rawText.matchAll(/\bObjectProperty\(\s*([A-Za-z0-9_:#/-]+)/g)) objProps.add(m[1]!);
      for (const m of rawText.matchAll(/\bNamedIndividual\(\s*([A-Za-z0-9_:#/-]+)/g)) individuals.add(m[1]!);
      const axiomMatches = rawText.match(
        /\b(Declaration|SubClassOf|EquivalentClasses|DisjointClasses|ObjectPropertyDomain|ObjectPropertyRange|ClassAssertion|ObjectPropertyAssertion)\s*\(/g,
      );
      axioms = axiomMatches ? axiomMatches.length : 0;
    }

    return {
      classCount:
        viewConfig.classCount ??
        (typeof viewConfig.classes === "number"
          ? viewConfig.classes
          : Array.isArray(viewConfig.classes)
            ? viewConfig.classes.length
            : undefined) ??
        classes.size,
      propertyCount: viewConfig.propertyCount ?? objProps.size,
      individualCount: viewConfig.individualCount ?? viewConfig.individuals ?? individuals.size,
      axiomCount: viewConfig.axiomCount ?? viewConfig.axioms ?? axioms,
    };
  }, [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    if (rawText.trim()) {
      return renderSourceToDiagramSvg(rawText, "owl2", title, true).svg;
    }
    return "";
  }, [viewConfig.svg, rawText, title]);

  const codeLines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <OrganizationIcon size={16} fill="#a78bfa" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>OWL2 Ontology</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <Box
            display="flex"
            bg="rgba(0,0,0,0.25)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
          >
            <button
              type="button"
              onClick={() => setViewMode("diagram")}
              style={{
                background: viewMode === "diagram" ? "rgba(139, 92, 246, 0.25)" : "transparent",
                color: viewMode === "diagram" ? "#c4b5fd" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <WorkflowIcon size={12} /> Graph
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "rgba(139, 92, 246, 0.25)" : "transparent",
                color: viewMode === "code" ? "#c4b5fd" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <CodeIcon size={12} /> Source
            </button>
          </Box>
          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "owl2" as any,
                  code: rawText || `Ontology(<http://example.org/ontology>\n)\n`,
                  title,
                });
                const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : viewMode === "diagram" && sanitizedSvg ? (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-inset, #010409)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "36px",
                      minWidth: "36px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-fg-subtle)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                    {highlightPolyglotLine(line, "owl2")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No OWL2 ontology content available.
              </Box>
            )}
          </Box>
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Ontology Metrics
          </Text>
          <StatItem>
            <span>Classes</span>
            <strong>{parsedMetrics.classCount}</strong>
          </StatItem>
          <StatItem>
            <span>Object Properties</span>
            <strong>{parsedMetrics.propertyCount}</strong>
          </StatItem>
          <StatItem>
            <span>Individuals</span>
            <strong>{parsedMetrics.individualCount}</strong>
          </StatItem>
          <StatItem>
            <span>Axioms</span>
            <strong>{parsedMetrics.axiomCount}</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default Owl2Viewer;
