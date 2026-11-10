// SPDX-License-Identifier: AGPL-3.0-or-later
import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import { Environment, Html, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import DOMPurify from "dompurify";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { convertCadGeometry } from "../../api";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import { useToast } from "../ToastContext";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import { adaptSvgMarkupForTheme } from "./PolyglotArtifactViewer";
import SafeOrbitControls from "./SafeOrbitControls";
import type { SpatialPin } from "./spatial-pin";
import type { Verification3DOverlayPayload } from "@modelscript/cad";
import ViewportCameraControls, { type CameraPreset, type ClipAxis, type RenderMode } from "./ViewportCameraControls";

interface CadStepViewerProps {
  artifactId?: number | undefined;
  viewConfig: any;
  isFullScreen?: boolean | undefined;
  onPinCreated?: ((pin: SpatialPin) => void) | undefined;
  verificationOverlay?: Verification3DOverlayPayload | undefined;
}

export type StepViewTab = "3d" | "diagram" | "code";

interface StepEntityNode {
  id: string;
  entityType: string;
  label: string;
  refs: string[];
  tier: 0 | 1 | 2;
}

const CORE_STEP_ENTITY_TYPES = [
  "PRODUCT",
  "NEXT_ASSEMBLY_USAGE_OCCURRENCE",
  "ADVANCED_BREP_SHAPE_REPRESENTATION",
  "MANIFOLD_SOLID_BREP",
  "AXIS2_PLACEMENT_3D",
] as const;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getEntityTier(entityType: string): 0 | 1 | 2 {
  if (
    entityType === "PRODUCT" ||
    entityType === "NEXT_ASSEMBLY_USAGE_OCCURRENCE" ||
    entityType.startsWith("PRODUCT_")
  ) {
    return 0;
  }
  if (entityType === "ADVANCED_BREP_SHAPE_REPRESENTATION" || entityType.includes("REPRESENTATION")) {
    return 1;
  }
  return 2;
}

function parseStepExpressDiagram(stepText: string): {
  svg: string;
  entityCounts: Record<string, number>;
  totalEntities: number;
} {
  const entityCounts: Record<string, number> = {
    PRODUCT: 0,
    NEXT_ASSEMBLY_USAGE_OCCURRENCE: 0,
    ADVANCED_BREP_SHAPE_REPRESENTATION: 0,
    MANIFOLD_SOLID_BREP: 0,
    AXIS2_PLACEMENT_3D: 0,
  };

  const allParsedEntities = new Map<string, StepEntityNode>();
  const allNodes: StepEntityNode[] = [];
  const otherNodes: StepEntityNode[] = [];
  const stmtRegex = /(#[0-9]+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(([^;]*)\)\s*;/g;
  let match: RegExpExecArray | null;
  let totalEntities = 0;

  while ((match = stmtRegex.exec(stepText)) !== null) {
    totalEntities++;
    const id = match[1]!;
    const entityType = match[2]!;
    const argsText = match[3] || "";

    entityCounts[entityType] = (entityCounts[entityType] || 0) + 1;

    const strMatch = argsText.match(/'([^']+)'/);
    const rawName = strMatch?.[1]?.trim() || "";
    const refs = Array.from(new Set(Array.from(argsText.matchAll(/#(\d+)/g), (m) => `#${m[1]}`)));
    const node: StepEntityNode = {
      id,
      entityType,
      label: rawName || entityType,
      refs,
      tier: getEntityTier(entityType),
    };
    allParsedEntities.set(id, node);

    const isCore = (CORE_STEP_ENTITY_TYPES as readonly string[]).includes(entityType);
    const isSecondary =
      entityType === "PRODUCT_DEFINITION" ||
      entityType === "CLOSED_SHELL" ||
      entityType === "ADVANCED_FACE" ||
      entityType === "CARTESIAN_POINT";

    if (isCore || (isSecondary && allNodes.length < 12)) {
      allNodes.push(node);
    } else if (otherNodes.length < 12) {
      otherNodes.push(node);
    }
  }

  if (allNodes.length < 12 && otherNodes.length > 0) {
    for (const n of otherNodes) {
      if (allNodes.length >= 12) break;
      allNodes.push(n);
    }
  }

  const selectedNodes = allNodes.slice(0, 12);
  const tiers: [StepEntityNode[], StepEntityNode[], StepEntityNode[]] = [[], [], []];
  for (const node of selectedNodes) {
    tiers[node.tier].push(node);
  }

  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();
  const colX = [36, 336, 636];
  const cardW = 248;
  const cardH = 68;

  tiers.forEach((tierNodes, tierIdx) => {
    tierNodes.forEach((node, rowIdx) => {
      const x = colX[tierIdx]!;
      const y = 74 + rowIdx * 92;
      nodePositions.set(node.id, { x, y, w: cardW, h: cardH });
    });
  });

  const maxRows = Math.max(tiers[0].length, tiers[1].length, tiers[2].length, 2);
  const svgWidth = 920;
  const svgHeight = Math.max(300, 96 + maxRows * 92);

  // Build directed edges from actual #id references in entity argument lists (direct + 1-hop transitive)
  const edgePaths: string[] = [];
  const drawnPairs = new Set<string>();

  const addEdge = (fromId: string, toId: string, relationLabel?: string) => {
    const key = `${fromId}->${toId}`;
    if (drawnPairs.has(key) || fromId === toId) return;
    const src = nodePositions.get(fromId);
    const dst = nodePositions.get(toId);
    if (!src || !dst) return;
    drawnPairs.add(key);

    const x1 = src.x <= dst.x ? src.x + src.w : src.x;
    const y1 = src.y + src.h / 2;
    const x2 = src.x <= dst.x ? dst.x : dst.x + dst.w;
    const y2 = dst.y + dst.h / 2;
    const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
    const c1x = src.x <= dst.x ? x1 + dx : x1 - dx;
    const c2x = src.x <= dst.x ? x2 - dx : x2 + dx;

    edgePaths.push(
      `<path d="M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}" fill="none" stroke="#38bdf8" stroke-width="1.75" stroke-opacity="0.7" marker-end="url(#step-express-arrow)" />`,
    );
    if (relationLabel) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - 6;
      edgePaths.push(
        `<text x="${mx}" y="${my}" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="9.5">${escapeXml(relationLabel)}</text>`,
      );
    }
  };

  for (const node of selectedNodes) {
    for (const ref of node.refs) {
      if (nodePositions.has(ref)) {
        addEdge(node.id, ref, ref);
      } else {
        const intermediate = allParsedEntities.get(ref);
        if (intermediate) {
          for (const subRef of intermediate.refs) {
            if (nodePositions.has(subRef)) {
              addEdge(node.id, subRef, `${ref}→${subRef}`);
            }
          }
        }
      }
    }
  }

  const tierColors: { stroke: string; badgeBg: string; badgeFg: string; title: string }[] = [
    {
      stroke: "#38bdf8",
      badgeBg: "rgba(56, 189, 248, 0.16)",
      badgeFg: "#38bdf8",
      title: "TIER 1 · PRODUCT & ASSEMBLY STRUCTURE",
    },
    {
      stroke: "#a855f7",
      badgeBg: "rgba(168, 85, 247, 0.16)",
      badgeFg: "#c084fc",
      title: "TIER 2 · SHAPE REPRESENTATION",
    },
    {
      stroke: "#10b981",
      badgeBg: "rgba(16, 185, 129, 0.16)",
      badgeFg: "#34d399",
      title: "TIER 3 · B-REP SOLID & PLACEMENT",
    },
  ];

  const headersSvg = tierColors
    .map(
      (t, idx) => `
      <g transform="translate(${colX[idx]}, 24)">
        <rect width="${cardW}" height="30" rx="6" fill="#0f172a" stroke="${t.stroke}" stroke-opacity="0.45" />
        <text x="12" y="19" fill="${t.badgeFg}" font-family="monospace" font-size="10" font-weight="700">${escapeXml(t.title)}</text>
      </g>`,
    )
    .join("\n");

  const nodesSvg = selectedNodes
    .map((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return "";
      const palette = tierColors[node.tier]!;
      const shortType = node.entityType.length > 31 ? `${node.entityType.slice(0, 29)}..` : node.entityType;
      const shortLabel = node.label.length > 30 ? `${node.label.slice(0, 28)}..` : node.label;
      const refsPreview = node.refs.length > 0 ? `refs: ${node.refs.slice(0, 4).join(", ")}` : "ISO-10303-21 entity";

      return `
      <g transform="translate(${pos.x}, ${pos.y})">
        <rect width="${pos.w}" height="${pos.h}" rx="8" fill="#111827" stroke="${palette.stroke}" stroke-width="1.5" />
        <rect x="10" y="10" width="44" height="18" rx="4" fill="${palette.badgeBg}" />
        <text x="32" y="22" text-anchor="middle" fill="${palette.badgeFg}" font-family="monospace" font-size="10.5" font-weight="700">${escapeXml(node.id)}</text>
        <text x="62" y="22" fill="#f8fafc" font-family="monospace" font-size="10.5" font-weight="700">${escapeXml(shortType)}</text>
        <text x="12" y="42" fill="#cbd5e1" font-family="sans-serif" font-size="11.5" font-weight="600">${escapeXml(shortLabel)}</text>
        <text x="12" y="58" fill="#64748b" font-family="monospace" font-size="9.5">${escapeXml(refsPreview)}</text>
      </g>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%">
    <defs>
      <marker id="step-express-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
      </marker>
    </defs>
    <rect width="${svgWidth}" height="${svgHeight}" rx="8" fill="#090d16" />
    ${headersSvg}
    ${edgePaths.join("\n")}
    ${nodesSvg}
  </svg>`;

  return {
    svg,
    entityCounts,
    totalEntities: Math.max(totalEntities, selectedNodes.length),
  };
}

function highlightStepLine(line: string): React.ReactNode {
  if (!line) return " ";
  const tokenRegex =
    /(\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b(?:ISO-10303-21|END-ISO-10303-21|HEADER|ENDSEC|DATA)\s*;?|#[0-9]+|\.[A-Z0-9_]+\.|\b[A-Z][A-Z0-9_]{2,}\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let tokenKey = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      parts.push(line.slice(lastIdx, match.index));
    }
    const token = match[0]!;
    let color = "var(--ms-text-1)";
    let fontWeight: number | undefined;

    if (token.startsWith("/*")) {
      color = "var(--ms-text-3)";
    } else if (token.startsWith("'")) {
      color = "#34d399";
    } else if (/^(?:ISO-10303-21|END-ISO-10303-21|HEADER|ENDSEC|DATA)\b/.test(token)) {
      color = "#c084fc";
      fontWeight = 700;
    } else if (token.startsWith("#")) {
      color = "#fbbf24";
      fontWeight = 600;
    } else if (token.startsWith(".") && token.endsWith(".")) {
      color = "#f472b6";
    } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(token)) {
      color = "#38bdf8";
      fontWeight = 600;
    } else {
      color = "#a78bfa";
    }

    parts.push(
      <span key={tokenKey++} style={{ color, ...(fontWeight ? { fontWeight } : {}) }}>
        {token}
      </span>,
    );
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < line.length) {
    parts.push(line.slice(lastIdx));
  }

  return parts;
}

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <Box
        p={4}
        display="flex"
        justifyContent="center"
        alignItems="center"
        bg="var(--color-canvas-subtle)"
        borderRadius="8px"
        width="200px"
      >
        <Spinner size="medium" />
        <Text style={{ marginLeft: "12px" }}>{progress.toFixed(0)}% loaded</Text>
      </Box>
    </Html>
  );
}

function CameraController({
  controlsRef,
  presetTrigger,
}: {
  controlsRef: React.RefObject<any>;
  presetTrigger: { preset: CameraPreset; timestamp: number } | null;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!presetTrigger || !controlsRef.current) return;
    const controls = controlsRef.current;
    const target = controls.target || new THREE.Vector3(0, 0, 0);
    const dist = 50;

    switch (presetTrigger.preset) {
      case "iso": {
        const d = dist / Math.sqrt(3);
        camera.position.set(target.x + d, target.y + d, target.z + d);
        break;
      }
      case "top": {
        camera.position.set(target.x, target.y + dist, target.z + 0.001);
        break;
      }
      case "front": {
        camera.position.set(target.x, target.y, target.z + dist);
        break;
      }
      case "right": {
        camera.position.set(target.x + dist, target.y, target.z);
        break;
      }
      case "reset": {
        camera.position.set(0, 0, 50);
        target.set(0, 0, 0);
        break;
      }
    }
    camera.lookAt(target);
    controls.update();
  }, [presetTrigger, camera, controlsRef]);

  return null;
}

