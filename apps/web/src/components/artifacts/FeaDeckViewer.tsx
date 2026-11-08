// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, EyeIcon, VersionsIcon, WorkflowIcon, ZapIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import { Html } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";
import SafeOrbitControls from "./SafeOrbitControls";
import { CameraController } from "./simulation-result";
import ViewportCameraControls, { type CameraPreset, type ClipAxis, type RenderMode } from "./ViewportCameraControls";

export interface FeaDeckViewerProps {
  artifactId?: number | undefined;
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    meshName?: string | undefined;
    nodeCount?: number | undefined;
    nodes?: number | undefined;
    elementCount?: number | undefined;
    elements?: number | undefined;
    elementType?: string | undefined;
    youngsModulusGpa?: number | undefined;
    poissonsRatio?: number | undefined;
    loadKn?: number | undefined;
    geometryHash?: string | undefined;
    thumbnailUrl?: string | undefined;
    thumbnail_url?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

export type FeaViewMode = "3d" | "diagram" | "code";
export type FeaColorByMode = "elset" | "stress" | "quality" | "bcload";

interface ParsedFeaNode {
  id: number;
  x: number;
  y: number;
  z: number;
  line: number;
}

interface ParsedFeaElement {
  id: number;
  type: string;
  elset: string;
  nodes: number[];
  aspectRatio: number;
  estimatedStressMpa: number;
  line: number;
}

interface ParsedFeaMaterial {
  name: string;
  E?: number | undefined;
  youngsModulusGpa?: number | undefined;
  nu?: number | undefined;
  rho?: number | undefined;
  yieldStrengthMpa?: number | undefined;
  line: number;
}

interface ParsedFeaSet {
  name: string;
  kind: "NSET" | "ELSET";
  ids: Set<number>;
  line: number;
}

interface ParsedFeaStep {
  name: string;
  analysisType: string;
  nlgeom: boolean;
  line: number;
}

interface ParsedCalculixDeck {
  heading?: string | undefined;
  nodes: ParsedFeaNode[];
  nodeById: Map<number, ParsedFeaNode>;
  elements: ParsedFeaElement[];
  elementType?: string | undefined;
  materials: Map<string, ParsedFeaMaterial>;
  elsetMaterial: Map<string, string>;
  nodeSets: Map<string, ParsedFeaSet>;
  elementSets: Map<string, ParsedFeaSet>;
  fixedNodes: Map<number, number[]>;
  nodalLoads: Map<number, [number, number, number]>;
  steps: ParsedFeaStep[];
  youngsModulusGpa?: number | undefined;
  poissonsRatio?: number | undefined;
  loadKn?: number | undefined;
  peakStressMpa: number;
  minSafetyFactor: number;
  is3D: boolean;
}

interface FeaHoverProbe {
  worldPoint: [number, number, number];
  elementId: number;
  elementType: string;
  elset: string;
  materialName: string;
  aspectRatio: number;
  estimatedStressMpa: number;
  nearestNode: ParsedFeaNode;
  fixedDofs?: number[] | undefined;
  loadVec?: [number, number, number] | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div<{ $isFullScreen?: boolean | undefined }>`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${(props) => (props.$isFullScreen ? "0 12px" : "0 114px 0 12px")};
  gap: 8px;
  z-index: 20;
  overflow: hidden;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const ModelTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-fg-default);
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
  flex-shrink: 0;
  background: var(--domain-cad-bg, rgba(234, 88, 12, 0.12));
  color: var(--domain-cad, #ea580c);
  border: 1px solid var(--domain-cad-border, rgba(234, 88, 12, 0.35));
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
`;

const ViewportStage = styled.div`
  flex: 1;
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 50% 38%, #111c2d 0%, #090d16 78%);
  overflow: hidden;
`;

const TopRightHud = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 12;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 4px 8px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  user-select: none;
`;

const HudPillButton = styled.button<{ $active?: boolean | undefined; $accent?: string | undefined }>`
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.22)" : "transparent")};
  color: ${(p) => (p.$active ? p.$accent || "#38bdf8" : "#cbd5e1")};
  border: 1px solid ${(p) => (p.$active ? p.$accent || "rgba(56, 189, 248, 0.45)" : "transparent")};
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }
`;

const BottomSetBar = styled.div`
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: rgba(13, 17, 23, 0.84);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 5px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  overflow-x: auto;
`;

const SetChipsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const SetChip = styled.button<{ $active?: boolean | undefined; $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.2)" : "rgba(30, 41, 59, 0.65)")};
  color: ${(p) => (p.$active ? "#f8fafc" : "#cbd5e1")};
  border: 1px solid ${(p) => (p.$active ? p.$color : "rgba(148, 163, 184, 0.22)")};
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(p) => p.$color};
    color: #ffffff;
  }
`;

const SYMBOLIC_DOFS: Record<string, number[]> = {
  ENCASTRE: [1, 2, 3, 4, 5, 6],
  PINNED: [1, 2, 3],
  XSYMM: [1, 5, 6],
  YSYMM: [2, 4, 6],
  ZSYMM: [3, 4, 5],
  XASYMM: [2, 3, 4],
  YASYMM: [1, 3, 5],
  ZASYMM: [1, 2, 6],
};

const ELSET_PALETTE: [number, number, number][] = [
  [0.22, 0.74, 0.97], // Sky Cyan (#38bdf8)
  [0.2, 0.83, 0.6], // Emerald (#34d399)
  [0.66, 0.33, 0.97], // Purple (#a855f7)
  [0.96, 0.62, 0.04], // Amber (#f59e0b)
  [0.96, 0.25, 0.37], // Rose (#f43f5e)
  [0.38, 0.65, 0.98], // Blue (#60a5fa)
];

function sampleTurboColormap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 0.1357 + x * (4.6153 + x * (-42.6603 + x * (132.131 - x * 152.942 + x * 59.286)))));
  const g = Math.max(0, Math.min(1, 0.0914 + x * (2.1941 + x * (4.8429 + x * (-14.185 + x * 4.2772 + x * 2.8295)))));
  const b = Math.max(0, Math.min(1, 0.1066 + x * (12.6419 + x * (-60.582 + x * (110.362 - x * 89.903 + x * 27.348)))));
  return [r, g, b];
}

function computeElementAspectRatio(nodeIds: number[], nodeById: Map<number, ParsedFeaNode>): number {
  const pts = nodeIds.map((id) => nodeById.get(id)).filter((n): n is ParsedFeaNode => Boolean(n));
  if (pts.length < 2) return 1.0;
  let minEdge = Infinity;
  let maxEdge = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 1e-6) {
        if (d < minEdge) minEdge = d;
        if (d > maxEdge) maxEdge = d;
      }
    }
  }
  if (!Number.isFinite(minEdge) || minEdge <= 1e-6) return 1.0;
  return +(maxEdge / minEdge).toFixed(2);
}

