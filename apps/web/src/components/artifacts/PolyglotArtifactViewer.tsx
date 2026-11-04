// SPDX-License-Identifier: AGPL-3.0-or-later

import { parsePlcopenTextToProject, renderPlcopenSvg } from "@modelscript/diagram/plcopen-diagram-builder";
import { renderQifMbdHeatmapSvg } from "@modelscript/diagram/qif-diagram-builder";
import { parseSimulinkTextToSystem, renderSimulinkSvg } from "@modelscript/diagram/simulink-diagram-builder";
import { renderPolyglotDiagramToSvg } from "@modelscript/diagram/svg";
import { parseQif } from "@modelscript/qif/parser";
import {
  BeakerIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PlayIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Button, Label, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { registerAllModelscriptLanguages } from "../morsel/util/monaco-lsp-adapter";
import { compressMorselPayload } from "../morsel/util/permalink";
import FortranViewer from "./FortranViewer";
import QifViewer from "./QifViewer";
import ReqifViewer from "./ReqifViewer";
import StudyTemplateViewer from "./StudyTemplateViewer";
import { useWheelZoom, ZoomHintBadge } from "./useArtifactZoom";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

export interface PolyglotArtifactViewerProps {
  viewConfig: any;
  viewType?: string;
  artifactId?: string | number;
  isFullScreen?: boolean | undefined;
}

export interface SanitizeSvgOptions {
  isFullScreen?: boolean | undefined;
  maxHeight?: string | undefined;
  isDark?: boolean | undefined;
}

import { adaptSvgMarkupForTheme, resolveCurrentThemeIsDark } from "./svg-theme";

// eslint-disable-next-line react-refresh/only-export-components
export { adaptSvgMarkupForTheme };

// eslint-disable-next-line react-refresh/only-export-components
export function sanitizeSvgMarkup(rawSvg: string, options?: SanitizeSvgOptions): string {
  if (!rawSvg) return "";
  // Strip any @import rules from embedded SVG styles to prevent font-swapping and CSSOM reflows
  const noImportSvg = rawSvg.replace(/@import\s+(?:url\([^)]+\)|['"][^'"]+['"])\s*;?/gi, "");
  const isDark = resolveCurrentThemeIsDark(options?.isDark);
  const themedSvg = adaptSvgMarkupForTheme(noImportSvg, isDark);
  const sanitized = DOMPurify.sanitize(themedSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOW_DATA_ATTR: true,
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
      "data-kind",
      "data-line-index",
      "data-reqif-id",
    ],
  });
  const maxH = options?.maxHeight ?? (options?.isFullScreen ? "none" : "360px");
  return sanitized.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const existingStyle = /\sstyle=["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const bgMatch = /\bbackground(?:-color)?\s*:\s*([^;]+)/i.exec(existingStyle);
    const preservedBg = bgMatch ? `background-color:${bgMatch[1]!.trim()};border-radius:6px;` : "";
    const cleanedAttrs = attrs.replace(/\sstyle=["'][^"']*["']/i, "");
    return `<svg${cleanedAttrs} style="${preservedBg}width:100%;max-width:100%;height:auto;max-height:${maxH};display:block;margin:0 auto;">`;
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

  const normalizedLang = dslLang.toLowerCase();
  if (normalizedLang === "simulink") {
    try {
      const parsed = parseSimulinkTextToSystem(content, _fallbackTitle);
      const blocksArr = Array.isArray(parsed.rootSystem.blocks) ? parsed.rootSystem.blocks : [];
      const linesArr = parsed.rootSystem.lines ?? [];
      if (blocksArr.length > 0) {
        const rawSvg = renderSimulinkSvg(parsed);
        return {
          svg: sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark }),
          nodeCount: blocksArr.length,
          edgeCount: linesArr.length,
        };
      }
    } catch {
      // Fall through to generic polyglot extractor if Simulink parse fails
    }
  }

  if (normalizedLang === "plcopen") {
    try {
      const parsed = parsePlcopenTextToProject(content, _fallbackTitle);
      if (parsed.pous.length > 0) {
        const rawSvg = renderPlcopenSvg(parsed);
        const primaryPou = parsed.pous[0]!;
        const varCount = primaryPou.variables.length;
        const ioCount = primaryPou.variables.filter((v) => v.scope === "input" || v.scope === "output").length;
        return {
          svg: sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark }),
          nodeCount: Math.max(1, varCount),
          edgeCount: Math.max(1, ioCount),
        };
      }
    } catch {
      // Fall through to generic polyglot extractor if PLCopen parse fails
    }
  }

  if (normalizedLang === "qif") {
    try {
      const doc = parseQif(content, _fallbackTitle);
      if (doc.features.length > 0 || doc.characteristics.length > 0) {
        const rawSvg = renderQifMbdHeatmapSvg(doc);
        return {
          svg: sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark }),
          nodeCount: Math.max(1, doc.features.length),
          edgeCount: Math.max(1, doc.characteristics.length),
        };
      }
    } catch {
      // Fall through to generic polyglot extractor if QIF parse fails
    }
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
    /<(?:ssd:Component|Component|SubSystem|SW-COMPONENT-PROTOTYPE|SPEC-OBJECT|InternalElement|PlaneFeatureNominal|CylinderFeatureNominal|SlotFeatureNominal|PositionCharacteristicNominal|FlatnessCharacteristicNominal|CylindricityCharacteristicNominal|MeasurementDevice|link|joint|road|junction|species|reaction|Entity|Part)\b[^>]*\b(?:name|Name|id|ID|SHORT-NAME)=["']([^"']+)["']/gi,
    /"(?:control-id|title)"\s*:\s*"([^"]+)"/gi,
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
    return {
      svg: sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark }),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  } catch {
    return { svg: "", nodeCount: nodes.length, edgeCount: edges.length };
  }
}