interface RawStepMeshData {
  name?: string | undefined;
  color?: [number, number, number] | undefined;
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] } | undefined;
  };
  index?: { array: number[] } | undefined;
}

function tessellateStepBRepClient(srcText: string): RawStepMeshData[] {
  const ptMap = new Map<string, [number, number, number]>();
  const cpRegex =
    /(#\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = cpRegex.exec(srcText)) !== null) {
    const pt: [number, number, number] = [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)];
    if (Number.isFinite(pt[0]) && Number.isFinite(pt[1]) && Number.isFinite(pt[2])) {
      ptMap.set(m[1]!, pt);
    }
  }

  const dirMap = new Map<string, [number, number, number]>();
  const dirRegex =
    /(#\d+)\s*=\s*DIRECTION\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  while ((m = dirRegex.exec(srcText)) !== null) {
    dirMap.set(m[1]!, [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)]);
  }

  const axis2Map = new Map<
    string,
    { loc: [number, number, number]; axis: [number, number, number]; refDir: [number, number, number] }
  >();
  const axRegex =
    /(#\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*(?:,\s*(#\d+|\$)\s*(?:,\s*(#\d+|\$))?)?\s*\)/gi;
  while ((m = axRegex.exec(srcText)) !== null) {
    const loc = ptMap.get(m[2]!) ?? [0, 0, 0];
    const axis = (m[3] ? dirMap.get(m[3]) : undefined) ?? [0, 0, 1];
    const refDir = (m[4] ? dirMap.get(m[4]) : undefined) ?? [1, 0, 0];
    axis2Map.set(m[1]!, { loc, axis, refDir });
  }

  const circleMap = new Map<string, { axis2Ref: string; radius: number }>();
  const circRegex = /(#\d+)\s*=\s*CIRCLE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  while ((m = circRegex.exec(srcText)) !== null) {
    circleMap.set(m[1]!, { axis2Ref: m[2]!, radius: Math.abs(parseFloat(m[3]!)) || 1.0 });
  }

  const bsplineMap = new Map<string, [number, number, number][]>();
  const bsRegex = /(#\d+)\s*=\s*B_SPLINE_CURVE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*\d+\s*,\s*\(([^)]+)\)/gi;
  while ((m = bsRegex.exec(srcText)) !== null) {
    const ctrlRefs = m[2]!.match(/#\d+/g) || [];
    const ctrlPts: [number, number, number][] = [];
    for (const r of ctrlRefs) {
      const p = ptMap.get(r);
      if (p) ctrlPts.push(p);
    }
    if (ctrlPts.length >= 2) bsplineMap.set(m[1]!, ctrlPts);
  }

  const vpMap = new Map<string, [number, number, number]>();
  const vpRegex = /(#\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*\)/gi;
  while ((m = vpRegex.exec(srcText)) !== null) {
    const cp = ptMap.get(m[2]!);
    if (cp) vpMap.set(m[1]!, cp);
  }

  const edgeChainMap = new Map<string, [number, number, number][]>();
  const ecRegex =
    /(#\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*(#\d+)\s*(?:,\s*(#\d+))?(?:\s*,\s*(\.[TF]\.))?\s*\)/gi;
  while ((m = ecRegex.exec(srcText)) !== null) {
    const pA = vpMap.get(m[2]!) ?? ptMap.get(m[2]!);
    const pB = vpMap.get(m[3]!) ?? ptMap.get(m[3]!);
    const curveRef = m[4];
    const sameSense = (m[5] ? m[5].toUpperCase() : ".T.") !== ".F.";
    if (pA && pB) {
      const circ = curveRef ? circleMap.get(curveRef) : undefined;
      const bspline = curveRef ? bsplineMap.get(curveRef) : undefined;
      if (circ) {
        const ax = axis2Map.get(circ.axis2Ref) ?? {
          loc: [0, 0, 0] as [number, number, number],
          axis: [0, 0, 1] as [number, number, number],
          refDir: [1, 0, 0] as [number, number, number],
        };
        const r = circ.radius;
        const c = ax.loc;
        const zLen = Math.hypot(ax.axis[0], ax.axis[1], ax.axis[2]) || 1;
        const z: [number, number, number] = [ax.axis[0] / zLen, ax.axis[1] / zLen, ax.axis[2] / zLen];
        const uLen = Math.hypot(ax.refDir[0], ax.refDir[1], ax.refDir[2]) || 1;
        const u: [number, number, number] = [ax.refDir[0] / uLen, ax.refDir[1] / uLen, ax.refDir[2] / uLen];
        const vRaw: [number, number, number] = [
          z[1] * u[2] - z[2] * u[1],
          z[2] * u[0] - z[0] * u[2],
          z[0] * u[1] - z[1] * u[0],
        ];
        const vLen = Math.hypot(vRaw[0], vRaw[1], vRaw[2]) || 1;
        const v: [number, number, number] = [vRaw[0] / vLen, vRaw[1] / vLen, vRaw[2] / vLen];
        const distAB = Math.hypot(pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]);
        const segs = 16;
        const chain: [number, number, number][] = [];
        if (distAB < 1e-6) {
          for (let s = 0; s < segs; s++) {
            const th = (sameSense ? 1 : -1) * (s / segs) * 2 * Math.PI;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const pt: [number, number, number] = [
              c[0] + r * (cs * u[0] + sn * v[0]),
              c[1] + r * (cs * u[1] + sn * v[1]),
              c[2] + r * (cs * u[2] + sn * v[2]),
            ];
            chain.push(pt);
          }
        } else {
          const dA = [pA[0] - c[0], pA[1] - c[1], pA[2] - c[2]];
          const dB = [pB[0] - c[0], pB[1] - c[1], pB[2] - c[2]];
          const thA = Math.atan2(
            dA[0]! * v[0] + dA[1]! * v[1] + dA[2]! * v[2],
            dA[0]! * u[0] + dA[1]! * u[1] + dA[2]! * u[2],
          );
          let thB = Math.atan2(
            dB[0]! * v[0] + dB[1]! * v[1] + dB[2]! * v[2],
            dB[0]! * u[0] + dB[1]! * u[1] + dB[2]! * u[2],
          );
          if (sameSense) {
            while (thB <= thA + 1e-6) thB += 2 * Math.PI;
          } else {
            while (thB >= thA - 1e-6) thB -= 2 * Math.PI;
          }
          const arcSegs = Math.max(4, Math.round((Math.abs(thB - thA) / (2 * Math.PI)) * segs));
          for (let s = 0; s <= arcSegs; s++) {
            const th = thA + (s / arcSegs) * (thB - thA);
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const pt: [number, number, number] = [
              c[0] + r * (cs * u[0] + sn * v[0]),
              c[1] + r * (cs * u[1] + sn * v[1]),
              c[2] + r * (cs * u[2] + sn * v[2]),
            ];
            chain.push(pt);
          }
        }
        edgeChainMap.set(m[1]!, chain);
      } else if (bspline) {
        edgeChainMap.set(m[1]!, sameSense ? bspline : [...bspline].reverse());
      } else {
        edgeChainMap.set(m[1]!, sameSense ? [pA, pB] : [pB, pA]);
      }
    }
  }

  const oeChainMap = new Map<string, [number, number, number][]>();
  const oeRegex = /(#\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*(#\d+)\s*,\s*(\.[TF]\.)\s*\)/gi;
  while ((m = oeRegex.exec(srcText)) !== null) {
    const chain = edgeChainMap.get(m[2]!);
    if (chain && chain.length > 0) {
      const forward = m[3]!.toUpperCase() === ".T.";
      oeChainMap.set(m[1]!, forward ? chain : [...chain].reverse());
    }
  }

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  interface ParsedFaceLoop {
    id: string;
    name: string;
    group: string;
    points: [number, number, number][];
  }

  const faceLoops: ParsedFaceLoop[] = [];
  const loopRegex = /(#\d+)\s*=\s*(POLY_LOOP|EDGE_LOOP)\s*\(\s*'([^']*)'\s*,\s*\(([^)]+)\)\s*\)/gi;
  while ((m = loopRegex.exec(srcText)) !== null) {
    const id = m[1]!;
    const kind = m[2]!.toUpperCase();
    const rawName = m[3]!.trim();
    const refs = m[4]!.match(/#\d+/g) || [];
    const loopPts: [number, number, number][] = [];

    if (kind === "POLY_LOOP") {
      for (const r of refs) {
        const pt = ptMap.get(r) ?? vpMap.get(r);
        if (pt) pushUniquePt(loopPts, pt);
      }
    } else {
      const chains: [number, number, number][][] = [];
      for (const r of refs) {
        const ch = oeChainMap.get(r) ?? edgeChainMap.get(r);
        if (ch && ch.length > 0) {
          chains.push(ch);
        } else {
          const pt = ptMap.get(r) ?? vpMap.get(r);
          if (pt) chains.push([pt]);
        }
      }

      if (chains.length === 1) {
        for (const p of chains[0]!) pushUniquePt(loopPts, p);
      } else if (chains.length >= 2) {
        let first = chains[0]!;
        const second = chains[1]!;
        if (first.length >= 2 && second.length >= 1) {
          const fStart = first[0]!;
          const fEnd = first[first.length - 1]!;
          const sStart = second[0]!;
          const sEnd = second[second.length - 1]!;
          const dEnd = Math.min(dist3(fEnd, sStart), dist3(fEnd, sEnd));
          const dStart = Math.min(dist3(fStart, sStart), dist3(fStart, sEnd));
          if (dStart + 1e-6 < dEnd) {
            first = [...first].reverse();
          }
        }
        for (const p of first) pushUniquePt(loopPts, p);

        for (let i = 1; i < chains.length; i++) {
          let ch = chains[i]!;
          if (ch.length >= 2 && loopPts.length > 0) {
            const lastPt = loopPts[loopPts.length - 1]!;
            const cStart = ch[0]!;
            const cEnd = ch[ch.length - 1]!;
            if (dist3(lastPt, cEnd) + 1e-6 < dist3(lastPt, cStart)) {
              ch = [...ch].reverse();
            }
          }
          for (const p of ch) pushUniquePt(loopPts, p);
        }
      }
    }

    if (loopPts.length >= 2 && dist3(loopPts[0]!, loopPts[loopPts.length - 1]!) < 1e-5) {
      loopPts.pop();
    }
    if (loopPts.length >= 3) {
      const groupPrefix = rawName.includes("_") ? rawName.split("_")[0]! : "SolidBody";
      faceLoops.push({
        id,
        name: rawName || id,
        group: groupPrefix || "SolidBody",
        points: loopPts,
      });
    }
  }

  const palette: [number, number, number][] = [
    [0.23, 0.32, 0.42],
    [0.28, 0.42, 0.56],
    [0.34, 0.48, 0.62],
    [0.22, 0.38, 0.52],
  ];

  const triangulatePolygonEarClip = (
    poly: [number, number, number][],
    polyNormal: [number, number, number],
  ): [number, number, number][] => {
    const n = poly.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];

    const nx = Math.abs(polyNormal[0]);
    const ny = Math.abs(polyNormal[1]);
    const nz = Math.abs(polyNormal[2]);
    let uAxis = 0;
    let vAxis = 1;
    let sign = polyNormal[2] >= 0 ? 1 : -1;
    if (nx >= ny && nx >= nz) {
      uAxis = 1;
      vAxis = 2;
      sign = polyNormal[0] >= 0 ? 1 : -1;
    } else if (ny >= nx && ny >= nz) {
      uAxis = 2;
      vAxis = 0;
      sign = polyNormal[1] >= 0 ? 1 : -1;
    }

    const pts2d: [number, number][] = poly.map((p) => [p[uAxis]!, sign * p[vAxis]!]);
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
      const p1 = pts2d[i]!;
      const p2 = pts2d[(i + 1) % n]!;
      signedArea += p1[0] * p2[1] - p2[0] * p1[1];
    }
    const ccw = signedArea >= 0 ? 1 : -1;

    const cross2d = (a: [number, number], b: [number, number], c: [number, number]): number =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

    const pointInTri2d = (
      p: [number, number],
      a: [number, number],
      b: [number, number],
      c: [number, number],
    ): boolean => {
      const c1 = cross2d(a, b, p) * ccw;
      const c2 = cross2d(b, c, p) * ccw;
      const c3 = cross2d(c, a, p) * ccw;
      return c1 >= -1e-9 && c2 >= -1e-9 && c3 >= -1e-9;
    };

    const avail = Array.from({ length: n }, (_, i) => i);
    const tris: [number, number, number][] = [];
    let guard = n * n * 2;

    while (avail.length > 3 && guard-- > 0) {
      let earFound = false;
      const mLen = avail.length;
      for (let i = 0; i < mLen; i++) {
        const iPrev = avail[(i + mLen - 1) % mLen]!;
        const iCurr = avail[i]!;
        const iNext = avail[(i + 1) % mLen]!;
        const a = pts2d[iPrev]!;
        const b = pts2d[iCurr]!;
        const c = pts2d[iNext]!;
        if (cross2d(a, b, c) * ccw <= 1e-9) continue;

        let hasInside = false;
        for (let j = 0; j < mLen; j++) {
          const idx = avail[j]!;
          if (idx === iPrev || idx === iCurr || idx === iNext) continue;
          const pt = pts2d[idx]!;
          if (
            Math.hypot(pt[0] - a[0], pt[1] - a[1]) < 1e-7 ||
            Math.hypot(pt[0] - b[0], pt[1] - b[1]) < 1e-7 ||
            Math.hypot(pt[0] - c[0], pt[1] - c[1]) < 1e-7
          ) {
            continue;
          }
          if (pointInTri2d(pt, a, b, c)) {
            hasInside = true;
            break;
          }
        }
        if (!hasInside) {
          tris.push([iPrev, iCurr, iNext]);
          avail.splice(i, 1);
          earFound = true;
          break;
        }
      }
      if (!earFound) {
        const iPrev = avail[0]!;
        const iCurr = avail[1]!;
        const iNext = avail[2]!;
        tris.push([iPrev, iCurr, iNext]);
        avail.splice(1, 1);
      }
    }
    if (avail.length === 3) {
      tris.push([avail[0]!, avail[1]!, avail[2]!]);
    }
    return tris;
  };

  const buildMeshFromPolygonGroup = (
    groupName: string,
    polygons: [number, number, number][][],
    colorIdx: number,
  ): RawStepMeshData | null => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let totalPts = 0;
    for (const poly of polygons) {
      for (const p of poly) {
        cx += p[0];
        cy += p[1];
        cz += p[2];
        totalPts++;
      }
    }
    if (totalPts > 0) {
      cx /= totalPts;
      cy /= totalPts;
      cz /= totalPts;
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (const poly of polygons) {
      if (poly.length < 3) continue;
      let fcx = 0;
      let fcy = 0;
      let fcz = 0;
      let pnx = 0;
      let pny = 0;
      let pnz = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const next = poly[(i + 1) % poly.length]!;
        fcx += p[0];
        fcy += p[1];
        fcz += p[2];
        pnx += (p[1] - next[1]) * (p[2] + next[2]);
        pny += (p[2] - next[2]) * (p[0] + next[0]);
        pnz += (p[0] - next[0]) * (p[1] + next[1]);
      }
      fcx /= poly.length;
      fcy /= poly.length;
      fcz /= poly.length;

      const pnLen = Math.hypot(pnx, pny, pnz);
      if (pnLen > 1e-12) {
        pnx /= pnLen;
        pny /= pnLen;
        pnz /= pnLen;
      } else {
        pnx = 0;
        pny = 0;
        pnz = 1;
      }

      const polyOutDot = pnx * (fcx - cx) + pny * (fcy - cy) + pnz * (fcz - cz);
      if (polyOutDot < 0) {
        pnx = -pnx;
        pny = -pny;
        pnz = -pnz;
      }

      const triIndices = triangulatePolygonEarClip(poly, [pnx, pny, pnz]);
      for (const [ia, ib, ic] of triIndices) {
        const a = poly[ia]!;
        let b = poly[ib]!;
        let c = poly[ic]!;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len <= 1e-12) continue;
        nx /= len;
        ny /= len;
        nz /= len;

        const alignDot = nx * pnx + ny * pny + nz * pnz;
        if (alignDot < 0) {
          const tmp = b;
          b = c;
          c = tmp;
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }

        const baseIdx = vertices.length / 3;
        vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      }
    }

    if (indices.length === 0) return null;
    return {
      name: groupName,
      color: palette[colorIdx % palette.length],
      attributes: {
        position: { array: vertices },
        normal: { array: normals },
      },
      index: { array: indices },
    };
  };

  const meshes: RawStepMeshData[] = [];
  if (faceLoops.length > 0) {
    const grouped = new Map<string, [number, number, number][][]>();
    for (const fl of faceLoops) {
      const list = grouped.get(fl.group) ?? [];
      list.push(fl.points);
      grouped.set(fl.group, list);
    }
    let idx = 0;
    for (const [groupName, polys] of grouped.entries()) {
      const mesh = buildMeshFromPolygonGroup(groupName, polys, idx++);
      if (mesh) meshes.push(mesh);
    }
  }

  return meshes;
}

const CadStepViewer: React.FC<CadStepViewerProps> = ({
  artifactId,
  viewConfig,
  isFullScreen,
  onPinCreated,
  verificationOverlay,
}) => {
  const toast = useToast();
  const effectiveVerificationOverlay: Verification3DOverlayPayload | undefined =
    verificationOverlay || viewConfig?.verificationOverlay;

  const boundaryDefectPins = useMemo(() => {
    if (!effectiveVerificationOverlay?.spatialPins) return [];
    return effectiveVerificationOverlay.spatialPins.filter(
      (pin) =>
        pin.contractId?.startsWith("watertight_") ||
        pin.label.toLowerCase().includes("watertight") ||
        pin.label.toLowerCase().includes("boundary") ||
        pin.label.toLowerCase().includes("non-manifold") ||
        pin.severity === "error" ||
        pin.severity === "warning",
    );
  }, [effectiveVerificationOverlay]);

  const [viewTab, setViewTab] = useState<StepViewTab>("3d");
  const [stepSource, setStepSource] = useState<string>(
    () =>
      viewConfig?.code ||
      viewConfig?.stepCode ||
      viewConfig?.stepSource ||
      viewConfig?.source ||
      viewConfig?.content ||
      "",
  );
  const [isLoadingSource, setIsLoadingSource] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const [geometries, setGeometries] = useState<THREE.BufferGeometry[] | null>(null);
  const [assemblyCenter, setAssemblyCenter] = useState<THREE.Vector3 | null>(null);
  const [assemblyScale, setAssemblyScale] = useState<number>(1);
  const [explosionFactor, setExplosionFactor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("shaded");
  const [clipAxis, setClipAxis] = useState<ClipAxis>("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [probedPoint, setProbedPoint] = useState<{
    position: [number, number, number];
    worldPosition?: [number, number, number];
    partName: string;
  } | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [presetTrigger, setPresetTrigger] = useState<{ preset: CameraPreset; timestamp: number } | null>(null);
  const controlsRef = useRef<any>(null);
  const stepSourceRef = useRef(stepSource);
  useEffect(() => {
    stepSourceRef.current = stepSource;
  }, [stepSource]);

  const activeClippingPlanes = useMemo(() => {
    if (clipAxis === "none") return [];
    const span = 22;
    const d = clipOffset * span;
    if (clipAxis === "x") return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), d)];
    if (clipAxis === "y") return [new THREE.Plane(new THREE.Vector3(0, -1, 0), d)];
    return [new THREE.Plane(new THREE.Vector3(0, 0, -1), d)];
  }, [clipAxis, clipOffset]);

  const navigate = useNavigate();

  const stepUrl: string =
    viewConfig?.url || viewConfig?.stepUrl || viewConfig?.fileUrl || viewConfig?.downloadUrl || viewConfig?.path || "";

  const modelTitle: string =
    viewConfig?.title ||
    viewConfig?.modelName ||
    (typeof stepUrl === "string" && stepUrl.split("/").pop()) ||
    "STEP CAD Assembly";

  useEffect(() => {
    const inlineCode =
      viewConfig?.code || viewConfig?.stepCode || viewConfig?.stepSource || viewConfig?.source || viewConfig?.content;
    if (typeof inlineCode === "string" && inlineCode.trim().length > 0) {
      setStepSource(inlineCode);
    }
  }, [viewConfig]);

  // Lazily fetch raw STEP source when user switches to "code" or "diagram"
  useEffect(() => {
    if (viewTab !== "code" && viewTab !== "diagram") return;
    const inlineCode =
      viewConfig?.code || viewConfig?.stepCode || viewConfig?.stepSource || viewConfig?.source || viewConfig?.content;
    if (typeof inlineCode === "string" && inlineCode.trim().length > 0) {
      setStepSource(inlineCode);
      return;
    }
    if (stepSource.trim().length > 0) return;

    if (!stepUrl) {
      return;
    }

    let cancelled = false;
    setIsLoadingSource(true);

    async function fetchStepText() {
      try {
        const res = await fetch(stepUrl);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled && text.trim().length > 0) {
            setStepSource(text);
            return;
          }
        }
        if (!stepUrl.startsWith("http") && !stepUrl.startsWith("/api")) {
          const fallbackRes = await fetch(`/api${stepUrl.startsWith("/") ? "" : "/"}${stepUrl}`);
          if (fallbackRes.ok) {
            const text = await fallbackRes.text();
            if (!cancelled && text.trim().length > 0) {
              setStepSource(text);
              return;
            }
          }
        }
      } catch {
        // Ignore fetch error
      } finally {
        if (!cancelled) {
          setIsLoadingSource(false);
        }
      }
    }

    fetchStepText();
    return () => {
      cancelled = true;
    };
  }, [viewTab, stepUrl, stepSource, viewConfig]);

  const effectiveStepSource = stepSource;

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const pregenExpressSvg = typeof viewConfig?.expressSvg === "string" ? viewConfig.expressSvg : "";

  const expressDiagram = useMemo(() => {
    if (viewTab !== "diagram" && viewTab !== "code") {
      return {
        svg: "",
        entityCounts: Object.fromEntries(CORE_STEP_ENTITY_TYPES.map((k) => [k, 0])),
        totalEntities: 0,
      };
    }
    const parsed = parseStepExpressDiagram(effectiveStepSource);
    const rawSvg = pregenExpressSvg.trim().length > 0 ? DOMPurify.sanitize(pregenExpressSvg) : parsed.svg;
    return {
      ...parsed,
      svg: adaptSvgMarkupForTheme(rawSvg, isDark),
    };
  }, [viewTab, pregenExpressSvg, effectiveStepSource, isDark]);

  const handleOpenInPlayground = () => {
    const targetUrl = buildEditorUrlForArtifact({
      artifactId: artifactId ?? viewConfig?.artifactId ?? viewConfig?.id,
      viewType: "cad-step",
      viewConfig,
      code: stepSource.trim().length > 0 ? stepSource : viewConfig?.code || viewConfig?.stepSource || undefined,
      title: modelTitle,
      dialect: "step",
    });
    navigate(targetUrl);
  };

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(effectiveStepSource);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy STEP source to clipboard");
    }
  };

  useEffect(() => {
    let active = true;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadStep() {
      try {
        setError(null);
        let rawMeshes: any[] | null = null;

        // 1. Direct meshes array already supplied in viewConfig
        if (Array.isArray(viewConfig?.meshes) && viewConfig.meshes.length > 0) {
          rawMeshes = viewConfig.meshes;
        } else if (stepUrl) {
          // Fast-path: check for pre-tessellated CAD mesh endpoint
          const meshFastPathUrl =
            viewConfig?.meshUrl ||
            (typeof stepUrl === "string" && stepUrl.includes("/resources/")
              ? stepUrl.replace("/resources/", "/cad-mesh/")
              : null);

          if (meshFastPathUrl) {
            try {
              const res = await fetch(meshFastPathUrl);
              if (res.ok) {
                const cachedData = await res.json();
                if (cachedData && Array.isArray(cachedData.meshes) && cachedData.meshes.length > 0) {
                  rawMeshes = cachedData.meshes;
                }
              }
            } catch {
              // Fallback to convertCadGeometry below
            }
          }

          // Fallback: Fetch converted CAD geometry from backend converter
          if (!rawMeshes) {
            try {
              const result = await convertCadGeometry(stepUrl);
              if (result && Array.isArray(result.meshes) && result.meshes.length > 0) {
                rawMeshes = result.meshes;
              }
            } catch {
              // Fall back to client-side STEP B-Rep tessellation below
            }
          }
        }

        // 2. Client-side STEP B-Rep tessellation fallback from inline source or fetched STEP text
        if (!rawMeshes || rawMeshes.length === 0) {
          let sourceText: string =
            viewConfig?.code ||
            viewConfig?.stepCode ||
            viewConfig?.stepSource ||
            viewConfig?.source ||
            viewConfig?.content ||
            stepSourceRef.current ||
            "";
          if (!sourceText.trim() && stepUrl) {
            try {
              const res = await fetch(stepUrl);
              if (res.ok) {
                sourceText = await res.text();
              } else if (!stepUrl.startsWith("http") && !stepUrl.startsWith("/api")) {
                const fallbackRes = await fetch(`/api${stepUrl.startsWith("/") ? "" : "/"}${stepUrl}`);
                if (fallbackRes.ok) {
                  sourceText = await fallbackRes.text();
                }
              }
            } catch {
              // Ignore fetch errors
            }
          }
          if (active && sourceText.trim().length > 0 && !stepSourceRef.current.trim()) {
            setStepSource(sourceText);
          }
          if (sourceText.trim().length > 0) {
            const clientMeshes = tessellateStepBRepClient(sourceText);
            if (clientMeshes.length > 0) {
              rawMeshes = clientMeshes;
            }
          }
        }

        if (rawMeshes && rawMeshes.length > 0 && active) {
          const geos: THREE.BufferGeometry[] = [];
          const boundingBox = new THREE.Box3();

          for (const meshData of rawMeshes) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3));
            if (meshData.attributes.normal) {
              geo.setAttribute("normal", new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3));
            } else {
              geo.computeVertexNormals();
            }
            if (meshData.index) {
              geo.setIndex(new THREE.Uint32BufferAttribute(meshData.index.array, 1));
            }
            geo.userData = {
              name: meshData.name,
              color: meshData.color,
            };
            geo.computeBoundingSphere();
            geo.computeBoundingBox();
            if (geo.boundingBox) {
              boundingBox.union(geo.boundingBox);
            }
            geos.push(geo);
          }

          const center = new THREE.Vector3();
          boundingBox.getCenter(center);

          const sphere = new THREE.Sphere();
          boundingBox.getBoundingSphere(sphere);
          const scale = sphere.radius > 0 ? 20 / sphere.radius : 1;

          setGeometries(geos);
          setAssemblyCenter(center);
          setAssemblyScale(scale);

          readyTimer = setTimeout(() => {
            if (active) {
              (window as any).__ARTIFACT_READY = true;
            }
          }, 1500);
        } else if (active) {
          setError("No CAD geometry meshes available for this STEP model.");
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : "Error parsing STEP file");
        }
      }
    }

    loadStep();

    return () => {
      active = false;
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [viewConfig, stepUrl, modelTitle]);

  useEffect(() => {
    return () => {
      geometries?.forEach((g) => g.dispose());
    };
  }, [geometries]);

  const meshItems = useMemo(() => {
    if (!geometries) return [];
    return geometries.map((geo, idx) => {
      const meshCenter = geo.boundingSphere?.center;
      const offset: [number, number, number] =
        assemblyCenter && meshCenter && explosionFactor > 0
          ? [
              (meshCenter.x - assemblyCenter.x) * explosionFactor,
              (meshCenter.y - assemblyCenter.y) * explosionFactor,
              (meshCenter.z - assemblyCenter.z) * explosionFactor,
            ]
          : [0, 0, 0];
      const compName =
        typeof geo.userData?.name === "string" && geo.userData.name.trim().length > 0
          ? geo.userData.name
          : `CAD Component #${idx + 1}`;
      const rgb = Array.isArray(geo.userData?.color) ? geo.userData.color : null;
      const matColor =
        rgb && rgb.length >= 3 ? new THREE.Color(Number(rgb[0]), Number(rgb[1]), Number(rgb[2])) : "#3b526b";
      return { geo, idx, offset, compName, matColor };
    });
  }, [geometries, assemblyCenter, explosionFactor]);

  const codeLines = useMemo(
    () => (viewTab === "code" ? effectiveStepSource.split(/\r?\n/) : []),
    [viewTab, effectiveStepSource],
  );

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "450px"}
      borderRadius="0"
      overflow="hidden"
      position="relative"
      display="flex"
      flexDirection="column"
      border="none"
      style={{ background: "transparent" }}
    >
      {/* Top Toolbar with Segmented View Toggle (3D CAD / 2D EXPRESS / Source) */}
      <Box
        height="44px"
        minHeight="44px"
        px={3}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        bg="var(--surface-hud, rgba(14, 20, 36, 0.85))"
        borderBottom="1px solid var(--color-border-default, #30363d)"
        zIndex={20}
      >
        <Box display="flex" alignItems="center" gap={2} minWidth={0}>
          {!isFullScreen && (
            <Text
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-fg-default, #e6edf3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {modelTitle}
            </Text>
          )}
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: "999px",
              background: "rgba(56, 189, 248, 0.15)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
            }}
          >
            ISO-10303-21 STEP
          </span>
          {effectiveVerificationOverlay && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: "999px",
                background: effectiveVerificationOverlay.isCertifiedSafe
                  ? "rgba(16, 185, 129, 0.15)"
                  : "rgba(239, 68, 68, 0.15)",
                color: effectiveVerificationOverlay.isCertifiedSafe ? "#34d399" : "#f87171",
                border: `1px solid ${
                  effectiveVerificationOverlay.isCertifiedSafe
                    ? "rgba(16, 185, 129, 0.35)"
                    : "rgba(239, 68, 68, 0.35)"
                }`,
                fontFamily: "var(--font-mono, monospace)",
                whiteSpace: "nowrap",
              }}
            >
              {effectiveVerificationOverlay.isCertifiedSafe
                ? "🛡️ CERTIFIED WATERTIGHT"
                : `⚠️ ${boundaryDefectPins.length > 0 ? "TOPOLOGY DEFECT" : "CONTRACT VIOLATION"}`}
            </span>
          )}
        </Box>

        <Box display="flex" alignItems="center" gap={2}>
          <div
            role="tablist"
            aria-label="STEP Viewer Mode"
            style={{
              display: "inline-flex",
              background: "var(--color-canvas-default, rgba(15, 23, 42, 0.75))",
              border: "1px solid var(--color-border-default, #30363d)",
              borderRadius: "6px",
              padding: "2px",
              gap: "2px",
            }}
          >
            {[
              { id: "3d" as const, label: "3D CAD" },
              { id: "diagram" as const, label: "2D EXPRESS" },
              { id: "code" as const, label: "Source" },
            ].map((tab) => {
              const active = viewTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setViewTab(tab.id)}
                  style={{
                    background: active ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: active ? "#38bdf8" : "var(--color-fg-muted, #8b949e)",
                    border: active ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                    borderRadius: "4px",
                    padding: "3px 10px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </Box>
      </Box>

      {/* Main Content Area */}
      <Box flex={1} position="relative" overflow="hidden" display="flex" flexDirection="column">
        {viewTab === "3d" && (
          <Box flex={1} position="relative" width="100%" height="100%" style={{ background: "transparent" }}>
            {error ? (
              <Box
                p={4}
                height="100%"
                display="flex"
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                gap={3}
                backgroundColor="var(--color-danger-subtle)"
              >
                <Text style={{ color: "var(--color-danger-fg)", fontWeight: 500 }}>{error}</Text>
                <Box display="flex" gap={2}>
                  <Button size="small" onClick={() => setViewTab("diagram")}>
                    Switch to 2D EXPRESS Diagram
                  </Button>
                  <Button size="small" onClick={() => setViewTab("code")}>
                    View STEP Source
                  </Button>
                </Box>
              </Box>
            ) : !geometries ? (
              <Box
                p={4}
                display="flex"
                justifyContent="center"
                alignItems="center"
                height="100%"
                style={{ background: "transparent" }}
              >
                <Spinner size="medium" />
                <Text style={{ marginLeft: "12px" }}>Parsing CAD model...</Text>
              </Box>
            ) : (
              <>
                <ViewportCameraControls
                  onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })}
                  renderMode={renderMode}
                  onRenderModeChange={setRenderMode}
                  clipAxis={clipAxis}
                  onClipAxisChange={setClipAxis}
                  clipOffset={clipOffset}
                  onClipOffsetChange={setClipOffset}
                  isPinMode={isPinMode}
                  onTogglePinMode={() => setIsPinMode(!isPinMode)}
                />

                {probedPoint && (
                  <Box
                    position="absolute"
                    top={12}
                    right={12}
                    zIndex={10}
                    px={2}
                    py={1}
                    borderRadius="8px"
                    bg="rgba(15, 23, 42, 0.85)"
                    border="1px solid rgba(56, 189, 248, 0.35)"
                    display="flex"
                    alignItems="center"
                    gap={2}
                    style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", color: "#e2e8f0" }}
                  >
                    <span style={{ color: "#38bdf8", fontWeight: 700 }}>{probedPoint.partName}</span>
                    <span>
                      ({probedPoint.position[0].toFixed(2)}, {probedPoint.position[1].toFixed(2)},{" "}
                      {probedPoint.position[2].toFixed(2)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setProbedPoint(null)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        padding: "0 2px",
                        fontSize: "11px",
                      }}
                      aria-label="Clear surface probe"
                    >
                      ✕
                    </button>
                  </Box>
                )}

                <Canvas
                  gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
                  camera={{ position: [0, 0, 50], fov: 50 }}
                >
                  <AutoThumbnailCapture
                    artifactId={artifactId}
                    hasThumbnail={Boolean(viewConfig?.thumbnailUrl || viewConfig?.thumbnail_url)}
                  />
                  <ambientLight intensity={0.45} />
                  <directionalLight position={[20, 30, 25]} intensity={0.9} />
                  <directionalLight position={[-20, -15, -10]} intensity={0.35} />
                  <spotLight position={[10, 10, 10]} angle={0.25} penumbra={1} intensity={0.35} castShadow />

                  <Suspense fallback={null}>
                    {/* Local HDRI Texture */}
                    <Environment files="/hdri/studio.hdr" environmentIntensity={0.35} />
                  </Suspense>
                  <Suspense fallback={<Loader />}>
                    <group
                      scale={[assemblyScale, assemblyScale, assemblyScale]}
                      position={
                        assemblyCenter
                          ? [
                              -assemblyCenter.x * assemblyScale,
                              -assemblyCenter.y * assemblyScale,
                              -assemblyCenter.z * assemblyScale,
                            ]
                          : [0, 0, 0]
                      }
                    >
                      {meshItems.map(({ geo, idx, offset, compName, matColor }) => {
                        const isDefective = boundaryDefectPins.some(
                          (pin) =>
                            pin.contractId === `watertight_${compName}` ||
                            pin.label.includes(compName) ||
                            (boundaryDefectPins.length > 0 && meshItems.length === 1),
                        );
                        return (
                          <group key={idx}>
                            <mesh
                              geometry={geo}
                              position={offset}
                              onClick={(e) => {
                                e.stopPropagation();
                                const invScale = assemblyScale > 1e-9 ? 1 / assemblyScale : 1;
                                const cadPos: [number, number, number] = [
                                  e.point.x * invScale - offset[0] + (assemblyCenter?.x ?? 0),
                                  e.point.y * invScale - offset[1] + (assemblyCenter?.y ?? 0),
                                  e.point.z * invScale - offset[2] + (assemblyCenter?.z ?? 0),
                                ];
                                setProbedPoint({
                                  position: cadPos,
                                  worldPosition: [e.point.x, e.point.y, e.point.z],
                                  partName: compName,
                                });
                                if (isPinMode && onPinCreated) {
                                  onPinCreated({
                                    worldPosition: cadPos,
                                    cameraPosition: [e.camera.position.x, e.camera.position.y, e.camera.position.z],
                                    cameraTarget: cadPos,
                                    fieldName: compName,
                                    scalarValue: idx + 1,
                                  });
                                  setIsPinMode(false);
                                }
                              }}
                            >
                              <meshPhysicalMaterial
                                color={matColor}
                                metalness={0.28}
                                roughness={0.48}
                                wireframe={renderMode === "wireframe"}
                                transparent={renderMode === "xray"}
                                opacity={renderMode === "xray" ? 0.35 : 1.0}
                                clearcoat={0.1}
                                side={THREE.DoubleSide}
                                clippingPlanes={activeClippingPlanes}
                                clipShadows={true}
                              />
                            </mesh>
                            {isDefective && (
                              <lineSegments position={offset}>
                                <edgesGeometry args={[geo, 15]} />
                                <lineBasicMaterial color="#f97316" depthTest={false} transparent opacity={0.95} />
                              </lineSegments>
                            )}
                          </group>
                        );
                      })}
                      {boundaryDefectPins.map((pin) => (
                        <group key={pin.id} position={pin.position}>
                          <mesh>
                            <sphereGeometry args={[0.5, 16, 16]} />
                            <meshBasicMaterial color={pin.severity === "error" ? "#ef4444" : "#f97316"} />
                          </mesh>
                          <Html distanceFactor={22} center>
                            <div
                              style={{
                                background: "rgba(15, 23, 42, 0.95)",
                                border: `1px solid ${pin.severity === "error" ? "#ef4444" : "#f97316"}`,
                                borderRadius: "6px",
                                padding: "3px 8px",
                                whiteSpace: "nowrap",
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#f8fafc",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                                pointerEvents: "none",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span>⚠️</span>
                              <span>{pin.label}</span>
                            </div>
                          </Html>
                        </group>
                      ))}
                    </group>
                    {probedPoint?.worldPosition && (
                      <mesh position={probedPoint.worldPosition}>
                        <sphereGeometry args={[0.38, 16, 16]} />
                        <meshBasicMaterial color="#38bdf8" />
                      </mesh>
                    )}
                    <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} />
                  </Suspense>
                  <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} />
                </Canvas>

                <Box
                  position="absolute"
                  bottom={16}
                  left="50%"
                  style={{ transform: "translateX(-50%)" }}
                  display="flex"
                  alignItems="center"
                  bg="var(--color-canvas-overlay)"
                  p={2}
                  borderRadius="8px"
                  boxShadow="var(--color-shadow-medium)"
                  gap={2}
                >
                  <Text style={{ fontSize: "12px", fontWeight: "bold" }}>Explode</Text>
                  <input
                    type="range"
                    aria-label="Assembly explode factor"
                    min="0"
                    max="2"
                    step="0.01"
                    value={explosionFactor}
                    onChange={(e) => setExplosionFactor(parseFloat(e.target.value))}
                    style={{ width: "150px" }}
                  />
                </Box>
              </>
            )}
          </Box>
        )}

        {viewTab === "diagram" && (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            overflow="auto"
            p={3}
            bg="var(--color-canvas-default, #0d1117)"
            gap={3}
          >
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                {CORE_STEP_ENTITY_TYPES.map((entityName) => (
                  <span
                    key={entityName}
                    style={{
                      fontSize: "10px",
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: "rgba(56, 189, 248, 0.1)",
                      color: "#38bdf8",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                    }}
                  >
                    {entityName}: {expressDiagram.entityCounts[entityName] ?? 0}
                  </span>
                ))}
              </Box>
              {Boolean(viewConfig?.standalone) && (
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={DraftingTriangleIcon}
                  onClick={handleOpenInPlayground}
                >
                  Open in Morsel
                </Button>
              )}
            </Box>

            {isLoadingSource ? (
              <Box flex={1} display="flex" justifyContent="center" alignItems="center" minHeight="240px">
                <Spinner size="medium" />
                <Text style={{ marginLeft: "12px" }}>Extracting EXPRESS entity graph...</Text>
              </Box>
            ) : (
              <Box
                flex={1}
                display="flex"
                justifyContent="center"
                alignItems="center"
                overflow="auto"
                border="1px solid var(--color-border-default, #30363d)"
                borderRadius="6px"
                bg="var(--color-canvas-default, #090d16)"
                p={2}
                dangerouslySetInnerHTML={{ __html: expressDiagram.svg }}
              />
            )}
          </Box>
        )}

        {viewTab === "code" && (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            overflow="hidden"
            bg="var(--color-canvas-default, #0d1117)"
          >
            <Box
              px={3}
              py={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              borderBottom="1px solid var(--color-border-default, #30363d)"
              bg="var(--color-canvas-subtle, #161b22)"
            >
              <Text
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-fg-muted, #8b949e)",
                }}
              >
                ISO-10303-21 STEP Physical File · {codeLines.length} lines · {expressDiagram.totalEntities} entities
              </Text>
              <Box display="flex" alignItems="center" gap={2}>
                <Button
                  size="small"
                  leadingVisual={copied ? CheckIcon : CopyIcon}
                  onClick={handleCopySource}
                  aria-label="Copy STEP source"
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
                {Boolean(viewConfig?.standalone) && (
                  <Button
                    size="small"
                    variant="primary"
                    leadingVisual={DraftingTriangleIcon}
                    onClick={handleOpenInPlayground}
                  >
                    Open in Morsel
                  </Button>
                )}
              </Box>
            </Box>

            {isLoadingSource ? (
              <Box flex={1} display="flex" justifyContent="center" alignItems="center">
                <Spinner size="medium" />
                <Text style={{ marginLeft: "12px" }}>Loading ISO-10303-21 STEP source...</Text>
              </Box>
            ) : (
              <Box
                flex={1}
                py={2}
                overflow="auto"
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  lineHeight: 1.55,
                }}
              >
                {codeLines.map((line, idx) => (
                  <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                    <span
                      style={{
                        userSelect: "none",
                        width: "40px",
                        minWidth: "40px",
                        textAlign: "right",
                        paddingRight: "14px",
                        color: "var(--color-fg-subtle, #6e7681)",
                        fontSize: "11px",
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ whiteSpace: "pre", color: "var(--color-fg-default, #e6edf3)" }}>
                      {highlightStepLine(line)}
                    </span>
                  </div>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default CadStepViewer;