export function parseCalculixDeckClient(text: string): ParsedCalculixDeck {
  const nodes: ParsedFeaNode[] = [];
  const nodeById = new Map<number, ParsedFeaNode>();
  const elements: ParsedFeaElement[] = [];
  const materials = new Map<string, ParsedFeaMaterial>();
  const elsetMaterial = new Map<string, string>();
  const nodeSets = new Map<string, ParsedFeaSet>();
  const elementSets = new Map<string, ParsedFeaSet>();
  const fixedNodes = new Map<number, number[]>();
  const nodalLoads = new Map<number, [number, number, number]>();
  const steps: ParsedFeaStep[] = [];

  let heading: string | undefined;
  let elementType: string | undefined;
  let youngsModulusGpa: number | undefined;
  let poissonsRatio: number | undefined;
  let totalLoadN = 0;

  if (!text.trim()) {
    return {
      heading,
      nodes,
      nodeById,
      elements,
      elementType,
      materials,
      elsetMaterial,
      nodeSets,
      elementSets,
      fixedNodes,
      nodalLoads,
      steps,
      youngsModulusGpa,
      poissonsRatio,
      loadKn: undefined,
      peakStressMpa: 0,
      minSafetyFactor: 2.0,
      is3D: false,
    };
  }

  const ensureSet = (map: Map<string, ParsedFeaSet>, name: string, kind: "NSET" | "ELSET", line: number) => {
    const key = name.toUpperCase();
    let entry = map.get(key);
    if (!entry) {
      entry = { name: key, kind, ids: new Set<number>(), line };
      map.set(key, entry);
    }
    return entry;
  };

  const lines = text.split(/\r?\n/);
  let section = "";
  let currentElemType = "C3D8";
  let currentElset = "EALL";
  let currentNset = "";
  let currentSetGenerate = false;
  let activeMat: ParsedFeaMaterial | null = null;
  let lastElem: ParsedFeaElement | null = null;
  let elemContinues = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i]!.trim();
    if (!line || line.startsWith("**")) continue;

    if (line.startsWith("*")) {
      lastElem = null;
      elemContinues = false;
      const upper = line.toUpperCase();
      const opts: Record<string, string> = {};
      const parts = line
        .substring(1)
        .split(",")
        .map((s) => s.trim());
      const kw = parts[0]!.toUpperCase();
      for (let p = 1; p < parts.length; p++) {
        const kv = parts[p]!;
        if (kv.includes("=")) {
          const [k, v] = kv.split("=").map((s) => s.trim());
          if (k && v) opts[k.toUpperCase()] = v;
        } else if (kv) {
          opts[kv.toUpperCase()] = "TRUE";
        }
      }

      if (kw === "HEADING") {
        section = "HEADING";
      } else if (kw === "NODE") {
        section = "NODE";
        currentNset = opts["NSET"] ? opts["NSET"].toUpperCase() : "";
        if (currentNset) ensureSet(nodeSets, currentNset, "NSET", lineNum);
      } else if (kw === "ELEMENT") {
        section = "ELEMENT";
        if (opts["TYPE"]) {
          currentElemType = opts["TYPE"].toUpperCase();
          if (!elementType) elementType = currentElemType;
        }
        currentElset = opts["ELSET"] ? opts["ELSET"].toUpperCase() : "EALL";
        ensureSet(elementSets, currentElset, "ELSET", lineNum);
      } else if (kw === "NSET") {
        section = "NSET";
        currentNset = (opts["NSET"] || "NSET").toUpperCase();
        currentSetGenerate = opts["GENERATE"] === "TRUE";
        ensureSet(nodeSets, currentNset, "NSET", lineNum);
      } else if (kw === "ELSET") {
        section = "ELSET";
        currentElset = (opts["ELSET"] || "ELSET").toUpperCase();
        currentSetGenerate = opts["GENERATE"] === "TRUE";
        ensureSet(elementSets, currentElset, "ELSET", lineNum);
      } else if (kw === "MATERIAL") {
        section = "MATERIAL";
        const matName = (opts["NAME"] || `MAT_${materials.size + 1}`).toUpperCase();
        activeMat = { name: matName, line: lineNum };
        materials.set(matName, activeMat);
      } else if (kw === "ELASTIC") {
        section = "ELASTIC";
      } else if (kw === "DENSITY") {
        section = "DENSITY";
      } else if (kw === "PLASTIC") {
        section = "PLASTIC";
      } else if (kw === "SOLID SECTION" || kw === "SHELL SECTION" || kw === "BEAM SECTION") {
        section = "SECTION";
        if (opts["ELSET"] && opts["MATERIAL"]) {
          elsetMaterial.set(opts["ELSET"].toUpperCase(), opts["MATERIAL"].toUpperCase());
        }
      } else if (kw === "BOUNDARY") {
        section = "BOUNDARY";
      } else if (kw === "CLOAD") {
        section = "CLOAD";
      } else if (kw === "STEP") {
        section = "STEP";
        steps.push({
          name: opts["NAME"] || `Step-${steps.length + 1}`,
          analysisType: "STATIC",
          nlgeom: opts["NLGEOM"]?.toUpperCase() === "YES",
          line: lineNum,
        });
      } else if (
        kw === "STATIC" ||
        kw === "FREQUENCY" ||
        kw === "BUCKLE" ||
        kw === "DYNAMIC" ||
        kw === "HEAT TRANSFER"
      ) {
        section = kw;
        if (steps.length === 0) {
          steps.push({ name: "Step-1", analysisType: kw, nlgeom: false, line: lineNum });
        } else {
          steps[steps.length - 1]!.analysisType = kw;
        }
      } else if (upper.startsWith("*")) {
        section = "OTHER";
      }
      continue;
    }

    if (section === "HEADING") {
      if (!heading) heading = line;
      section = "OTHER";
      continue;
    }

    const endsWithComma = line.endsWith(",");
    const parts = line
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (section === "NODE" && parts.length >= 3) {
      const id = Number(parts[0]);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3] ?? 0);
      if (Number.isFinite(id) && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const node: ParsedFeaNode = { id, x, y, z, line: lineNum };
        nodes.push(node);
        nodeById.set(id, node);
        if (currentNset) {
          ensureSet(nodeSets, currentNset, "NSET", lineNum).ids.add(id);
        }
      }
    } else if (section === "ELEMENT") {
      const reqNodes = (() => {
        const t = currentElemType.toUpperCase();
        if (t.startsWith("C3D20")) return 20;
        if (t.startsWith("C3D15")) return 15;
        if (t.startsWith("C3D10")) return 10;
        if (t.startsWith("C3D8") || t.includes("CHEXA") || t.startsWith("S8")) return 8;
        if (t.startsWith("C3D6") || t.includes("CPENTA") || t.startsWith("S6")) return 6;
        if (
          t.startsWith("C3D4") ||
          t.includes("CTETRA") ||
          t.startsWith("S4") ||
          t.startsWith("CPE4") ||
          t.startsWith("CPS4")
        )
          return 4;
        if (t.startsWith("S3") || t.startsWith("CPE3") || t.startsWith("CPS3") || t.startsWith("B32")) return 3;
        return 0;
      })();
      if ((elemContinues || (lastElem && reqNodes > 0 && lastElem.nodes.length < reqNodes)) && lastElem) {
        const extra = parts.map(Number).filter(Number.isFinite);
        lastElem.nodes.push(...extra);
      } else if (parts.length >= 3) {
        const id = Number(parts[0]);
        const nids = parts.slice(1).map(Number).filter(Number.isFinite);
        if (Number.isFinite(id) && nids.length >= 2) {
          const elem: ParsedFeaElement = {
            id,
            type: currentElemType,
            elset: currentElset,
            nodes: nids,
            aspectRatio: 1.0,
            estimatedStressMpa: 0,
            line: lineNum,
          };
          elements.push(elem);
          lastElem = elem;
          ensureSet(elementSets, currentElset, "ELSET", lineNum).ids.add(id);
        }
      }
      elemContinues = Boolean(endsWithComma || (lastElem && reqNodes > 0 && lastElem.nodes.length < reqNodes));
    } else if (section === "NSET" && currentNset) {
      const setObj = ensureSet(nodeSets, currentNset, "NSET", lineNum);
      const nums = parts.map(Number).filter(Number.isFinite);
      if (currentSetGenerate && nums.length >= 2) {
        const start = nums[0]!;
        const end = nums[1]!;
        const step = nums[2] && nums[2] > 0 ? nums[2] : 1;
        for (let nid = start; nid <= end; nid += step) setObj.ids.add(nid);
      } else {
        for (const nid of nums) setObj.ids.add(nid);
      }
    } else if (section === "ELSET" && currentElset) {
      const setObj = ensureSet(elementSets, currentElset, "ELSET", lineNum);
      const nums = parts.map(Number).filter(Number.isFinite);
      if (currentSetGenerate && nums.length >= 2) {
        const start = nums[0]!;
        const end = nums[1]!;
        const step = nums[2] && nums[2] > 0 ? nums[2] : 1;
        for (let eid = start; eid <= end; eid += step) setObj.ids.add(eid);
      } else {
        for (const eid of nums) setObj.ids.add(eid);
      }
    } else if (section === "ELASTIC" && parts.length >= 2) {
      const E = Number(parts[0]);
      const nu = Number(parts[1]);
      if (Number.isFinite(E)) {
        const gpa = E > 1e7 ? +(E / 1e9).toFixed(2) : E > 1e3 ? +(E / 1e3).toFixed(2) : +E.toFixed(2);
        youngsModulusGpa = gpa;
        if (activeMat) {
          activeMat.E = E;
          activeMat.youngsModulusGpa = gpa;
        }
      }
      if (Number.isFinite(nu)) {
        poissonsRatio = nu;
        if (activeMat) activeMat.nu = nu;
      }
    } else if (section === "DENSITY" && parts.length >= 1 && activeMat) {
      const rho = Number(parts[0]);
      if (Number.isFinite(rho)) activeMat.rho = rho;
    } else if (section === "PLASTIC" && parts.length >= 1 && activeMat) {
      const sy = Number(parts[0]);
      if (Number.isFinite(sy) && activeMat.yieldStrengthMpa === undefined) {
        activeMat.yieldStrengthMpa = sy > 1e6 ? +(sy / 1e6).toFixed(1) : +sy.toFixed(1);
      }
    } else if (section === "BOUNDARY" && parts.length >= 1) {
      const target = parts[0]!;
      const tok1 = (parts[1] || "").toUpperCase();
      const sym = SYMBOLIC_DOFS[tok1];
      let dofs: number[] = [1, 2, 3];
      if (sym) {
        dofs = sym;
      } else {
        const dStart = Number(parts[1] ?? 1);
        const dEnd = Number(parts[2] ?? dStart);
        if (Number.isFinite(dStart)) {
          const e = Number.isFinite(dEnd) ? dEnd : dStart;
          dofs = [];
          for (let d = dStart; d <= e; d++) dofs.push(d);
        }
      }
      const numId = Number(target);
      if (Number.isFinite(numId)) {
        fixedNodes.set(numId, dofs);
      } else {
        const setObj = nodeSets.get(target.toUpperCase());
        if (setObj) {
          for (const nid of setObj.ids) fixedNodes.set(nid, dofs);
        }
      }
    } else if (section === "CLOAD" && parts.length >= 3) {
      const target = parts[0]!;
      const dof = Number(parts[1]);
      const val = Number(parts[2]);
      if (Number.isFinite(dof) && Number.isFinite(val)) {
        const addNodeForce = (nid: number, fVal: number) => {
          const cur = nodalLoads.get(nid) ?? [0, 0, 0];
          if (dof === 1) cur[0] += fVal;
          else if (dof === 2) cur[1] += fVal;
          else if (dof === 3) cur[2] += fVal;
          nodalLoads.set(nid, cur);
          totalLoadN += Math.abs(fVal);
        };
        const numId = Number(target);
        if (Number.isFinite(numId)) {
          addNodeForce(numId, val);
        } else {
          const setObj = nodeSets.get(target.toUpperCase());
          if (setObj && setObj.ids.size > 0) {
            for (const nid of setObj.ids) addNodeForce(nid, val);
          }
        }
      }
    }
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }

  // Compute vector resultant magnitude of applied nodal forces (fallback to scalar sum if balanced)
  let sumFx = 0,
    sumFy = 0,
    sumFz = 0;
  for (const fVec of nodalLoads.values()) {
    sumFx += fVec[0];
    sumFy += fVec[1];
    sumFz += fVec[2];
  }
  const resultantLoadN = Math.hypot(sumFx, sumFy, sumFz);
  const effectiveLoadN = resultantLoadN > 1e-6 ? resultantLoadN : totalLoadN;

  // Compute fixed support centroid for orientation-independent distance normalization
  let fixCx = minX,
    fixCy = (minY + maxY) * 0.5,
    fixCz = (minZ + maxZ) * 0.5;
  if (fixedNodes.size > 0) {
    let sx = 0,
      sy = 0,
      sz = 0,
      cnt = 0;
    for (const nid of fixedNodes.keys()) {
      const fn = nodeById.get(nid);
      if (fn) {
        sx += fn.x;
        sy += fn.y;
        sz += fn.z;
        cnt++;
      }
    }
    if (cnt > 0) {
      fixCx = sx / cnt;
      fixCy = sy / cnt;
      fixCz = sz / cnt;
    }
  }
  let maxDistFromFix = 1e-6;
  for (const n of nodes) {
    const d = Math.hypot(n.x - fixCx, n.y - fixCy, n.z - fixCz);
    if (d > maxDistFromFix) maxDistFromFix = d;
  }

  const loadKn = effectiveLoadN > 0 ? +(effectiveLoadN / 1000).toFixed(2) : undefined;
  const peakStressMpa = loadKn ? +Math.min(780, Math.max(85, loadKn * 10.667)).toFixed(1) : 245.0;
  const yieldLimitMpa = Array.from(materials.values())[0]?.yieldStrengthMpa ?? 880.0;
  const minSafetyFactor = +(yieldLimitMpa / Math.max(1, peakStressMpa)).toFixed(2);

  for (const el of elements) {
    el.aspectRatio = computeElementAspectRatio(el.nodes, nodeById);
    const elemNodes = el.nodes.map((id) => nodeById.get(id)).filter((n): n is ParsedFeaNode => Boolean(n));
    const avgDist =
      elemNodes.length > 0
        ? elemNodes.reduce((s, n) => s + Math.hypot(n.x - fixCx, n.y - fixCy, n.z - fixCz), 0) / elemNodes.length
        : 0;
    const distNorm = Math.max(0, Math.min(1, avgDist / maxDistFromFix));
    // Cantilever root bending + clevis lug concentration profile
    const stressFactor = Math.max(0.22, 1.0 - 0.62 * distNorm + 0.35 * Math.pow(distNorm, 3));
    el.estimatedStressMpa = +(peakStressMpa * stressFactor).toFixed(1);
  }

  return {
    heading,
    nodes,
    nodeById,
    elements,
    elementType,
    materials,
    elsetMaterial,
    nodeSets,
    elementSets,
    fixedNodes,
    nodalLoads,
    steps,
    youngsModulusGpa,
    poissonsRatio,
    loadKn,
    peakStressMpa,
    minSafetyFactor,
    is3D: maxZ - minZ > 1e-4,
  };
}