export interface InteractiveSvgStageProps {
  svgMarkup?: string | undefined;
  svgHtml?: string | undefined;
  isFullScreen?: boolean | undefined;
  minHeight?: string | undefined;
  background?: string | undefined;
  onClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
  children?: React.ReactNode;
}

export const InteractiveSvgStage: React.FC<InteractiveSvgStageProps> = ({
  svgMarkup,
  svgHtml,
  isFullScreen = false,
  minHeight,
  background,
  onClick,
  children,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const stageRef = React.useRef<HTMLDivElement>(null);

  const { showHint } = useWheelZoom({
    containerRef: stageRef,
    zoom,
    setZoom,
    pan,
    setPan,
    isFullScreen,
    minZoom: 0.35,
    maxZoom: 3.5,
  });

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

  const resolvedSvgHtml = useMemo(
    () => adaptSvgMarkupForTheme(svgMarkup ?? svgHtml ?? "", isDark),
    [svgMarkup, svgHtml, isDark],
  );

  const cleanupDragListenersRef = React.useRef<(() => void) | null>(null);

  const endDrag = React.useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
    if (cleanupDragListenersRef.current) {
      cleanupDragListenersRef.current();
      cleanupDragListenersRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupDragListenersRef.current) {
        cleanupDragListenersRef.current();
        cleanupDragListenersRef.current = null;
      }
    };
  }, []);

  const updatePanFromPoint = React.useCallback((clientX: number, clientY: number) => {
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    setPan({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [role='button']")) return;
    e.preventDefault();
    if (cleanupDragListenersRef.current) {
      cleanupDragListenersRef.current();
      cleanupDragListenersRef.current = null;
    }
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
    setIsDragging(true);

    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      if (typeof ev.buttons === "number" && (ev.buttons & 1) === 0) {
        endDrag();
        return;
      }
      updatePanFromPoint(ev.clientX, ev.clientY);
    };

    const handleWindowMouseUp = () => {
      endDrag();
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("pointerup", handleWindowMouseUp);
    window.addEventListener("pointercancel", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowMouseUp);
    window.addEventListener("dragend", handleWindowMouseUp);

    cleanupDragListenersRef.current = () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("pointerup", handleWindowMouseUp);
      window.removeEventListener("pointercancel", handleWindowMouseUp);
      window.removeEventListener("blur", handleWindowMouseUp);
      window.removeEventListener("dragend", handleWindowMouseUp);
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    if (typeof e.buttons === "number" && (e.buttons & 1) === 0) {
      endDrag();
      return;
    }
    updatePanFromPoint(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    endDrag();
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
      ref={stageRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragStart={(e) => e.preventDefault()}
      onClick={handleStageClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: minHeight ?? (isFullScreen ? "100%" : "340px"),
        boxSizing: "border-box",
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
        dangerouslySetInnerHTML={{ __html: resolvedSvgHtml }}
      />
      {children}
      <ZoomHintBadge show={showHint && !isFullScreen} label="💡 Hold ⌘/Ctrl to zoom diagram" />
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
          background: isDark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.92)",
          border: isDark ? "1px solid rgba(148, 163, 184, 0.28)" : "1px solid var(--color-border-default, #cbd5e1)",
          backdropFilter: "blur(6px)",
          boxShadow: isDark ? "0 2px 8px rgba(0, 0, 0, 0.22)" : "0 2px 8px rgba(15, 23, 42, 0.08)",
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
            color: isDark ? "#cbd5e1" : "#475569",
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
            color: isDark ? "#f8fafc" : "#0f172a",
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
            color: isDark ? "#cbd5e1" : "#475569",
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

const Container = styled(Box)<{ $isFullScreen?: boolean | undefined; $standalone?: boolean | undefined }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: ${(p) => (p.$isFullScreen ? "100%" : "440px")};
  background-color: var(--color-canvas-subtle);
  border-radius: ${(p) => (p.$isFullScreen || !p.$standalone ? "0" : "6px")};
  overflow: hidden;
  border: ${(p) => (p.$isFullScreen || !p.$standalone ? "none" : "1px solid var(--color-border-default)")};
`;

const Toolbar = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  background-color: var(--ms-brand-soft, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-accent-blue-border, var(--color-border-default));
  gap: 8px;
  overflow: hidden;
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
  background: ${(p) => (p.$active ? "var(--ms-brand, #0e7490)" : "transparent")};
  color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-default)")};
  opacity: ${(p) => (p.$active ? 1 : 0.82)};
  box-shadow: ${(p) => (p.$active ? "0 1px 2px rgba(0, 0, 0, 0.12)" : "none")};
  transition: all 0.15s ease;

  &:hover {
    opacity: 1;
    color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-default)")};
  }
`;

const ContentGrid = styled(Box)<{ $isFullScreen?: boolean | undefined }>`
  display: grid;
  flex: 1;
  grid-template-columns: 1fr;
  min-height: 0;
  height: calc(100% - 36px);
  overflow: hidden;
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
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
`;

const CodePane = styled.div<{ $isFullScreen?: boolean | undefined }>`
  background: var(--color-canvas-default);
  overflow: auto;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
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

const DOMAIN_META: Record<string, { badge: string; accent: string; commentPrefix: RegExp; ext?: string }> = {
  aspen: { badge: "ASPEN PLUS", accent: "#10b981", commentPrefix: /^\s*(;|\*)/, ext: ".bkp" },
  swmm: { badge: "EPA SWMM", accent: "#0ea5e9", commentPrefix: /^\s*;/, ext: ".inp" },
  touchstone: { badge: "TOUCHSTONE", accent: "#8b5cf6", commentPrefix: /^\s*!/, ext: ".s2p" },
  ibis: { badge: "IBIS", accent: "#ec4899", commentPrefix: /^\s*\|/, ext: ".ibs" },
  opendss: { badge: "OPENDSS", accent: "#f59e0b", commentPrefix: /^\s*(!|\/\/)/, ext: ".dss" },
  openscenario: { badge: "OPENSCENARIO", accent: "#3b82f6", commentPrefix: /^\s*<!--/, ext: ".xosc" },
  relap5: { badge: "RELAP5", accent: "#ef4444", commentPrefix: /^\s*(\*|=)/, ext: ".i" },
  eclipse: { badge: "ECLIPSE", accent: "#d97706", commentPrefix: /^\s*--/, ext: ".data" },
  sbml: { badge: "SBML", accent: "#14b8a6", commentPrefix: /^\s*<!--/, ext: ".sbml" },
  jsbsim: { badge: "JSBSIM", accent: "#6366f1", commentPrefix: /^\s*<!--/, ext: ".xml" },
  scad: { badge: "OPENSCAD", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".scad" },
  csg: { badge: "OPENSCAD", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".scad" },
  adams: { badge: "MSC ADAMS", accent: "#f97316", commentPrefix: /^\s*!/, ext: ".adm" },
  autosar: { badge: "AUTOSAR", accent: "#0284c7", commentPrefix: /^\s*<!--/, ext: ".arxml" },
  ccsds: { badge: "CCSDS", accent: "#7c3aed", commentPrefix: /^\s*COMMENT\b/i, ext: ".oem" },
  energyplus: { badge: "ENERGYPLUS", accent: "#22c55e", commentPrefix: /^\s*!/, ext: ".idf" },
  epanet: { badge: "EPANET", accent: "#06b6d4", commentPrefix: /^\s*;/, ext: ".inp" },
  opendrive: { badge: "OPENDRIVE", accent: "#64748b", commentPrefix: /^\s*<!--/, ext: ".xodr" },
  plcopen: { badge: "PLCOPEN", accent: "#eab308", commentPrefix: /^\s*(\(\*|\/\/|<!--)/, ext: ".st" },
  reqif: { badge: "REQIF", accent: "#a855f7", commentPrefix: /^\s*<!--/, ext: ".reqif" },
  simulink: { badge: "SIMULINK", accent: "#f43f5e", commentPrefix: /^\s*(%|<!--)/, ext: ".slx" },
  spice: { badge: "SPICE", accent: "#f59e0b", commentPrefix: /^\s*\*/, ext: ".cir" },
  urdf: { badge: "ROS URDF", accent: "#ec4899", commentPrefix: /^\s*<!--/, ext: ".urdf" },
  "verilog-a": { badge: "VERILOG-A", accent: "#3b82f6", commentPrefix: /^\s*\/\//, ext: ".va" },
  c: { badge: "C99", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".c" },
  fortran: { badge: "FORTRAN 90", accent: "#818cf8", commentPrefix: /^\s*(!|c\s|C\s)/, ext: ".f90" },
  csv: { badge: "CSV", accent: "#10b981", commentPrefix: /^\s*#/, ext: ".csv" },
  gcode: { badge: "G-CODE", accent: "#f97316", commentPrefix: /^\s*(;|\()/, ext: ".gcode" },
  modelscript: { badge: "MODELSCRIPT", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".msx" },
  msx: { badge: "MODELSCRIPT", accent: "#06b6d4", commentPrefix: /^\s*\/\//, ext: ".msx" },
  cfd: { badge: "SU2 / CFD", accent: "#0ea5e9", commentPrefix: /^\s*(%|\/\/|#)/, ext: ".cfg" },
  fea: { badge: "CALCULIX FEA", accent: "#f97316", commentPrefix: /^\s*\*\*/, ext: ".inp" },
  owl2: { badge: "OWL2", accent: "#a855f7", commentPrefix: /^\s*#/, ext: ".owl" },
  pscad: { badge: "PSCAD EMT", accent: "#eab308", commentPrefix: /^\s*<!--/, ext: ".pscx" },
  psse: { badge: "PSS/E", accent: "#f59e0b", commentPrefix: /^\s*(@!|\/\*)/, ext: ".raw" },
  rocets: { badge: "ROCETS", accent: "#ef4444", commentPrefix: /^\s*(\*|!|#)/, ext: ".inp" },
  lps: { badge: "LPS", accent: "#ec4899", commentPrefix: /^\s*(#|\/\/|!)/, ext: ".lps" },
  gensys: { badge: "GENSYS", accent: "#10b981", commentPrefix: /^\s*#/, ext: ".gen" },
  simpack: { badge: "SIMPACK", accent: "#3b82f6", commentPrefix: /^\s*(!|#)/, ext: ".spck" },
  olga: { badge: "OLGA", accent: "#14b8a6", commentPrefix: /^\s*!/, ext: ".olga" },
  sima: { badge: "SIMA", accent: "#0284c7", commentPrefix: /^\s*(#|!|<!--)/, ext: ".sima" },
  gtsuite: { badge: "GT-SUITE", accent: "#f43f5e", commentPrefix: /^\s*(#|!|<!--)/, ext: ".gtm" },
  easy5: { badge: "EASY5", accent: "#6366f1", commentPrefix: /^\s*(\*|#)/, ext: ".ez5" },
  ssp: { badge: "FMI SSP", accent: "#8b5cf6", commentPrefix: /^\s*<!--/, ext: ".ssp" },
  sysml: { badge: "SYSML V2", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".sysml" },
  sysml2: { badge: "SYSML V2", accent: "#38bdf8", commentPrefix: /^\s*(\/\/|\/\*)/, ext: ".sysml" },
  qif: { badge: "ISO 23952 QIF 3.0", accent: "#0284c7", commentPrefix: /^\s*(<!--|\/\/|#)/, ext: ".qif" },
  oscal: { badge: "NIST OSCAL 1.1", accent: "#7c3aed", commentPrefix: /^\s*(<!--|#)/, ext: ".oscal.json" },
  automationml: { badge: "IEC 62714 AML", accent: "#0d9488", commentPrefix: /^\s*(<!--|\/\/|#)/, ext: ".aml" },
  aml: { badge: "IEC 62714 AML", accent: "#0d9488", commentPrefix: /^\s*(<!--|\/\/|#)/, ext: ".aml" },
};

const POLYGLOT_KEYWORD_RE =
  /^(?:PROGRAM|END_PROGRAM|FUNCTION_BLOCK|END_FUNCTION_BLOCK|FUNCTION|END_FUNCTION|CONFIGURATION|END_CONFIGURATION|RESOURCE|END_RESOURCE|TASK|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_GLOBAL|VAR_TEMP|VAR_EXTERNAL|END_VAR|CONSTANT|RETAIN|IF|THEN|ELSIF|ELSE|END_IF|CASE|OF|END_CASE|FOR|TO|BY|DO|END_FOR|WHILE|END_WHILE|REPEAT|UNTIL|END_REPEAT|EXIT|RETURN|AND|OR|XOR|NOT|MOD|model|block|connector|record|package|type|equation|algorithm|initial|parameter|input|output|flow|stream|discrete|connect|der|pre|edge|change|reinit|when|elsewhen|part|port|action|state|requirement|attribute|item|connection|interface|import|private|protected|public|extends|redeclare|replaceable|each|final|outer|inner|encapsulated|partial|within|annotation|module|endmodule|analog|begin|end|subroutine|struct|switch|union|difference|intersection|translate|rotate|scale|cylinder|cube|sphere|\.SUBCKT|\.ENDS|\.MODEL|\.TRAN|\.AC|\.DC|\.OP)$/i;

const POLYGLOT_TYPE_OR_BUILTIN_RE =
  /^(?:BOOL|BYTE|WORD|DWORD|LWORD|SINT|INT|DINT|LINT|USINT|UINT|UDINT|ULINT|REAL|LREAL|TIME|DATE|TOD|DT|STRING|WSTRING|TRUE|FALSE|TON|TOF|TP|CTU|CTD|CTUD|R_TRIG|F_TRIG|SR|RS|Real|Integer|Boolean|String|StateSelect|electrical|voltage|current|void|float|double|char|long|short|unsigned|signed|size_t|bool|precision)$/i;

const POLYGLOT_TOKEN_SCANNER_RE =
  /(<!--[\s\S]*?(?:-->|$)|\(\*[\s\S]*?(?:\*\)|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*$)|(<\?[A-Za-z_][\w:.-]*|\?>|<!\[CDATA\[|\]\]>|<!DOCTYPE[^>]*>)|(<\/?)([A-Za-z_][\w:.-]*)|(\/?>)|([A-Za-z_][\w:.-]*)(\s*=\s*)(?=["'])|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(&(?:[a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);)|(\b(?:T|TIME|D|DATE|TOD|DT|BOOL|BYTE|WORD|DWORD|LWORD|SINT|INT|DINT|LINT|USINT|UINT|UDINT|ULINT|REAL|LREAL)#[A-Za-z0-9_.:+-]+\b|\b(?:2|8|16)#[0-9A-Fa-f_]+\b)|((?<![\w:.-])-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[fFpPnNuUmMkKgGtT]|Meg|meg)?\b)|(:=|=>|<=|>=|<>|==|!=|\*\*|<->|->)|(\.[A-Za-z_]\w*\b|\b[A-Za-z_]\w*\b)/g;

// eslint-disable-next-line react-refresh/only-export-components
export function highlightPolyglotLine(line: string, dialect: string): React.ReactNode {
  if (!line) return line;
  const meta = DOMAIN_META[dialect];
  if (
    (meta?.commentPrefix.test(line) || /^\s*(#|\/\/|!|;|--|\*|<!--|\(\*)/.test(line)) &&
    !/^\s*<\?xml\b/i.test(line) &&
    !/^\s*<!--[\s\S]*-->\s*\S/.test(line) &&
    !/^\s*\(\*[\s\S]*\*\)\s*\S/.test(line)
  ) {
    return <span style={{ color: "var(--color-fg-muted)", fontStyle: "italic" }}>{line}</span>;
  }

  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyIdx = 0;

  POLYGLOT_TOKEN_SCANNER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = POLYGLOT_TOKEN_SCANNER_RE.exec(line)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      out.push(line.slice(lastIndex, matchIndex));
    }

    const [
      fullMatch,
      inlineComment,
      xmlPiOrCdata,
      xmlTagBracketOpen,
      xmlTagName,
      xmlTagBracketClose,
      xmlAttrName,
      xmlAttrEq,
      stringLiteral,
      xmlEntity,
      iecLiteral,
      numberLiteral,
      multiOp,
      wordToken,
    ] = match;

    if (inlineComment !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-fg-muted)", fontStyle: "italic" }}>
          {inlineComment}
        </span>,
      );
    } else if (xmlPiOrCdata !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-meta, #0284c7)", fontWeight: 600 }}>
          {xmlPiOrCdata}
        </span>,
      );
    } else if (xmlTagBracketOpen !== undefined && xmlTagName !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-fg-muted)" }}>
          {xmlTagBracketOpen}
        </span>,
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-entity-tag, #10b981)", fontWeight: 600 }}>
          {xmlTagName}
        </span>,
      );
    } else if (xmlTagBracketClose !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-fg-muted)" }}>
          {xmlTagBracketClose}
        </span>,
      );
    } else if (xmlAttrName !== undefined && xmlAttrEq !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-constant, #0284c7)" }}>
          {xmlAttrName}
        </span>,
        <span key={keyIdx++} style={{ color: "var(--color-fg-muted)" }}>
          {xmlAttrEq}
        </span>,
      );
    } else if (stringLiteral !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-string, var(--ms-brand, #0e7490))" }}>
          {stringLiteral}
        </span>,
      );
    } else if (xmlEntity !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-constant, #d97706)", fontWeight: 600 }}>
          {xmlEntity}
        </span>,
      );
    } else if (iecLiteral !== undefined || numberLiteral !== undefined) {
      out.push(
        <span
          key={keyIdx++}
          style={{ color: "var(--color-prettylights-syntax-constant, var(--color-accent-fg, #0284c7))" }}
        >
          {fullMatch}
        </span>,
      );
    } else if (multiOp !== undefined) {
      out.push(
        <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-keyword, #e11d48)", fontWeight: 600 }}>
          {multiOp}
        </span>,
      );
    } else if (wordToken !== undefined) {
      if (POLYGLOT_KEYWORD_RE.test(wordToken)) {
        out.push(
          <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-keyword, #e11d48)", fontWeight: 600 }}>
            {wordToken}
          </span>,
        );
      } else if (POLYGLOT_TYPE_OR_BUILTIN_RE.test(wordToken)) {
        out.push(
          <span key={keyIdx++} style={{ color: "var(--color-prettylights-syntax-entity, #8b5cf6)", fontWeight: 600 }}>
            {wordToken}
          </span>,
        );
      } else {
        out.push(wordToken);
      }
    } else {
      out.push(fullMatch);
    }

    lastIndex = POLYGLOT_TOKEN_SCANNER_RE.lastIndex;
  }

  if (lastIndex < line.length) {
    out.push(line.slice(lastIndex));
  }

  return out.length > 0 ? out : line;
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
    badge: dialect.toUpperCase(),
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

  const svgMarkup = useMemo(() => {
    if (isCodeOnlyDialect) {
      return "";
    }

    // For Simulink and PLCopen, always prefer fresh layout rendering from rawCode if available
    if ((dialect === "simulink" || dialect === "plcopen") && rawCode.trim()) {
      const built = renderSourceToDiagramSvg(rawCode, dialect, title, isDark, isFullScreen);
      if (built.svg) return built.svg;
    }

    if (viewConfig?.svg && typeof viewConfig.svg === "string") {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }

    if (!rawCode.trim()) {
      return "";
    }

    const built = renderSourceToDiagramSvg(rawCode, dialect, title, isDark, isFullScreen);
    return built.svg;
  }, [viewConfig, rawCode, dialect, title, isDark, isCodeOnlyDialect, isFullScreen]);

  const codeLines = useMemo(() => (rawCode ? rawCode.split(/\r?\n/) : []), [rawCode]);
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

  if (dialect === "qif") {
    return (
      <QifViewer
        artifactId={artifactId}
        viewConfig={{
          ...viewConfig,
          code: rawCode || inlineCode,
        }}
        isFullScreen={isFullScreen}
      />
    );
  }

  if (
    dialect === "study-template" ||
    dialect === "study" ||
    Boolean(viewConfig?.filename && /\.(sedml|ssv|dakota)$/i.test(String(viewConfig.filename)))
  ) {
    return (
      <StudyTemplateViewer
        viewConfig={{
          ...viewConfig,
          rawStandardSource: rawCode || inlineCode || viewConfig?.rawStandardSource,
        }}
        artifactPath={viewConfig?.filename || viewConfig?.path}
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

  const handleRunStudy = () => {
    const d = dialect.toLowerCase();
    let slug = "modelica-sundials-dae";
    if (d === "fmu" || d === "fmi" || d === "ssp") slug = "fmi-cosim-master";
    else if (d === "plcopen" || d === "simulink" || d === "autosar") slug = "sil-controls-verification";
    else if (d === "cfd" || d === "su2" || d === "openfoam") slug = "su2-rans-polar-sweep";
    else if (d === "fea" || d === "calculix" || d === "step" || d === "scad" || d === "openscad")
      slug = "calculix-nonlinear-fea";
    else if (d === "pscad" || d === "psse" || d === "opendss") slug = "pscad-emt-fault-ride-through";
    else if (d === "simpack" || d === "gensys" || d === "adams" || d === "urdf") slug = "simpack-rail-en14363";
    else if (
      d === "spice" ||
      d === "verilog-a" ||
      d === "verilog-ams" ||
      d === "vhdl-ams" ||
      d === "touchstone" ||
      d === "ibis"
    ) {
      slug = "spice-pvt-corner-mc";
    } else if (d === "sysml2" || d === "sysmlv2") slug = "sysmlv2-req-verification";
    else if (d === "sbml" || d === "cellml") slug = "sbml-copasi-identifiability";
    else if (
      [
        "olga",
        "sima",
        "lps",
        "epanet",
        "swmm",
        "gtsuite",
        "easy5",
        "rocets",
        "relap5",
        "energyplus",
        "aspen",
        "eclipse",
        "jsbsim",
      ].includes(d)
    ) {
      slug = "domain-process-aero-sweep";
    } else if (["matlab", "python", "julia", "c", "cpp", "rust", "fortran"].includes(d)) {
      slug = "scientific-hpc-batch";
    }

    const params = new URLSearchParams();
    params.set("domain", dialect);
    params.set("model", title);
    if (viewConfig?.packageName) params.set("package", String(viewConfig.packageName));
    if (viewConfig?.packageVersion) params.set("version", String(viewConfig.packageVersion));
    if (viewConfig?.filename || viewConfig?.path) {
      params.set("artifact", String(viewConfig.filename || viewConfig.path));
    }
    navigate(`/jobs/templates/${slug}?${params.toString()}`);
  };

  return (
    <Container $isFullScreen={isFullScreen} $standalone={Boolean(viewConfig?.standalone)}>
      <Toolbar>
        <Box style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, overflow: "hidden" }}>
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
          {!isCodeOnlyDialect && svgMarkup && effectiveViewMode === "diagram" && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadSvg} title="Download SVG">
              SVG
            </Button>
          )}
          {rawCode && (
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <>
              <Button size="small" leadingVisual={BeakerIcon} onClick={handleRunStudy}>
                Run Study
              </Button>
              <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleOpenAction}>
                {isMultiFile ? "Open in VS Code" : "Open in Playground"}
              </Button>
            </>
          )}
        </Box>
      </Toolbar>

      <ContentGrid $isFullScreen={isFullScreen}>
        {loadingText ? (
          <DiagramPane $isFullScreen={isFullScreen}>
            <Spinner size="medium" />
            <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 8 }}>Loading artifact…</Text>
          </DiagramPane>
        ) : effectiveViewMode === "diagram" && svgMarkup ? (
          <InteractiveSvgStage svgMarkup={svgMarkup} isFullScreen={isFullScreen} />
        ) : isFullScreen ? (
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" height="100%" gap={2}>
                <Spinner size="small" />
                <Text style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Loading Monaco editor…</Text>
              </Box>
            }
          >
            <MonacoEditor
              height="100%"
              language={dialect}
              theme={isDark ? "vs-dark" : "vs"}
              value={rawCode}
              beforeMount={(m) => registerAllModelscriptLanguages(m)}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontSize: 12,
              }}
            />
          </Suspense>
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
      </ContentGrid>
    </Container>
  );
};

export default PolyglotArtifactViewer;
