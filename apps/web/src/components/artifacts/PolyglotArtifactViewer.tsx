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
import FortranViewer from "./FortranViewer";
import ReqifViewer from "./ReqifViewer";

export interface PolyglotArtifactViewerProps {
  viewConfig: any;
  viewType?: string;
  artifactId?: string | number;
  isFullScreen?: boolean | undefined;
}

export interface SanitizeSvgOptions {
  isFullScreen?: boolean | undefined;
  maxHeight?: string | undefined;
}

// eslint-disable-next-line react-refresh/only-export-components
export function sanitizeSvgMarkup(rawSvg: string, options?: SanitizeSvgOptions): string {
  if (!rawSvg) return "";
  const sanitized = DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use", "foreignObject"],
    ADD_ATTR: [
      "target",
      "xlink:href",
      "viewBox",
      "preserveAspectRatio",
      "marker-end",
      "marker-start",
      "style",
      "data-fmu",
      "data-node",
      "data-id",
    ],
  });
  const maxH = options?.maxHeight ?? (options?.isFullScreen ? "none" : "360px");
  return sanitized.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const cleanedAttrs = attrs.replace(/\sstyle=["'][^"']*["']/i, "");
    return `<svg${cleanedAttrs} style="width:100%;max-width:100%;height:auto;max-height:${maxH};display:block;margin:0 auto;">`;
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderSourceToDiagramSvg(
  content: string,
  dslLang: string,
  _fallbackTitle = "Artifact",
  isDark = true,
  isFullScreen = false,
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

  const PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect", "ExternalObject"]);

  const declPatterns = [
    /\b(?:part|item|port|action|state|requirement|attribute|package|block|model|class|connector|record|function|module|subroutine|entity|coupl|body|joint|force|vessel|line|pipe|node|compressor|branch|cylinder|chamber|subcircuit)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_.-]*)/gi,
    /^\s*(?!parameter\b|constant\b|discrete\b)([A-Z][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|=|;)/gm,
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
        if (!PRIMITIVE_TYPES.has(m[1] || "")) {
          addNode(m[2], m[1] || dslLang, `${m[2]} : ${m[1]}`);
        }
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

  // Verilog-A / Verilog-AMS analog branch contributions: I(drain, source) <+ ..., V(p, n) <+ ..., Pwr(tj) <+ ...
  const vaBranchRe =
    /\b(V|I|Potential|Flow|Temp|Pwr)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_]*))?\s*\)\s*<\+/g;
  while ((cm = vaBranchRe.exec(content)) !== null) {
    const nature = cm[1]!;
    const n1 = cm[2]!;
    const n2 = cm[3] || "gnd";
    const branchId = `${nature}_${n1}_${n2}`;
    addNode(n1, "Port", n1);
    addNode(branchId, "Branch", `${nature}(${n1}${cm[3] ? `, ${n2}` : ""}) <+`);
    addNode(n2, "Port", n2);
    edges.push({
      id: `e-${edges.length + 1}`,
      source: n1,
      sourcePort: `${n1}.out`,
      target: branchId,
      targetPort: `${branchId}.in`,
    });
    edges.push({
      id: `e-${edges.length + 1}`,
      source: branchId,
      sourcePort: `${branchId}.out`,
      target: n2,
      targetPort: `${n2}.in`,
    });
  }

  // AUTOSAR ARXML child <SHORT-NAME> inside SWC / Port / Runnable tags
  const arxmlElemRe =
    /<(SW-COMPONENT-PROTOTYPE|APPLICATION-SW-COMPONENT-TYPE|SENSOR-ACTUATOR-SW-COMPONENT-TYPE|P-PORT-PROTOTYPE|R-PORT-PROTOTYPE|RUNNABLE-ENTITY)\b[^>]*>\s*<SHORT-NAME>([^<]+)<\/SHORT-NAME>/gi;
  const arxmlNodes: string[] = [];
  while ((cm = arxmlElemRe.exec(content)) !== null) {
    const tag = cm[1]!;
    const shortName = cm[2]!.trim();
    addNode(shortName, tag, shortName);
    arxmlNodes.push(shortName);
  }
  if (arxmlNodes.length > 1 && edges.length === 0) {
    for (let i = 0; i < arxmlNodes.length - 1; i++) {
      edges.push({
        id: `e-${edges.length + 1}`,
        source: arxmlNodes[i]!,
        sourcePort: `${arxmlNodes[i]!}.out`,
        target: arxmlNodes[i + 1]!,
        targetPort: `${arxmlNodes[i + 1]!}.in`,
      });
    }
  }

  // PLCopen XML (<pou name="..." pouType="...">, <variable name="...">) & IEC 61131-3 ST (:=)
  const plcPouRe = /<pou\b[^>]*\bname=["']([^"']+)["'][^>]*\bpouType=["']([^"']+)["']/gi;
  let primaryPouId: string | null = null;
  while ((cm = plcPouRe.exec(content)) !== null) {
    const pouName = cm[1]!;
    const pouType = cm[2]!.toUpperCase();
    primaryPouId = pouName;
    addNode(pouName, pouType, `${pouName} (${pouType})`);
  }
  const plcVarRe = /<variable\b[^>]*\bname=["']([^"']+)["'][^>]*>\s*<type>\s*<([A-Za-z0-9_]+)/gi;
  while ((cm = plcVarRe.exec(content)) !== null) {
    const varName = cm[1]!;
    const varType = cm[2]!;
    addNode(varName, varType, `${varName} : ${varType}`);
    if (primaryPouId && varName !== primaryPouId) {
      edges.push({
        id: `e-${edges.length + 1}`,
        source: varName,
        sourcePort: `${varName}.out`,
        target: primaryPouId,
        targetPort: `${primaryPouId}.in`,
      });
    }
  }
  const stAssignRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([^;]+);/g;
  while ((cm = stAssignRe.exec(content)) !== null) {
    const lhs = cm[1]!;
    const rhs = cm[2]!;
    addNode(lhs, "ST_OUT", lhs);
    const idRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let idm: RegExpExecArray | null;
    while ((idm = idRe.exec(rhs)) !== null) {
      const tok = idm[1]!;
      if (/^(AND|OR|XOR|NOT|TRUE|FALSE|MOD|IF|THEN|ELSIF|ELSE|END_IF)$/i.test(tok) || tok === lhs) continue;
      if (seenIds.has(tok)) {
        edges.push({
          id: `e-${edges.length + 1}`,
          source: tok,
          sourcePort: `${tok}.out`,
          target: lhs,
          targetPort: `${lhs}.in`,
        });
      }
    }
  }

  // Arrow & keyword connections: a -> b, a --> b, CONNECT a TO b
  const arrowRe =
    /\b([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)?\s*(?:-->|->|\s+TO\s+)\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)?/gi;
  while ((cm = arrowRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    if (src === tgt) continue;
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

  // STEP / EXPRESS #id references: #10 = ENTITY_NAME(..., #20, ...);
  const stepEntityRe = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;/g;
  while ((cm = stepEntityRe.exec(content)) !== null) {
    const srcId = `#${cm[1]}`;
    const entityType = cm[2]!;
    const args = cm[3] || "";
    addNode(srcId, entityType, `${srcId} ${entityType}`);
    const refRe = /#(\d+)/g;
    let rm: RegExpExecArray | null;
    while ((rm = refRe.exec(args)) !== null) {
      const tgtId = `#${rm[1]}`;
      if (tgtId !== srcId) {
        addNode(tgtId, "STEP_ENTITY", tgtId);
        edges.push({
          id: `e-${edges.length + 1}`,
          source: srcId,
          sourcePort: `${srcId}.out`,
          target: tgtId,
          targetPort: `${tgtId}.in`,
        });
      }
    }
  }

  // Shared port / signal name matching across components (e.g. port="sig" or net="sig" or from/to attributes)
  const fromToRe =
    /\b(?:from|source|inlet)\s*[=:]\s*["']?([A-Za-z0-9_.-]+)["']?[^>]*?\b(?:to|target|outlet)\s*[=:]\s*["']?([A-Za-z0-9_.-]+)["']?/gi;
  while ((cm = fromToRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    if (src !== tgt) {
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
  }

  if (nodes.length === 0 || (edges.length === 0 && nodes.length <= 1)) {
    return { svg: "", nodeCount: 0, edgeCount: 0 };
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
    return { svg: sanitizeSvgMarkup(rawSvg, { isFullScreen }), nodeCount: nodes.length, edgeCount: edges.length };
  } catch {
    return { svg: "", nodeCount: nodes.length, edgeCount: edges.length };
  }
}

export interface InteractiveSvgStageProps {
  svgMarkup: string;
  isFullScreen?: boolean | undefined;
  minHeight?: string | undefined;
  background?: string | undefined;
  onClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
  children?: React.ReactNode;
}

export const InteractiveSvgStage: React.FC<InteractiveSvgStageProps> = ({
  svgMarkup,
  isFullScreen = false,
  minHeight,
  background,
  onClick,
  children,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = React.useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    moved: false,
  });

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button")) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    setPan({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  };

  const handleMouseUp = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    onClick?.(e);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleStageClick}
      style={{
        position: "relative",
        width: "100%",
        height: isFullScreen ? "100%" : "auto",
        minHeight: minHeight ?? (isFullScreen ? "100%" : "340px"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        background:
          background ??
          "radial-gradient(circle at center, var(--color-canvas-default) 0%, var(--color-canvas-subtle) 100%)",
        padding: "16px",
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: isDragging ? "none" : "transform 0.12s ease-out",
        }}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
      {children}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 4px",
          borderRadius: 6,
          background: "rgba(13, 17, 23, 0.82)",
          border: "1px solid var(--color-border-muted)",
          backdropFilter: "blur(6px)",
          zIndex: 5,
        }}
      >
        <button
          type="button"
          title="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          −
        </button>
        <button
          type="button"
          title="Reset zoom & pan"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-default)",
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 10,
            fontFamily: "var(--font-mono, monospace)",
            fontWeight: 600,
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          title="Zoom in"
          onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
};