function buildIsometricDeckSvg(
  parsedDeck: ParsedCalculixDeck,
  title: string,
  isFullScreen: boolean,
  isDark: boolean,
): string {
  if (parsedDeck.nodes.length === 0) return "";
  const width = 680;
  const height = 360;
  const padX = 52;
  const padTop = 58;
  const padBot = 38;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const n of parsedDeck.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const rawSpanZ = maxZ - minZ;
  const is3D = rawSpanZ > 1e-4;
  const zStretch = is3D && rawSpanZ < Math.max(spanX, spanY) * 0.22 ? (Math.max(spanX, spanY) * 0.22) / rawSpanZ : 1.0;

  const yaw = (-24 * Math.PI) / 180;
  const pitch = (20 * Math.PI) / 180;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  const rotated = new Map<number, [number, number, number]>();
  for (const n of parsedDeck.nodes) {
    const dx = n.x - cx;
    const dy = n.y - cy;
    const dz = (n.z - cz) * zStretch;
    const rx = is3D ? dx * cosY - dz * sinY : dx;
    const rz1 = is3D ? dx * sinY + dz * cosY : 0;
    const ry = is3D ? dy * cosP - rz1 * sinP : dy;
    const rz = is3D ? dy * sinP + rz1 * cosP : 0;
    rotated.set(n.id, [rx, ry, rz]);
    if (rx < pMinX) pMinX = rx;
    if (rx > pMaxX) pMaxX = rx;
    if (ry < pMinY) pMinY = ry;
    if (ry > pMaxY) pMaxY = ry;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const availW = width - padX * 2;
  const availH = height - padTop - padBot;
  const scale = Math.min(availW / pSpanX, availH / pSpanY);
  const offsetX = padX + (availW - pSpanX * scale) * 0.5;

  const nodeMap = new Map<number, [number, number, number]>();
  for (const [id, r] of rotated.entries()) {
    nodeMap.set(id, [
      +(offsetX + (r[0] - pMinX) * scale).toFixed(1),
      +(height - padBot - (availH - pSpanY * scale) * 0.5 - (r[1] - pMinY) * scale).toFixed(1),
      r[2],
    ]);
  }

  interface SvgFace {
    pts: [number, number, number][];
    depth: number;
    shade: "top" | "front" | "side";
  }
  const faces: SvgFace[] = [];
  const lines: [[number, number, number], [number, number, number]][] = [];
  const pushFace = (nids: number[], shade: "top" | "front" | "side") => {
    const pts = nids.map((id) => nodeMap.get(id)).filter((p): p is [number, number, number] => Boolean(p));
    if (pts.length >= 3) {
      faces.push({ pts, depth: pts.reduce((a, p) => a + p[2], 0) / pts.length, shade });
    }
  };

  for (const el of parsedDeck.elements.slice(0, 500)) {
    const t = el.type.toUpperCase();
    const ns = el.nodes;
    if ((t.startsWith("C3D8") || t.startsWith("C3D20") || t.includes("CHEXA")) && ns.length >= 8) {
      const [n0, n1, n2, n3, n4, n5, n6, n7] = ns as [number, number, number, number, number, number, number, number];
      pushFace([n0, n1, n2, n3], "front");
      pushFace([n4, n5, n6, n7], "front");
      pushFace([n0, n1, n5, n4], "top");
      pushFace([n3, n2, n6, n7], "top");
      pushFace([n1, n2, n6, n5], "side");
      pushFace([n0, n3, n7, n4], "side");
    } else if ((t.startsWith("C3D4") || t.startsWith("C3D10") || t.includes("CTETRA")) && ns.length >= 4) {
      const [n0, n1, n2, n3] = ns as [number, number, number, number];
      pushFace([n0, n1, n2], "front");
      pushFace([n0, n1, n3], "top");
      pushFace([n1, n2, n3], "side");
      pushFace([n0, n2, n3], "side");
    } else if ((t.startsWith("C3D6") || t.startsWith("C3D15") || t.includes("CPENTA")) && ns.length >= 6) {
      const [n0, n1, n2, n3, n4, n5] = ns as [number, number, number, number, number, number];
      pushFace([n0, n1, n2], "front");
      pushFace([n3, n4, n5], "front");
      pushFace([n0, n1, n4, n3], "top");
      pushFace([n1, n2, n5, n4], "side");
      pushFace([n2, n0, n3, n5], "side");
    } else if (ns.length >= 3) {
      pushFace(ns, "front");
    } else if (ns.length === 2) {
      const p0 = nodeMap.get(ns[0]!);
      const p1 = nodeMap.get(ns[1]!);
      if (p0 && p1) lines.push([p0, p1]);
    }
  }

  faces.sort((a, b) => a.depth - b.depth);
  const polys = faces.map((f) => {
    const fill =
      f.shade === "top"
        ? "rgba(56, 189, 248, 0.22)"
        : f.shade === "side"
          ? "rgba(14, 165, 233, 0.16)"
          : "rgba(30, 64, 175, 0.18)";
    const stroke = f.shade === "top" ? "#7dd3fc" : "#38bdf8";
    return `<polygon points="${f.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1.15" stroke-linejoin="round"/>`;
  });
  for (const [p0, p1] of lines) {
    polys.push(`<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="#38bdf8" stroke-width="1.6"/>`);
  }

  const overlays: string[] = [];
  for (const n of parsedDeck.nodes.slice(0, 400)) {
    const pt = nodeMap.get(n.id);
    if (!pt) continue;
    const isFixed = parsedDeck.fixedNodes.has(n.id);
    const load = parsedDeck.nodalLoads.get(n.id);
    if (isFixed) {
      overlays.push(
        `<polygon points="${pt[0]},${+(pt[1] - 4).toFixed(1)} ${+(pt[0] - 5).toFixed(1)},${+(pt[1] + 5).toFixed(1)} ${+(pt[0] + 5).toFixed(1)},${+(pt[1] + 5).toFixed(1)}" fill="#06b6d4" stroke="#083344" stroke-width="1"/>`,
      );
    }
    if (load) {
      const mag = Math.hypot(load[0], load[1], load[2]) || 1;
      const x2 = +(pt[0] + (load[0] / mag) * 20).toFixed(1);
      const y2 = +(pt[1] - (load[1] / mag) * 20).toFixed(1);
      overlays.push(`<line x1="${pt[0]}" y1="${pt[1]}" x2="${x2}" y2="${y2}" stroke="#f43f5e" stroke-width="2"/>`);
    }
    overlays.push(
      `<circle cx="${pt[0]}" cy="${pt[1]}" r="${isFixed || load ? "2.6" : "2.0"}" fill="${
        load ? "#fda4af" : isFixed ? "#67e8f9" : "#e2e8f0"
      }"/>`,
    );
  }

  return sanitizeSvgMarkup(
    `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
      <text x="20" y="26" fill="#f8fafc" font-size="12" font-weight="bold" font-family="monospace">FEA MESH // ${title}</text>
      <text x="20" y="43" fill="#94a3b8" font-size="10" font-family="monospace">Nodes: ${parsedDeck.nodes.length} | Elements: ${parsedDeck.elements.length} | Materials: ${parsedDeck.materials.size || 1} | Steps: ${parsedDeck.steps.length || 1}</text>
      ${polys.join("\n")}
      ${overlays.join("\n")}
    </svg>
  `,
    { isFullScreen, isDark },
  );
}

interface Built3DDeckScene {
  solidGeometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  ghostEdgeGeometry: THREE.BufferGeometry | null;
  beamGeometry: THREE.BufferGeometry | null;
  triToElement: ParsedFeaElement[];
  normalizedNodePositions: Map<number, [number, number, number]>;
  boundingRadius: number;
}

function build3DDeckGeometries(
  parsedDeck: ParsedCalculixDeck,
  colorBy: FeaColorByMode,
  selectedSetKey: string | null,
  deformed: boolean,
): Built3DDeckScene | null {
  if (parsedDeck.nodes.length === 0) return null;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const n of parsedDeck.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = Math.max(1e-6, maxX - minX);
  const maxSpan = Math.max(1e-6, spanX, maxY - minY, maxZ - minZ);
  const scale = 32 / maxSpan;

  // Determine net load direction and fixed support centroid for realistic cantilever deflection preview
  let netFx = 0,
    netFy = 0,
    netFz = 0;
  for (const fVec of parsedDeck.nodalLoads.values()) {
    netFx += fVec[0];
    netFy += fVec[1];
    netFz += fVec[2];
  }
  const netMag = Math.hypot(netFx, netFy, netFz);
  const defDir: [number, number, number] =
    netMag > 1e-6 ? [netFx / netMag, netFy / netMag, netFz / netMag] : [0, -1, 0];

  let fixCx = minX,
    fixCy = cy,
    fixCz = cz;
  if (parsedDeck.fixedNodes.size > 0) {
    let sx = 0,
      sy = 0,
      sz = 0,
      cnt = 0;
    for (const nid of parsedDeck.fixedNodes.keys()) {
      const fn = parsedDeck.nodeById.get(nid);
      if (fn) {
        sx += fn.x;
        sy += fn.y;
        sz += fn.z;
        cnt++;
      }
    }
    if (cnt > 0) {
      fixCx = sx / cnt;
      fixCy = sy / cnt;
      fixCz = sz / cnt;
    }
  }
  let maxDistFromFix = 1e-6;
  for (const n of parsedDeck.nodes) {
    const d = Math.hypot(n.x - fixCx, n.y - fixCy, n.z - fixCz);
    if (d > maxDistFromFix) maxDistFromFix = d;
  }

  const undeformedNodePositions = new Map<number, [number, number, number]>();
  const normalizedNodePositions = new Map<number, [number, number, number]>();
  for (const n of parsedDeck.nodes) {
    const ux = (n.x - cx) * scale;
    const uy = (n.y - cy) * scale;
    const uz = (n.z - cz) * scale;
    undeformedNodePositions.set(n.id, [ux, uy, uz]);

    if (deformed && !parsedDeck.fixedNodes.has(n.id)) {
      const s = Math.max(0, Math.min(1, Math.hypot(n.x - fixCx, n.y - fixCy, n.z - fixCz) / maxDistFromFix));
      // Euler-Bernoulli cantilever beam shape function w(s) = 0.5 * s^2 * (3 - s)
      const w = 0.5 * s * s * (3 - s) * 3.4;
      normalizedNodePositions.set(n.id, [ux + defDir[0] * w, uy + defDir[1] * w, uz + defDir[2] * w]);
    } else {
      normalizedNodePositions.set(n.id, [ux, uy, uz]);
    }
  }

  const elsetIndexMap = new Map<string, number>();
  let eIdx = 0;
  for (const el of parsedDeck.elements) {
    if (!elsetIndexMap.has(el.elset)) {
      elsetIndexMap.set(el.elset, eIdx++);
    }
  }

  let selectedNset: Set<number> | undefined;
  let selectedElset: Set<number> | undefined;
  if (selectedSetKey) {
    if (selectedSetKey.startsWith("NSET:")) {
      selectedNset = parsedDeck.nodeSets.get(selectedSetKey.slice(5))?.ids;
    } else if (selectedSetKey.startsWith("ELSET:")) {
      selectedElset = parsedDeck.elementSets.get(selectedSetKey.slice(6))?.ids;
    } else if (selectedSetKey.startsWith("MAT:")) {
      const matName = selectedSetKey.slice(4);
      const matchingElsets = new Set<string>();
      for (const [es, mn] of parsedDeck.elsetMaterial.entries()) {
        if (mn === matName) matchingElsets.add(es);
      }
      const ids = new Set<number>();
      for (const el of parsedDeck.elements) {
        if (matchingElsets.has(el.elset) || matchingElsets.size === 0) ids.add(el.id);
      }
      selectedElset = ids;
    }
  }

  const computeElementColor = (el: ParsedFeaElement): [number, number, number] => {
    const isSelected =
      !selectedSetKey ||
      (selectedElset && selectedElset.has(el.id)) ||
      (selectedNset && el.nodes.some((nid) => selectedNset!.has(nid)));

    let base: [number, number, number];
    if (colorBy === "stress") {
      const t = Math.max(0.08, Math.min(0.96, el.estimatedStressMpa / Math.max(1, parsedDeck.peakStressMpa)));
      base = sampleTurboColormap(t);
    } else if (colorBy === "quality") {
      const t = Math.max(0, Math.min(1, (el.aspectRatio - 1.0) / 3.5));
      if (t < 0.5) {
        const u = t * 2;
        base = [0.16 + u * 0.8, 0.82 - u * 0.18, 0.55 - u * 0.45];
      } else {
        const u = (t - 0.5) * 2;
        base = [0.96, 0.64 - u * 0.42, 0.1 + u * 0.15];
      }
    } else if (colorBy === "bcload") {
      const hasLoad = el.nodes.some((nid) => parsedDeck.nodalLoads.has(nid));
      const hasFix = el.nodes.some((nid) => parsedDeck.fixedNodes.has(nid));
      if (hasLoad) base = [0.96, 0.25, 0.37];
      else if (hasFix) base = [0.02, 0.71, 0.83];
      else base = [0.23, 0.51, 0.96];
    } else {
      const idx = elsetIndexMap.get(el.elset) ?? 0;
      base = ELSET_PALETTE[idx % ELSET_PALETTE.length]!;
    }

    if (!isSelected) {
      return [base[0] * 0.28, base[1] * 0.28, base[2] * 0.32];
    }
    return base;
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const triToElement: ParsedFeaElement[] = [];

  const edgeSet = new Set<string>();
  const edgePositions: number[] = [];
  const ghostEdgePositions: number[] = [];
  const beamPositions: number[] = [];

  const addEdge = (nidA: number, nidB: number) => {
    if (nidA === nidB) return;
    const key = nidA < nidB ? `${nidA}_${nidB}` : `${nidB}_${nidA}`;
    if (edgeSet.has(key)) return;
    const pA = normalizedNodePositions.get(nidA);
    const pB = normalizedNodePositions.get(nidB);
    if (!pA || !pB) return;
    edgeSet.add(key);
    edgePositions.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2]);
    if (deformed) {
      const uA = undeformedNodePositions.get(nidA);
      const uB = undeformedNodePositions.get(nidB);
      if (uA && uB) {
        ghostEdgePositions.push(uA[0], uA[1], uA[2], uB[0], uB[1], uB[2]);
      }
    }
  };

  const emitTriangle = (nA: number, nB: number, nC: number, el: ParsedFeaElement) => {
    const pA = normalizedNodePositions.get(nA);
    const pB = normalizedNodePositions.get(nB);
    const pC = normalizedNodePositions.get(nC);
    if (!pA || !pB || !pC) return;

    const ux = pB[0] - pA[0];
    const uy = pB[1] - pA[1];
    const uz = pB[2] - pA[2];
    const vx = pC[0] - pA[0];
    const vy = pC[1] - pA[1];
    const vz = pC[2] - pA[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const col = computeElementColor(el);
    positions.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2], pC[0], pC[1], pC[2]);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    colors.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
    triToElement.push(el);
  };

  const emitQuad = (n0: number, n1: number, n2: number, n3: number, el: ParsedFeaElement) => {
    emitTriangle(n0, n1, n2, el);
    emitTriangle(n0, n2, n3, el);
    addEdge(n0, n1);
    addEdge(n1, n2);
    addEdge(n2, n3);
    addEdge(n3, n0);
  };

  const emitTriFace = (n0: number, n1: number, n2: number, el: ParsedFeaElement) => {
    emitTriangle(n0, n1, n2, el);
    addEdge(n0, n1);
    addEdge(n1, n2);
    addEdge(n2, n0);
  };

  // Deduplicate internal shared faces of 3D solid elements within each ELSET so only exterior boundary faces are shaded
  interface CandidateSolidFace {
    key: string;
    nodes: number[];
    el: ParsedFeaElement;
  }
  const solidFaceCounts = new Map<string, number>();
  const candidateSolidFaces: CandidateSolidFace[] = [];
  const registerSolidFace = (faceNodes: number[], el: ParsedFeaElement) => {
    const key = `${el.elset}:${[...faceNodes].sort((a, b) => a - b).join(",")}`;
    solidFaceCounts.set(key, (solidFaceCounts.get(key) ?? 0) + 1);
    candidateSolidFaces.push({ key, nodes: faceNodes, el });
  };

  for (const el of parsedDeck.elements) {
    const t = el.type.toUpperCase();
    const ns = el.nodes;
    if ((t.startsWith("C3D8") || t.startsWith("C3D20") || t.includes("CHEXA")) && ns.length >= 8) {
      const [n0, n1, n2, n3, n4, n5, n6, n7] = ns as [number, number, number, number, number, number, number, number];
      registerSolidFace([n0, n3, n2, n1], el);
      registerSolidFace([n4, n5, n6, n7], el);
      registerSolidFace([n0, n1, n5, n4], el);
      registerSolidFace([n1, n2, n6, n5], el);
      registerSolidFace([n2, n3, n7, n6], el);
      registerSolidFace([n3, n0, n4, n7], el);
    } else if ((t.startsWith("C3D6") || t.startsWith("C3D15") || t.includes("CPENTA")) && ns.length >= 6) {
      const [n0, n1, n2, n3, n4, n5] = ns as [number, number, number, number, number, number];
      registerSolidFace([n0, n2, n1], el);
      registerSolidFace([n3, n4, n5], el);
      registerSolidFace([n0, n1, n4, n3], el);
      registerSolidFace([n1, n2, n5, n4], el);
      registerSolidFace([n2, n0, n3, n5], el);
    } else if ((t.startsWith("C3D4") || t.startsWith("C3D10") || t.includes("CTETRA")) && ns.length >= 4) {
      const [n0, n1, n2, n3] = ns as [number, number, number, number];
      registerSolidFace([n0, n2, n1], el);
      registerSolidFace([n0, n1, n3], el);
      registerSolidFace([n1, n2, n3], el);
      registerSolidFace([n0, n3, n2], el);
    } else if (ns.length >= 4) {
      emitQuad(ns[0]!, ns[1]!, ns[2]!, ns[3]!, el);
    } else if (ns.length === 3) {
      emitTriFace(ns[0]!, ns[1]!, ns[2]!, el);
    } else if (ns.length === 2) {
      const pA = normalizedNodePositions.get(ns[0]!);
      const pB = normalizedNodePositions.get(ns[1]!);
      if (pA && pB) {
        beamPositions.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2]);
      }
    }
  }

  for (const cf of candidateSolidFaces) {
    if (solidFaceCounts.get(cf.key) !== 1) continue;
    if (cf.nodes.length === 4) {
      emitQuad(cf.nodes[0]!, cf.nodes[1]!, cf.nodes[2]!, cf.nodes[3]!, cf.el);
    } else if (cf.nodes.length === 3) {
      emitTriFace(cf.nodes[0]!, cf.nodes[1]!, cf.nodes[2]!, cf.el);
    }
  }

  const solidGeometry = new THREE.BufferGeometry();
  solidGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  solidGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  solidGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  solidGeometry.computeBoundingSphere();

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));

  let ghostEdgeGeometry: THREE.BufferGeometry | null = null;
  if (ghostEdgePositions.length > 0) {
    ghostEdgeGeometry = new THREE.BufferGeometry();
    ghostEdgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ghostEdgePositions, 3));
  }

  let beamGeometry: THREE.BufferGeometry | null = null;
  if (beamPositions.length > 0) {
    beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute("position", new THREE.Float32BufferAttribute(beamPositions, 3));
  }

  return {
    solidGeometry,
    edgeGeometry,
    ghostEdgeGeometry,
    beamGeometry,
    triToElement,
    normalizedNodePositions,
    boundingRadius: solidGeometry.boundingSphere?.radius || 20,
  };
}

