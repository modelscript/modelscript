// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderPolyglotDiagramToSvg } from "@modelscript/diagram/svg";
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, PlayIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Label, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";

export interface PolyglotArtifactViewerProps {
  viewConfig: any;
  viewType?: string;
  artifactId?: string | number;
}

export function sanitizeSvgMarkup(rawSvg: string): string {
  if (!rawSvg) return "";
  return DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use", "foreignObject"],
    ADD_ATTR: ["target", "xlink:href", "viewBox", "preserveAspectRatio", "marker-end", "marker-start"],
  });
}

export function renderSourceToDiagramSvg(
  content: string,
  dslLang: string,
  fallbackTitle = "Artifact",
  isDark = true,
): { svg: string; nodeCount: number; edgeCount: number } {
  if (!content || !content.trim()) {
    return { svg: "", nodeCount: 0, edgeCount: 0 };
  }

  const nodes: {
    id: string;
    label: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    ports: { id: string; name: string; side: "left" | "right" | "top" | "bottom"; offset: number }[];
  }[] = [];
  const edges: {
    id: string;
    source: string;
    sourcePort?: string;
    target: string;
    targetPort?: string;
    label?: string;
  }[] = [];

  const seenIds = new Set<string>();
  const addNode = (id: string, type: string, label?: string) => {
    const cleanId = id.trim();
    if (!cleanId || seenIds.has(cleanId) || nodes.length >= 28) return;
    seenIds.add(cleanId);
    const idx = nodes.length;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    nodes.push({
      id: cleanId,
      label: label || cleanId,
      type,
      position: { x: 60 + col * 210, y: 60 + row * 120 },
      size: { width: 150, height: 68 },
      ports: [
        { id: `${cleanId}.in`, name: "in", side: "left", offset: 0.5 },
        { id: `${cleanId}.out`, name: "out", side: "right", offset: 0.5 },
      ],
    });
  };

  const declPatterns = [
    /\b(?:part|item|port|action|state|requirement|attribute|package|block|model|class|connector|record|function|module|subroutine|entity|coupl|body|joint|force|vessel|line|pipe|node|compressor|branch|cylinder|chamber|subcircuit)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_.-]*)/gi,
    /^\s*(?:parameter\s+|constant\s+|discrete\s+)?([A-Z][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|=|;)/gm,
    /<(?:ssd:Component|Component|SubSystem|SW-COMPONENT-PROTOTYPE|SPEC-OBJECT|link|joint|road|junction|species|reaction|Entity|Part)\b[^>]*\b(?:name|id|SHORT-NAME)=["']([^"']+)["']/gi,
    /^\s*([RLCVGQMXJ]\w+)\s+(\w+)\s+(\w+)/gm,
  ];

  for (const re of declPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[3] && m[1] && m[2]) {
        // SPICE element: R1 n1 n2
        const compId = m[1];
        const n1 = m[2];
        const n2 = m[3];
        addNode(compId, "Element", compId);
        if (n1 !== "0") {
          addNode(n1, "Net", `Net ${n1}`);
          edges.push({
            id: `e-${edges.length + 1}`,
            source: n1,
            sourcePort: `${n1}.out`,
            target: compId,
            targetPort: `${compId}.in`,
          });
        }
        if (n2 !== "0") {
          addNode(n2, "Net", `Net ${n2}`);
          edges.push({
            id: `e-${edges.length + 1}`,
            source: compId,
            sourcePort: `${compId}.out`,
            target: n2,
            targetPort: `${n2}.in`,
          });
        }
      } else if (m[2]) {
        addNode(m[2], m[1] || dslLang, `${m[2]} : ${m[1]}`);
      } else if (m[1]) {
        addNode(m[1], dslLang, m[1]);
      }
    }
  }

  // Connections: connect(a.p, b.n), XML <ssd:Connection startElement="a" endElement="b">, SubClassOf(:A :B)
  const connRe =
    /\bconnect\s*\(\s*([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?\s*,\s*([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?\s*\)/g;
  let cm: RegExpExecArray | null;
  while ((cm = connRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    addNode(src, dslLang);
    addNode(tgt, dslLang);
    edges.push({
      id: `e-${edges.length + 1}`,
      source: src,
      sourcePort: `${src}.out`,
      target: tgt,
      targetPort: `${tgt}.in`,
    });
  }

  const ssdConnRe = /<(?:ssd:)?Connection\b[^>]*startElement=["']([^"']+)["'][^>]*endElement=["']([^"']+)["']/gi;
  while ((cm = ssdConnRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    addNode(src, "Component");
    addNode(tgt, "Component");
    edges.push({
      id: `e-${edges.length + 1}`,
      source: src,
      sourcePort: `${src}.out`,
      target: tgt,
      targetPort: `${tgt}.in`,
    });
  }

  const owlRe =
    /\b(?:SubClassOf|EquivalentClasses|ObjectPropertyDomain|ObjectPropertyRange)\s*\(\s*:?([A-Za-z0-9_#-]+)\s+:?([A-Za-z0-9_#-]+)\s*\)/g;
  while ((cm = owlRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    addNode(src, "Class", src);
    addNode(tgt, "Class", tgt);
    edges.push({
      id: `e-${edges.length + 1}`,
      source: src,
      sourcePort: `${src}.out`,
      target: tgt,
      targetPort: `${tgt}.in`,
    });
  }

  if (nodes.length === 0) {
    addNode(fallbackTitle || dslLang, dslLang, `${fallbackTitle || dslLang} (${dslLang.toUpperCase()})`);
  }

  try {
    const rawSvg = renderPolyglotDiagramToSvg(
      {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
      } as any,
      { theme: isDark ? "dark" : "light" },
    );
    return { svg: sanitizeSvgMarkup(rawSvg), nodeCount: nodes.length, edgeCount: edges.length };
  } catch {
    return { svg: "", nodeCount: nodes.length, edgeCount: edges.length };
  }
}

const Container = styled(Box)`
  display: flex;
  flex-direction: column;
  background-color: var(--color-canvas-subtle);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
`;

const Toolbar = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background-color: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-muted);
  flex-wrap: wrap;
  gap: 8px;
`;

const ToggleGroup = styled.div`
  display: inline-flex;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const ToggleBtn = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  background: ${(p) => (p.$active ? "var(--color-accent-subtle)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg)" : "var(--color-fg-muted)")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
  }
`;

const ContentGrid = styled(Box)`
  display: grid;
  grid-template-columns: 1fr 270px;
  min-height: 360px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const DiagramPane = styled(Box)`
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: radial-gradient(circle at center, var(--color-canvas-default) 0%, var(--color-canvas-subtle) 100%);
  position: relative;
  overflow: hidden;
  min-height: 340px;
`;

const CodePane = styled.div`
  background: var(--color-canvas-default);
  overflow: auto;
  max-height: 460px;
  min-height: 340px;
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 12px 0;
`;

const CodeLine = styled.div`
  display: flex;
  padding: 0 16px;
  &:hover {
    background: var(--color-canvas-subtle);
  }
`;

const LineNo = styled.span`
  user-select: none;
  width: 40px;
  min-width: 40px;
  text-align: right;
  padding-right: 14px;
  color: var(--color-fg-subtle);
  font-size: 11px;
`;

const LineText = styled.span`
  white-space: pre;
  color: var(--color-fg-default);
`;

const Sidebar = styled(Box)`
  padding: 16px;
  background-color: var(--color-canvas-default);
  border-left: 1px solid var(--color-border-muted);
  display: flex;
  flex-direction: column;
  gap: 12px;

  @media (max-width: 768px) {
    border-left: none;
    border-top: 1px solid var(--color-border-muted);
  }
`;

const StatBox = styled(Box)`
  padding: 10px 12px;
  background-color: var(--color-canvas-subtle);
  border-radius: 6px;
  border: 1px solid var(--color-border-muted);
`;

const DOMAIN_META: Record<string, { badge: string; accent: string; commentPrefix: RegExp }> = {
  aspen: { badge: "ASPEN PLUS FLOWSHEET", accent: "#10b981", commentPrefix: /^\s*(;|\*)/ },
  swmm: { badge: "EPA SWMM HYDRAULICS", accent: "#0ea5e9", commentPrefix: /^\s*;/ },
  touchstone: { badge: "TOUCHSTONE S-PARAMS", accent: "#8b5cf6", commentPrefix: /^\s*!/ },
  ibis: { badge: "IBIS I/O BUFFER", accent: "#ec4899", commentPrefix: /^\s*\|/ },
  opendss: { badge: "OPENDSS POWER GRID", accent: "#f59e0b", commentPrefix: /^\s*(!|\/\/)/ },
  openscenario: { badge: "ASAM OPENSCENARIO", accent: "#3b82f6", commentPrefix: /^\s*<!--/ },
  relap5: { badge: "RELAP5 THERMAL-HYDRAULICS", accent: "#ef4444", commentPrefix: /^\s*(\*|=)/ },
  eclipse: { badge: "ECLIPSE RESERVOIR", accent: "#d97706", commentPrefix: /^\s*--/ },
  sbml: { badge: "SBML SYSTEMS BIOLOGY", accent: "#14b8a6", commentPrefix: /^\s*<!--/ },
  jsbsim: { badge: "JSBSIM FLIGHT DYNAMICS", accent: "#6366f1", commentPrefix: /^\s*<!--/ },
  scad: { badge: "OPENSCAD CSG SOLID", accent: "#06b6d4", commentPrefix: /^\s*\/\// },
  csg: { badge: "OPENSCAD CSG SOLID", accent: "#06b6d4", commentPrefix: /^\s*\/\// },
  adams: { badge: "MSC ADAMS MULTIBODY", accent: "#f97316", commentPrefix: /^\s*!/ },
  autosar: { badge: "AUTOSAR ARXML", accent: "#0284c7", commentPrefix: /^\s*<!--/ },
  ccsds: { badge: "CCSDS ORBIT DATA", accent: "#7c3aed", commentPrefix: /^\s*COMMENT\b/i },
  energyplus: { badge: "ENERGYPLUS IDF", accent: "#22c55e", commentPrefix: /^\s*!/ },
  epanet: { badge: "EPANET WATER NETWORK", accent: "#06b6d4", commentPrefix: /^\s*;/ },
  opendrive: { badge: "ASAM OPENDRIVE ROAD", accent: "#64748b", commentPrefix: /^\s*<!--/ },
  plcopen: { badge: "IEC 61131-3 PLCOPEN", accent: "#eab308", commentPrefix: /^\s*(\(\*|\/\/)/ },
  reqif: { badge: "OMG REQIF REQUIREMENTS", accent: "#a855f7", commentPrefix: /^\s*<!--/ },
  simulink: { badge: "SIMULINK BLOCK DIAGRAM", accent: "#f43f5e", commentPrefix: /^\s*(%|<!--)/ },
  spice: { badge: "SPICE CIRCUIT NETLIST", accent: "#f59e0b", commentPrefix: /^\s*\*/ },
  urdf: { badge: "ROS URDF KINEMATICS", accent: "#ec4899", commentPrefix: /^\s*<!--/ },
  "verilog-a": { badge: "VERILOG-A / AMS", accent: "#3b82f6", commentPrefix: /^\s*\/\// },
  c: { badge: "C99 / EMBEDDED SOURCE", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/ },
  fortran: { badge: "FORTRAN 90 NUMERICAL", accent: "#818cf8", commentPrefix: /^\s*(!|c\s|C\s)/ },
  csv: { badge: "TABULAR DATASET (CSV)", accent: "#10b981", commentPrefix: /^\s*#/ },
  gcode: { badge: "CNC G-CODE TOOLPATH", accent: "#f97316", commentPrefix: /^\s*(;|\()/ },
  modelscript: { badge: "MODELSCRIPT (.MSX)", accent: "#06b6d4", commentPrefix: /^\s*\/\// },
  msx: { badge: "MODELSCRIPT (.MSX)", accent: "#06b6d4", commentPrefix: /^\s*\/\// },
};

export function highlightPolyglotLine(line: string, dialect: string): React.ReactNode {
  const meta = DOMAIN_META[dialect];
  if (meta?.commentPrefix.test(line) || /^\s*(#|\/\/|!|;|--|\*)/.test(line)) {
    return <span style={{ color: "var(--color-fg-muted)", fontStyle: "italic" }}>{line}</span>;
  }
  const tokens = line.split(/(\s+|[=,:;(){}[\]<>"]+)/);
  return tokens.map((tok, idx) => {
    if (/^["'].*["']$/.test(tok)) {
      return (
        <span key={idx} style={{ color: "#a5d6ff" }}>
          {tok}
        </span>
      );
    }
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok)) {
      return (
        <span key={idx} style={{ color: "#79c0ff" }}>
          {tok}
        </span>
      );
    }
    if (
      /^(model|block|connector|package|function|equation|algorithm|parameter|input|output|part|port|requirement|connect|module|endmodule|electrical|analog|begin|end|subroutine|program|real|integer|double|precision|void|int|float|double|struct|return|if|else|for|while|switch|case|VAR|VAR_INPUT|VAR_OUTPUT|END_VAR|PROGRAM|END_PROGRAM|FUNCTION_BLOCK|union|difference|intersection|translate|rotate|scale|cylinder|cube|sphere|\.SUBCKT|\.ENDS|\.MODEL|\.TRAN|\.AC|\.DC|\.OP)$/i.test(
        tok,
      )
    ) {
      return (
        <span key={idx} style={{ color: "#ff7b72", fontWeight: 600 }}>
          {tok}
        </span>
      );
    }
    return tok;
  });
}

export const PolyglotArtifactViewer: React.FC<PolyglotArtifactViewerProps> = ({ viewConfig, viewType, artifactId }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const dialect = (viewType || viewConfig?.dialect || "modelica").toLowerCase();
  const meta = DOMAIN_META[dialect] || {
    badge: `${dialect.toUpperCase()} ARTIFACT`,
    accent: "#06b6d4",
    commentPrefix: /^\s*(\/\/|#)/,
  };

  const [fetchedText, setFetchedText] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const [copied, setCopied] = useState(false);

  const inlineCode: string =
    viewConfig?.code ||
    viewConfig?.rawText ||
    viewConfig?.source ||
    (viewConfig?.files ? (Object.values(viewConfig.files)[0] as string) : "") ||
    "";

  useEffect(() => {
    if (!inlineCode && viewConfig?.url) {
      setLoadingText(true);
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedText(txt);
        })
        .catch(() => {})
        .finally(() => setLoadingText(false));
    }
  }, [inlineCode, viewConfig?.url]);

  const rawCode = inlineCode || fetchedText || "";
  const title = viewConfig?.title || viewConfig?.filename || `${dialect.toUpperCase()} Artifact`;
  const isMultiFile = Boolean(viewConfig?.files && Object.keys(viewConfig.files).length > 1);

  const { svgMarkup, parsedStats } = useMemo(() => {
    const stats: { label: string; value: string | number }[] = [];
    const addStat = (label: string, val: unknown) => {
      if (val !== undefined && val !== null && val !== "") {
        stats.push({ label, value: typeof val === "boolean" ? (val ? "Yes" : "No") : String(val) });
      }
    };

    addStat("Blocks", viewConfig?.blockCount);
    addStat("Streams", viewConfig?.streamCount);
    addStat("Junctions", viewConfig?.junctionCount);
    addStat("Conduits", viewConfig?.conduitCount);
    addStat("Ports", viewConfig?.portCount);
    addStat("Passive", viewConfig?.isPassive);
    addStat("Components", viewConfig?.componentCount);
    addStat("Models", viewConfig?.modelCount);
    addStat("Lines", viewConfig?.lineCount);
    addStat("Loads", viewConfig?.loadCount);
    addStat("Transformers", viewConfig?.transformerCount);
    addStat("Entities", viewConfig?.entityCount);
    addStat("Volumes", viewConfig?.volumeCount);
    addStat("Wells", viewConfig?.wellCount);
    addStat("Species", viewConfig?.speciesCount);
    addStat("Reactions", viewConfig?.reactionCount);
    addStat("Parts", viewConfig?.partCount);
    addStat("Joints", viewConfig?.jointCount);
    addStat("Forces", viewConfig?.forceCount);
    addStat("Links", viewConfig?.linkCount);
    addStat("Roads", viewConfig?.roadCount);
    addStat("Elements", viewConfig?.elementCount);
    addStat("Subcircuits", viewConfig?.subcircuitCount);

    if (viewConfig?.svg && typeof viewConfig.svg === "string") {
      if (rawCode && stats.length === 0) {
        stats.push({ label: "Source Lines", value: rawCode.split(/\r?\n/).length });
      }
      return { svgMarkup: sanitizeSvgMarkup(viewConfig.svg), parsedStats: stats };
    }

    if (!rawCode.trim()) {
      return { svgMarkup: "", parsedStats: stats };
    }

    const built = renderSourceToDiagramSvg(rawCode, dialect, title, isDark);
    if (stats.length === 0) {
      stats.push({ label: "Diagram Nodes", value: built.nodeCount });
      stats.push({ label: "Connections", value: built.edgeCount });
      stats.push({ label: "Source Lines", value: rawCode.split(/\r?\n/).length });
    }
    return { svgMarkup: built.svg, parsedStats: stats };
  }, [viewConfig, rawCode, dialect, title, isDark]);

  const handleCopy = () => {
    if (!rawCode) return;
    navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadSvg = () => {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenAction = () => {
    const resolvedId = artifactId ?? viewConfig?.artifactId ?? Date.now();
    if (isMultiFile && viewConfig?.files) {
      const wsId = `artifact-${resolvedId}`;
      navigate(`/ide#memfs:${wsId}`);
      return;
    }
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect as any,
      code: rawCode || `// ${title}\n`,
      title,
    });
    navigate(`/playground?fromArtifact=${resolvedId}#m=${hash}`);
  };

  const codeLines = useMemo(() => (rawCode ? rawCode.split(/\r?\n/) : []), [rawCode]);

  return (
    <Container>
      <Toolbar>
        <Box style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <WorkflowIcon size={16} fill={meta.accent} />
          <Text style={{ fontWeight: 600, fontSize: 13 }}>{title}</Text>
          <Label size="small" variant="accent">
            {meta.badge}
          </Label>
        </Box>
        <Box style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ToggleGroup>
            <ToggleBtn type="button" $active={viewMode === "diagram"} onClick={() => setViewMode("diagram")}>
              <WorkflowIcon size={12} /> Diagram
            </ToggleBtn>
            <ToggleBtn type="button" $active={viewMode === "code"} onClick={() => setViewMode("code")}>
              <CodeIcon size={12} /> Code
            </ToggleBtn>
          </ToggleGroup>
          {rawCode && (
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {svgMarkup && viewMode === "diagram" && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadSvg}>
              SVG
            </Button>
          )}
          {Boolean(viewConfig?.standalone) && (
            <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleOpenAction}>
              {isMultiFile ? "Open in VS Code" : "Open in Playground"}
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentGrid>
        {loadingText ? (
          <DiagramPane>
            <Spinner size="medium" />
            <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 8 }}>Loading artifact…</Text>
          </DiagramPane>
        ) : viewMode === "diagram" && svgMarkup ? (
          <DiagramPane>
            <div
              style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </DiagramPane>
        ) : (
          <CodePane>
            {codeLines.length > 0 ? (
              codeLines.map((line, i) => (
                <CodeLine key={i}>
                  <LineNo>{i + 1}</LineNo>
                  <LineText>{highlightPolyglotLine(line, dialect)}</LineText>
                </CodeLine>
              ))
            ) : (
              <Box style={{ padding: 24, color: "var(--color-fg-muted)", textAlign: "center" }}>
                No source code content available.
              </Box>
            )}
          </CodePane>
        )}

        <Sidebar>
          <Text
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--color-fg-muted)",
            }}
          >
            Artifact Telemetry
          </Text>

          {parsedStats.length > 0 ? (
            parsedStats.map((st, idx) => (
              <StatBox key={idx}>
                <Text style={{ fontSize: 11, color: "var(--color-fg-muted)", display: "block" }}>{st.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>{st.value}</Text>
              </StatBox>
            ))
          ) : (
            <StatBox>
              <Text style={{ fontSize: 11, color: "var(--color-fg-muted)", display: "block" }}>Dialect</Text>
              <Text style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace" }}>{dialect.toUpperCase()}</Text>
            </StatBox>
          )}
        </Sidebar>
      </ContentGrid>
    </Container>
  );
};

export default PolyglotArtifactViewer;