const Container = styled(Box)<{ $isFullScreen?: boolean | undefined }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: ${(p) => (p.$isFullScreen ? "100%" : "auto")};
  background-color: var(--color-canvas-subtle);
  border-radius: ${(p) => (p.$isFullScreen ? "0" : "6px")};
  overflow: hidden;
  border: ${(p) => (p.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
`;

const Toolbar = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  background-color: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-muted);
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
  padding: 3px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  background: ${(p) => (p.$active ? "var(--color-accent-subtle)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg)" : "var(--color-fg-muted)")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
  }
`;

const ContentGrid = styled(Box)<{ $isFullScreen?: boolean | undefined; $hasSidebar?: boolean | undefined }>`
  display: grid;
  flex: 1;
  grid-template-columns: ${(p) => (p.$isFullScreen || !p.$hasSidebar ? "1fr" : "1fr 220px")};
  min-height: ${(p) => (p.$isFullScreen ? "0" : "360px")};
  height: ${(p) => (p.$isFullScreen ? "calc(100% - 36px)" : "auto")};

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const DiagramPane = styled(Box)<{ $isFullScreen?: boolean | undefined }>`
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: radial-gradient(circle at center, var(--color-canvas-default) 0%, var(--color-canvas-subtle) 100%);
  position: relative;
  overflow: auto;
  min-height: ${(p) => (p.$isFullScreen ? "100%" : "340px")};
`;

const CodePane = styled.div<{ $isFullScreen?: boolean | undefined }>`
  background: var(--color-canvas-default);
  overflow: auto;
  max-height: ${(p) => (p.$isFullScreen ? "100%" : "460px")};
  min-height: ${(p) => (p.$isFullScreen ? "100%" : "340px")};
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

const DOMAIN_META: Record<string, { badge: string; accent: string; commentPrefix: RegExp; ext?: string }> = {
  aspen: { badge: "ASPEN PLUS FLOWSHEET", accent: "#10b981", commentPrefix: /^\s*(;|\*)/, ext: ".bkp" },
  swmm: { badge: "EPA SWMM HYDRAULICS", accent: "#0ea5e9", commentPrefix: /^\s*;/, ext: ".inp" },
  touchstone: { badge: "TOUCHSTONE S-PARAMS", accent: "#8b5cf6", commentPrefix: /^\s*!/, ext: ".s2p" },
  ibis: { badge: "IBIS I/O BUFFER", accent: "#ec4899", commentPrefix: /^\s*\|/, ext: ".ibs" },
  opendss: { badge: "OPENDSS POWER GRID", accent: "#f59e0b", commentPrefix: /^\s*(!|\/\/)/, ext: ".dss" },
  openscenario: { badge: "ASAM OPENSCENARIO", accent: "#3b82f6", commentPrefix: /^\s*<!--/, ext: ".xosc" },
  relap5: { badge: "RELAP5 THERMAL-HYDRAULICS", accent: "#ef4444", commentPrefix: /^\s*(\*|=)/, ext: ".i" },
  eclipse: { badge: "ECLIPSE RESERVOIR", accent: "#d97706", commentPrefix: /^\s*--/, ext: ".data" },
  sbml: { badge: "SBML SYSTEMS BIOLOGY", accent: "#14b8a6", commentPrefix: /^\s*<!--/, ext: ".sbml" },
  jsbsim: { badge: "JSBSIM FLIGHT DYNAMICS", accent: "#6366f1", commentPrefix: /^\s*<!--/, ext: ".xml" },
  scad: { badge: "OPENSCAD CSG SOLID", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".scad" },
  csg: { badge: "OPENSCAD CSG SOLID", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".scad" },
  adams: { badge: "MSC ADAMS MULTIBODY", accent: "#f97316", commentPrefix: /^\s*!/, ext: ".adm" },
  autosar: { badge: "AUTOSAR ARXML", accent: "#0284c7", commentPrefix: /^\s*<!--/, ext: ".arxml" },
  ccsds: { badge: "CCSDS ORBIT DATA", accent: "#7c3aed", commentPrefix: /^\s*COMMENT\b/i, ext: ".oem" },
  energyplus: { badge: "ENERGYPLUS IDF", accent: "#22c55e", commentPrefix: /^\s*!/, ext: ".idf" },
  epanet: { badge: "EPANET WATER NETWORK", accent: "#06b6d4", commentPrefix: /^\s*;/, ext: ".inp" },
  opendrive: { badge: "ASAM OPENDRIVE ROAD", accent: "#64748b", commentPrefix: /^\s*<!--/, ext: ".xodr" },
  plcopen: { badge: "IEC 61131-3 PLCOPEN", accent: "#eab308", commentPrefix: /^\s*(\(\*|\/\/)/, ext: ".st" },
  reqif: { badge: "OMG REQIF REQUIREMENTS", accent: "#a855f7", commentPrefix: /^\s*<!--/, ext: ".reqif" },
  simulink: { badge: "SIMULINK BLOCK DIAGRAM", accent: "#f43f5e", commentPrefix: /^\s*(%|<!--)/, ext: ".slx" },
  spice: { badge: "SPICE CIRCUIT NETLIST", accent: "#f59e0b", commentPrefix: /^\s*\*/, ext: ".cir" },
  urdf: { badge: "ROS URDF KINEMATICS", accent: "#ec4899", commentPrefix: /^\s*<!--/, ext: ".urdf" },
  "verilog-a": { badge: "VERILOG-A / AMS", accent: "#3b82f6", commentPrefix: /^\s*\/\//, ext: ".va" },
  c: { badge: "C99 / EMBEDDED SOURCE", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".c" },
  fortran: { badge: "FORTRAN 90 NUMERICAL", accent: "#818cf8", commentPrefix: /^\s*(!|c\s|C\s)/, ext: ".f90" },
  csv: { badge: "TABULAR DATASET (CSV)", accent: "#10b981", commentPrefix: /^\s*#/, ext: ".csv" },
  gcode: { badge: "CNC G-CODE TOOLPATH", accent: "#f97316", commentPrefix: /^\s*(;|\()/, ext: ".gcode" },
  modelscript: { badge: "MODELSCRIPT (.MSX)", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".msx" },
  msx: { badge: "MODELSCRIPT (.MSX)", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".msx" },
  cfd: { badge: "SU2 / OPENFOAM CFD", accent: "#0ea5e9", commentPrefix: /^\s*(%|\/\/|#)/, ext: ".cfg" },
  fea: { badge: "ABAQUS / CALCULIX FEA", accent: "#f97316", commentPrefix: /^\s*\*\*/, ext: ".inp" },
  owl2: { badge: "OWL2 ONTOLOGY", accent: "#a855f7", commentPrefix: /^\s*#/, ext: ".owl" },
  pscad: { badge: "PSCAD EMT POWER", accent: "#eab308", commentPrefix: /^\s*<!--/, ext: ".pscx" },
  psse: { badge: "PSS/E POWER FLOW", accent: "#f59e0b", commentPrefix: /^\s*(@!|\/\*)/, ext: ".raw" },
  rocets: { badge: "ROCETS PROPULSION", accent: "#ef4444", commentPrefix: /^\s*(\*|!|#)/, ext: ".inp" },
  lps: { badge: "LPS LIQUID PROPULSION", accent: "#ec4899", commentPrefix: /^\s*(#|\/\/|!)/, ext: ".lps" },
  gensys: { badge: "GENSYS RAIL DYNAMICS", accent: "#10b981", commentPrefix: /^\s*#/, ext: ".gen" },
  simpack: { badge: "SIMPACK MULTIBODY", accent: "#3b82f6", commentPrefix: /^\s*(!|#)/, ext: ".spck" },
  olga: { badge: "OLGA MULTIPHASE FLOW", accent: "#14b8a6", commentPrefix: /^\s*!/, ext: ".olga" },
  sima: { badge: "SIMA MARINE OPERATIONS", accent: "#0284c7", commentPrefix: /^\s*(#|!|<!--)/, ext: ".sima" },
  gtsuite: { badge: "GT-SUITE POWERTRAIN", accent: "#f43f5e", commentPrefix: /^\s*(#|!|<!--)/, ext: ".gtm" },
  easy5: { badge: "MSC EASY5 CONTROLS", accent: "#6366f1", commentPrefix: /^\s*(\*|#)/, ext: ".ez5" },
  ssp: { badge: "FMI SSP ARCHITECTURE", accent: "#8b5cf6", commentPrefix: /^\s*<!--/, ext: ".ssp" },
  sysml: { badge: "OMG SYSML V2", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".sysml" },
  sysml2: { badge: "OMG SYSML V2", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".sysml" },
};

// eslint-disable-next-line react-refresh/only-export-components
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

const CODE_ONLY_DIALECTS = new Set(["fortran", "f90", "f95", "f08", "f18", "c", "scad", "csg", "ccsds", "energyplus"]);

function stripSyntheticDiagramComments(raw: string): string {
  if (!raw) return "";
  return raw
    .split(/\r?\n/)
    .filter(
      (line) => !/^\s*(?:!|\/\/|#|--|\*)?\s*(?:block\s+[A-Za-z0-9_]+\s*;|connect\s*\([^)]+\)\s*;)\s*$/i.test(line),
    )
    .join("\n");
}

export const PolyglotArtifactViewer: React.FC<PolyglotArtifactViewerProps> = ({
  viewConfig,
  viewType,
  artifactId,
  isFullScreen = false,
}) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const dialect = (viewType || viewConfig?.dialect || "modelica").toLowerCase();
  const isCodeOnlyDialect = CODE_ONLY_DIALECTS.has(dialect);
  const meta = DOMAIN_META[dialect] || {
    badge: `${dialect.toUpperCase()} ARTIFACT`,
    accent: "#06b6d4",
    commentPrefix: /^\s*(\/\/|#)/,
  };

  const [fetchedText, setFetchedText] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [viewMode, setViewMode] = useState<"diagram" | "code">(() => (isCodeOnlyDialect ? "code" : "diagram"));
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

  const rawCode = useMemo(
    () => stripSyntheticDiagramComments(inlineCode || fetchedText || ""),
    [inlineCode, fetchedText],
  );
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
    addStat("Inputs", viewConfig?.inputCount);
    addStat("Outputs", viewConfig?.outputCount);
    addStat("Branches", viewConfig?.branchCount);
    addStat("Parameters", viewConfig?.parameterCount);
    addStat("Runnables", viewConfig?.runnableCount);
    addStat("Connectors", viewConfig?.connectorCount);
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

    if (isCodeOnlyDialect) {
      return { svgMarkup: "", parsedStats: stats };
    }

    if (viewConfig?.svg && typeof viewConfig.svg === "string") {
      return { svgMarkup: sanitizeSvgMarkup(viewConfig.svg, { isFullScreen }), parsedStats: stats };
    }

    if (!rawCode.trim()) {
      return { svgMarkup: "", parsedStats: stats };
    }

    const built = renderSourceToDiagramSvg(rawCode, dialect, title, isDark, isFullScreen);
    return { svgMarkup: built.svg, parsedStats: stats };
  }, [viewConfig, rawCode, dialect, title, isDark, isCodeOnlyDialect, isFullScreen]);

  const [showSidebar, setShowSidebar] = useState(false);
  const codeLines = useMemo(() => (rawCode ? rawCode.split(/\r?\n/) : []), [rawCode]);
  const hasSidebar = !isFullScreen && !isCodeOnlyDialect && parsedStats.length > 0 && showSidebar;
  const effectiveViewMode = isCodeOnlyDialect || !svgMarkup ? "code" : viewMode;

  if (dialect === "fortran" || dialect === "f90" || dialect === "f95" || dialect === "f08" || dialect === "f18") {
    return <FortranViewer artifactId={artifactId} viewConfig={viewConfig} isFullScreen={isFullScreen} />;
  }

  if (dialect === "reqif" || dialect === "reqifz") {
    return (
      <ReqifViewer
        viewConfig={{
          ...viewConfig,
          code: rawCode || inlineCode,
        }}
        isFullScreen={isFullScreen}
      />
    );
  }

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
      localStorage.setItem(
        `modelscript:ide:memfs:artifact-${resolvedId}`,
        JSON.stringify({ files: viewConfig.files, primaryFile: viewConfig.primaryFile }),
      );
      navigate(`/ide#memfs:${wsId}`);
      return;
    }
    const ext = meta.ext || ".msx";
    const resolvedTitle = title.includes(".") ? title : `${title.replace(/\s+/g, "_")}${ext}`;
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect as any,
      code: rawCode || `// ${title}\n`,
      title: resolvedTitle,
    });
    navigate(`/playground?fromArtifact=${resolvedId}#m=${hash}`);
  };

  return (
    <Container $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {isCodeOnlyDialect ? (
            <CodeIcon size={14} fill={meta.accent} />
          ) : (
            <WorkflowIcon size={14} fill={meta.accent} />
          )}
          <Label size="small" variant="accent" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            {meta.badge}
          </Label>
          {!isFullScreen && (
            <Text
              style={{
                fontWeight: 600,
                fontSize: "13px",
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={title}
            >
              {title}
            </Text>
          )}
        </Box>
        <Box style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {!isCodeOnlyDialect && svgMarkup && (
            <ToggleGroup>
              <ToggleBtn type="button" $active={effectiveViewMode === "diagram"} onClick={() => setViewMode("diagram")}>
                <WorkflowIcon size={12} /> Diagram
              </ToggleBtn>
              <ToggleBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                <CodeIcon size={12} /> Code{codeLines.length > 0 ? ` (${codeLines.length}L)` : ""}
              </ToggleBtn>
            </ToggleGroup>
          )}
          {!isFullScreen && !isCodeOnlyDialect && parsedStats.length > 0 && (
            <Button size="small" onClick={() => setShowSidebar((s) => !s)}>
              {showSidebar ? "Hide Telemetry" : `Telemetry (${parsedStats.length})`}
            </Button>
          )}
          {rawCode && (
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {!isCodeOnlyDialect && svgMarkup && effectiveViewMode === "diagram" && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadSvg}>
              SVG
            </Button>
          )}
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleOpenAction}>
              {isMultiFile ? "Open in VS Code" : "Open in Playground"}
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentGrid $isFullScreen={isFullScreen} $hasSidebar={hasSidebar}>
        {loadingText ? (
          <DiagramPane $isFullScreen={isFullScreen}>
            <Spinner size="medium" />
            <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 8 }}>Loading artifact…</Text>
          </DiagramPane>
        ) : effectiveViewMode === "diagram" && svgMarkup ? (
          <InteractiveSvgStage svgMarkup={svgMarkup} isFullScreen={isFullScreen} />
        ) : (
          <CodePane $isFullScreen={isFullScreen}>
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

        {hasSidebar && (
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

            {parsedStats.map((st, idx) => (
              <StatBox key={idx}>
                <Text style={{ fontSize: 11, color: "var(--color-fg-muted)", display: "block" }}>{st.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>{st.value}</Text>
              </StatBox>
            ))}
          </Sidebar>
        )}
      </ContentGrid>
    </Container>
  );
};

export default PolyglotArtifactViewer;