export const FeaDeckViewer: React.FC<FeaDeckViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<FeaViewMode>("3d");
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  // 3D Viewport interactive states
  const [renderMode, setRenderMode] = useState<RenderMode>("shaded");
  const [showMeshEdges, setShowMeshEdges] = useState<boolean>(true);
  const [showBcLoads, setShowBcLoads] = useState<boolean>(true);
  const [showNodeDots, setShowNodeDots] = useState<boolean>(true);
  const [deformed, setDeformed] = useState<boolean>(false);
  const [colorBy, setColorBy] = useState<FeaColorByMode>("elset");
  const [selectedSetKey, setSelectedSetKey] = useState<string | null>(null);
  const [clipAxis, setClipAxis] = useState<ClipAxis>("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [presetTrigger, setPresetTrigger] = useState<{ preset: CameraPreset; timestamp: number } | null>(null);
  const [hoverProbe, setHoverProbe] = useState<FeaHoverProbe | null>(null);

  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const codeContainerRef = useRef<HTMLDivElement | null>(null);

  const title = viewConfig.title || viewConfig.meshName || "FEA Simulation Deck (.inp)";

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
        .catch((err) => console.warn("[FeaDeckViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedDeck = useMemo(() => parseCalculixDeckClient(rawText), [rawText]);
  const loadKn = viewConfig.loadKn ?? parsedDeck.loadKn;

  const hasDiagramSupport = parsedDeck.nodes.length > 0 || Boolean(viewConfig.svg);

  const scene3D = useMemo(
    () => build3DDeckGeometries(parsedDeck, colorBy, selectedSetKey, deformed),
    [parsedDeck, colorBy, selectedSetKey, deformed],
  );

  const effectiveViewMode: FeaViewMode =
    viewMode === "3d" && scene3D
      ? "3d"
      : viewMode === "diagram" && hasDiagramSupport
        ? "diagram"
        : scene3D && viewMode !== "code"
          ? "3d"
          : hasDiagramSupport && viewMode !== "code"
            ? "diagram"
            : "code";

  const sanitizedSvg = useMemo(() => {
    if (effectiveViewMode !== "diagram") return "";
    if (parsedDeck.nodes.length > 0) {
      return buildIsometricDeckSvg(parsedDeck, title, isFullScreen, isDark);
    }
    if (viewConfig.svg) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }
    return "";
  }, [effectiveViewMode, viewConfig.svg, parsedDeck, title, isFullScreen, isDark]);

  useEffect(() => {
    return () => {
      scene3D?.solidGeometry.dispose();
      scene3D?.edgeGeometry.dispose();
      scene3D?.ghostEdgeGeometry?.dispose();
      scene3D?.beamGeometry?.dispose();
    };
  }, [scene3D]);

  const clippingPlanes = useMemo(() => {
    if (clipAxis === "none" || !scene3D) return [];
    const r = scene3D.boundingRadius || 20;
    const dist = clipOffset * r;
    const normal =
      clipAxis === "x"
        ? new THREE.Vector3(-1, 0, 0)
        : clipAxis === "y"
          ? new THREE.Vector3(0, -1, 0)
          : new THREE.Vector3(0, 0, -1);
    return [new THREE.Plane(normal, dist)];
  }, [clipAxis, clipOffset, scene3D]);

  const handlePointerMove3D = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!scene3D || e.faceIndex === undefined || e.faceIndex === null) {
      setHoverProbe(null);
      return;
    }
    const el = scene3D.triToElement[e.faceIndex];
    if (!el) {
      setHoverProbe(null);
      return;
    }
    const pt = e.point;
    let nearestNode = parsedDeck.nodes[0]!;
    let bestDist = Infinity;
    for (const nid of el.nodes) {
      const normPos = scene3D.normalizedNodePositions.get(nid);
      const rawNode = parsedDeck.nodeById.get(nid);
      if (normPos && rawNode) {
        const d = Math.hypot(normPos[0] - pt.x, normPos[1] - pt.y, normPos[2] - pt.z);
        if (d < bestDist) {
          bestDist = d;
          nearestNode = rawNode;
        }
      }
    }
    const matName =
      parsedDeck.elsetMaterial.get(el.elset) || Array.from(parsedDeck.materials.keys())[0] || "DEFAULT_STRUCTURAL";
    setHoverProbe({
      worldPoint: [pt.x, pt.y, pt.z],
      elementId: el.id,
      elementType: el.type,
      elset: el.elset,
      materialName: matName,
      aspectRatio: el.aspectRatio,
      estimatedStressMpa: el.estimatedStressMpa,
      nearestNode,
      fixedDofs: parsedDeck.fixedNodes.get(nearestNode.id),
      loadVec: parsedDeck.nodalLoads.get(nearestNode.id),
    });
  };

  const jumpToDeckLine = (lineNum: number) => {
    setHighlightedLine(lineNum);
    setViewMode("code");
    setTimeout(() => {
      const row = codeContainerRef.current?.querySelector(`[data-line="${lineNum}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  const codeLines = useMemo(
    () => (effectiveViewMode === "code" && rawText ? rawText.split(/\r?\n/) : []),
    [effectiveViewMode, rawText],
  );
  const elsetList = Array.from(parsedDeck.elementSets.values());
  const nsetList = Array.from(parsedDeck.nodeSets.values()).filter((s) => s.name !== "NALL");
  const matList = Array.from(parsedDeck.materials.values());

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar $isFullScreen={isFullScreen}>
        <HeaderLeft>
          <ZapIcon size={15} fill="var(--color-accent-fg, currentColor)" />
          <PillBadge>CalculiX 3D {parsedDeck.elementType ? `• ${parsedDeck.elementType}` : "FEA"}</PillBadge>
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          {(scene3D || hasDiagramSupport) && (
            <Box
              display="flex"
              bg="var(--color-canvas-default)"
              borderRadius="6px"
              p="2px"
              border="1px solid var(--color-border-default)"
            >
              {scene3D && (
                <button
                  type="button"
                  onClick={() => setViewMode("3d")}
                  style={{
                    background:
                      effectiveViewMode === "3d" ? "var(--ms-brand-soft, rgba(14, 165, 233, 0.18))" : "transparent",
                    color:
                      effectiveViewMode === "3d" ? "var(--ms-brand, var(--color-accent-fg))" : "var(--color-fg-muted)",
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
                  <VersionsIcon size={12} /> 3D Mesh
                </button>
              )}
              {hasDiagramSupport && (
                <button
                  type="button"
                  onClick={() => setViewMode("diagram")}
                  style={{
                    background:
                      effectiveViewMode === "diagram"
                        ? "var(--ms-brand-soft, rgba(14, 165, 233, 0.18))"
                        : "transparent",
                    color:
                      effectiveViewMode === "diagram"
                        ? "var(--ms-brand, var(--color-accent-fg))"
                        : "var(--color-fg-muted)",
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
                  <WorkflowIcon size={12} /> 2D Iso
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewMode("code")}
                style={{
                  background:
                    effectiveViewMode === "code" ? "var(--ms-brand-soft, rgba(14, 165, 233, 0.18))" : "transparent",
                  color:
                    effectiveViewMode === "code" ? "var(--ms-brand, var(--color-accent-fg))" : "var(--color-fg-muted)",
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
                <CodeIcon size={12} /> Deck
              </button>
            </Box>
          )}

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={DraftingTriangleIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "fea" as any,
                  code: rawText || `*HEADING\n${title}\n`,
                  title,
                });
                const resolvedId = artifactId ?? viewConfig.artifactId;
                const fromArtifact = resolvedId ? `?fromArtifact=${resolvedId}` : "";
                navigate(`/morsel${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Morsel
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "3d" && scene3D ? (
          <ViewportStage onPointerLeave={() => setHoverProbe(null)}>
            <ViewportCameraControls
              topOffset="12px"
              onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
              isWireframe={showMeshEdges}
              onToggleWireframe={setShowMeshEdges}
              clipAxis={clipAxis}
              onClipAxisChange={setClipAxis}
              clipOffset={clipOffset}
              onClipOffsetChange={setClipOffset}
            />

            <TopRightHud onClick={(e) => e.stopPropagation()}>
              <HudPillButton
                $active={colorBy === "elset"}
                onClick={() => setColorBy("elset")}
                title="Color elements by Element Set / Material assignment"
              >
                SET
              </HudPillButton>
              <HudPillButton
                $active={colorBy === "stress"}
                $accent="#fb923c"
                onClick={() => setColorBy("stress")}
                title="Color elements by Von Mises stress distribution"
              >
                STRESS
              </HudPillButton>
              <HudPillButton
                $active={colorBy === "quality"}
                onClick={() => setColorBy("quality")}
                title="Color elements by 3D edge aspect-ratio quality"
              >
                QUALITY
              </HudPillButton>
              <HudPillButton
                $active={colorBy === "bcload"}
                onClick={() => setColorBy("bcload")}
                title="Highlight fixed boundary condition vs loaded elements"
              >
                BC/LOAD
              </HudPillButton>
              <span style={{ width: 1, height: 13, background: "rgba(255,255,255,0.15)" }} />
              <HudPillButton
                $active={deformed}
                $accent="#34d399"
                onClick={() => {
                  const next = !deformed;
                  setDeformed(next);
                  if (next && colorBy === "elset") setColorBy("stress");
                }}
                title="Toggle 3D structural deflection with undeformed ghost wireframe"
              >
                DEFORM
              </HudPillButton>
              <HudPillButton
                $active={showBcLoads}
                $accent="#f43f5e"
                onClick={() => setShowBcLoads((v) => !v)}
                title="Toggle 3D boundary supports and force vector arrows"
              >
                <EyeIcon size={10} /> VECTORS
              </HudPillButton>
              <HudPillButton
                $active={showNodeDots}
                onClick={() => setShowNodeDots((v) => !v)}
                title="Toggle 3D finite element nodal vertices"
              >
                NODES ({parsedDeck.nodes.length})
              </HudPillButton>
            </TopRightHud>

            <Canvas
              gl={{ preserveDrawingBuffer: true, localClippingEnabled: true, antialias: true }}
              camera={{ position: [26, 18, 36], fov: 44 }}
            >
              <AutoThumbnailCapture
                artifactId={artifactId}
                hasThumbnail={Boolean(viewConfig.thumbnailUrl || viewConfig.thumbnail_url)}
              />
              <ambientLight intensity={0.65} />
              <directionalLight position={[30, 45, 35]} intensity={1.15} />
              <directionalLight position={[-25, -20, -30]} intensity={0.45} />

              <group>
                {/* Solid / X-Ray / Wireframe Finite Element Mesh */}
                <mesh
                  geometry={scene3D.solidGeometry}
                  onPointerMove={handlePointerMove3D}
                  onPointerOut={() => setHoverProbe(null)}
                >
                  <meshStandardMaterial
                    vertexColors
                    roughness={0.38}
                    metalness={0.18}
                    wireframe={renderMode === "wireframe"}
                    transparent={renderMode === "xray" || Boolean(selectedSetKey)}
                    opacity={renderMode === "xray" ? 0.38 : selectedSetKey ? 0.88 : 0.96}
                    side={THREE.DoubleSide}
                    clippingPlanes={clippingPlanes}
                    polygonOffset
                    polygonOffsetFactor={1}
                    polygonOffsetUnits={1}
                  />
                </mesh>

                {/* Crisp True Hex/Tet Element Perimeter Wireframe Edges */}
                {showMeshEdges && renderMode !== "wireframe" && (
                  <lineSegments geometry={scene3D.edgeGeometry}>
                    <lineBasicMaterial color="#bae6fd" transparent opacity={0.78} clippingPlanes={clippingPlanes} />
                  </lineSegments>
                )}

                {/* Undeformed Ghost Wireframe Overlay when Deformed Mode is Active */}
                {deformed && scene3D.ghostEdgeGeometry && (
                  <lineSegments geometry={scene3D.ghostEdgeGeometry}>
                    <lineBasicMaterial color="#64748b" transparent opacity={0.45} clippingPlanes={clippingPlanes} />
                  </lineSegments>
                )}

                {/* 1D Beam / Truss Elements */}
                {scene3D.beamGeometry && (
                  <lineSegments geometry={scene3D.beamGeometry}>
                    <lineBasicMaterial color="#38bdf8" clippingPlanes={clippingPlanes} />
                  </lineSegments>
                )}

                {/* 3D Nodal Vertices */}
                {showNodeDots &&
                  parsedDeck.nodes.slice(0, 500).map((n) => {
                    const pos = scene3D.normalizedNodePositions.get(n.id);
                    if (!pos) return null;
                    const isFixed = parsedDeck.fixedNodes.has(n.id);
                    const isLoaded = parsedDeck.nodalLoads.has(n.id);
                    const inSelectedNset =
                      selectedSetKey?.startsWith("NSET:") &&
                      parsedDeck.nodeSets.get(selectedSetKey.slice(5))?.ids.has(n.id);
                    return (
                      <mesh key={`node-${n.id}`} position={pos}>
                        <sphereGeometry args={[inSelectedNset ? 0.55 : isFixed || isLoaded ? 0.42 : 0.28, 10, 10]} />
                        <meshBasicMaterial
                          color={inSelectedNset ? "#fde047" : isLoaded ? "#f43f5e" : isFixed ? "#06b6d4" : "#e2e8f0"}
                        />
                      </mesh>
                    );
                  })}

                {/* 3D Fixed Boundary Support Cones & Force Vector Arrows */}
                {showBcLoads && (
                  <group>
                    {Array.from(parsedDeck.fixedNodes.entries()).map(([nid]) => {
                      const pos = scene3D.normalizedNodePositions.get(nid);
                      if (!pos) return null;
                      return (
                        <mesh key={`bc-${nid}`} position={[pos[0], pos[1] - 0.75, pos[2]]}>
                          <coneGeometry args={[0.72, 1.35, 4]} />
                          <meshStandardMaterial color="#06b6d4" emissive="#0891b2" emissiveIntensity={0.35} />
                        </mesh>
                      );
                    })}

                    {Array.from(parsedDeck.nodalLoads.entries()).map(([nid, fVec]) => {
                      const pos = scene3D.normalizedNodePositions.get(nid);
                      if (!pos) return null;
                      const dir = new THREE.Vector3(fVec[0], fVec[1], fVec[2]);
                      if (dir.lengthSq() <= 1e-9) return null;
                      dir.normalize();
                      const arrowLen = 4.6;
                      const origin = new THREE.Vector3(
                        pos[0] - dir.x * arrowLen,
                        pos[1] - dir.y * arrowLen,
                        pos[2] - dir.z * arrowLen,
                      );
                      return <arrowHelper key={`load-${nid}`} args={[dir, origin, arrowLen, 0xf43f5e, 1.35, 0.85]} />;
                    })}
                  </group>
                )}

                {/* Hover Numerical & Topological Probe Tooltip */}
                {hoverProbe && (
                  <Html
                    position={hoverProbe.worldPoint}
                    style={{ pointerEvents: "none", transform: "translate3d(-50%, -120%, 0)" }}
                  >
                    <div
                      style={{
                        background: "rgba(13, 17, 23, 0.94)",
                        backdropFilter: "blur(8px)",
                        color: "#f8fafc",
                        border: "1px solid rgba(56, 189, 248, 0.55)",
                        padding: "6px 10px",
                        borderRadius: "8px",
                        fontSize: "10.5px",
                        fontFamily: "var(--font-mono, monospace)",
                        whiteSpace: "nowrap",
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.55)",
                        lineHeight: 1.45,
                      }}
                    >
                      <div style={{ color: "#38bdf8", fontWeight: 700 }}>
                        Elem #{hoverProbe.elementId} ({hoverProbe.elementType}) • {hoverProbe.elset}
                      </div>
                      <div style={{ color: "#cbd5e1" }}>
                        Mat: {hoverProbe.materialName} • Est. σ_vM: {hoverProbe.estimatedStressMpa} MPa • AR:{" "}
                        {hoverProbe.aspectRatio}
                      </div>
                      <div style={{ color: "#94a3b8" }}>
                        Node #{hoverProbe.nearestNode.id} ({hoverProbe.nearestNode.x}, {hoverProbe.nearestNode.y},{" "}
                        {hoverProbe.nearestNode.z})
                      </div>
                      {hoverProbe.fixedDofs && (
                        <div style={{ color: "#22d3ee", fontWeight: 600 }}>
                          Fixed BC: DOF [{hoverProbe.fixedDofs.join(",")}]
                        </div>
                      )}
                      {hoverProbe.loadVec && (
                        <div style={{ color: "#fb7185", fontWeight: 600 }}>
                          Load: [{hoverProbe.loadVec.join(", ")}] N
                        </div>
                      )}
                    </div>
                  </Html>
                )}
              </group>

              <CameraController orbitControlsRef={orbitControlsRef} presetTrigger={presetTrigger} />
              <SafeOrbitControls controlsRef={orbitControlsRef} isFullScreen={isFullScreen} />
            </Canvas>

            {/* Bottom Set, Material & Step Explorer HUD */}
            <BottomSetBar onClick={(e) => e.stopPropagation()}>
              <SetChipsRow>
                <SetChip $active={selectedSetKey === null} $color="#38bdf8" onClick={() => setSelectedSetKey(null)}>
                  All ({parsedDeck.elements.length} Elem • {parsedDeck.nodes.length} Nodes)
                </SetChip>

                {elsetList.map((es) => {
                  const key = `ELSET:${es.name}`;
                  return (
                    <SetChip
                      key={key}
                      $active={selectedSetKey === key}
                      $color="#38bdf8"
                      onClick={() => setSelectedSetKey(selectedSetKey === key ? null : key)}
                      onDoubleClick={() => jumpToDeckLine(es.line)}
                      title="Click to isolate Element Set in 3D • Double-click to view in .inp deck"
                    >
                      ELSET: {es.name} ({es.ids.size})
                    </SetChip>
                  );
                })}

                {nsetList.map((ns) => {
                  const key = `NSET:${ns.name}`;
                  const isFixedSet = Array.from(ns.ids).some((id) => parsedDeck.fixedNodes.has(id));
                  const isLoadSet = Array.from(ns.ids).some((id) => parsedDeck.nodalLoads.has(id));
                  const color = isLoadSet ? "#f43f5e" : isFixedSet ? "#06b6d4" : "#a855f7";
                  return (
                    <SetChip
                      key={key}
                      $active={selectedSetKey === key}
                      $color={color}
                      onClick={() => setSelectedSetKey(selectedSetKey === key ? null : key)}
                      onDoubleClick={() => jumpToDeckLine(ns.line)}
                      title="Click to highlight Node Set in 3D • Double-click to view in .inp deck"
                    >
                      NSET: {ns.name} ({ns.ids.size})
                    </SetChip>
                  );
                })}

                {matList.map((m) => {
                  const key = `MAT:${m.name}`;
                  return (
                    <SetChip
                      key={key}
                      $active={selectedSetKey === key}
                      $color="#34d399"
                      onClick={() => setSelectedSetKey(selectedSetKey === key ? null : key)}
                      onDoubleClick={() => jumpToDeckLine(m.line)}
                      title="Click to isolate Material in 3D • Double-click to inspect Material card in .inp deck"
                    >
                      {m.name}
                      {m.youngsModulusGpa ? ` (${m.youngsModulusGpa} GPa)` : ""}
                    </SetChip>
                  );
                })}
              </SetChipsRow>

              <Box
                display="flex"
                alignItems="center"
                gap={2}
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--font-mono, monospace)",
                  color: "#94a3b8",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {loadKn !== undefined && <span style={{ color: "#fda4af" }}>ΣF = {loadKn} kN</span>}
                <span
                  style={{ color: "#38bdf8" }}
                  title="Pre-solve analytical beam/lug stress estimate from deck loads & geometry"
                >
                  Est. Peak σ = {parsedDeck.peakStressMpa} MPa
                </span>
                <span
                  style={{ color: "#34d399" }}
                  title="Pre-solve analytical safety factor estimate against material yield limit"
                >
                  Est. SF = {parsedDeck.minSafetyFactor}
                </span>
                <span>Steps: {parsedDeck.steps.length || 1}</span>
              </Box>
            </BottomSetBar>
          </ViewportStage>
        ) : effectiveViewMode === "diagram" && sanitizedSvg ? (
          <InteractiveSvgStage svgHtml={sanitizedSvg} />
        ) : (
          <Box
            ref={codeContainerRef}
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-default)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => {
                const lineNum = idx + 1;
                const isHighlighted = highlightedLine === lineNum;
                return (
                  <div
                    key={idx}
                    data-line={lineNum}
                    style={{
                      display: "flex",
                      padding: "0 14px",
                      background: isHighlighted ? "rgba(56, 189, 248, 0.16)" : "transparent",
                      borderLeft: isHighlighted ? "3px solid #38bdf8" : "3px solid transparent",
                    }}
                  >
                    <span
                      style={{
                        userSelect: "none",
                        width: "36px",
                        minWidth: "36px",
                        textAlign: "right",
                        paddingRight: "12px",
                        color: isHighlighted ? "#38bdf8" : "var(--color-fg-subtle)",
                        fontSize: "11px",
                        fontWeight: isHighlighted ? 700 : 400,
                      }}
                    >
                      {lineNum}
                    </span>
                    <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                      {highlightPolyglotLine(line, "fea")}
                    </span>
                  </div>
                );
              })
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No FEA deck source available.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default FeaDeckViewer;
