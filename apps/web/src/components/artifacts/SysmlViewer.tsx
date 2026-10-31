// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  DotFillIcon,
  SearchIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface SysmlPart {
  name: string;
  type: string;
  multiplicity?: string | undefined;
  ports?: string[] | undefined;
  attributes?: string[] | undefined;
  description?: string | undefined;
}

export interface SysmlConstraintWitness {
  expr: string;
  actual: string;
  bound: string;
  margin: string;
  passed: boolean;
}

export interface SysmlRequirement {
  id: string;
  name: string;
  text: string;
  status: "satisfied" | "verified" | "unverified" | "violated" | string;
  subject?: string | undefined;
  satisfiedBy?: string | undefined;
  constraintExpr?: string | undefined;
  witnesses?: SysmlConstraintWitness[] | undefined;
}

export interface SysmlConnection {
  source: string;
  target: string;
  flowType?: string | undefined;
}

export interface SysmlStateMachine {
  name: string;
  states: string[];
  transitions: { from: string; to: string; guard?: string | undefined }[];
}

export interface SysmlPortDef {
  name: string;
  attributes: string[];
}

export interface SysmlViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    format?: "SysML2" | "KerML" | string | undefined;
    systemName?: string | undefined;
    rootPartDef?: string | undefined;
    title?: string | undefined;
    code?: string | undefined;
    source?: string | undefined;
    url?: string | undefined;
    svg?: string | undefined;
    parts?: SysmlPart[] | undefined;
    requirements?: SysmlRequirement[] | undefined;
    connections?: SysmlConnection[] | undefined;
    states?: SysmlStateMachine[] | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "460px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.75));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  gap: 8px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
`;

const SystemTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "sysml" | "req-pass" | "req-warn" | "kerml" | undefined }>`
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

  ${(props) => {
    switch (props.$variant) {
      case "sysml":
        return `
          background: rgba(59, 130, 246, 0.15);
          color: var(--color-accent-blue, #60a5fa);
          border: 1px solid rgba(59, 130, 246, 0.4);
        `;
      case "kerml":
        return `
          background: rgba(168, 85, 247, 0.15);
          color: var(--color-accent-purple, #c084fc);
          border: 1px solid rgba(168, 85, 247, 0.4);
        `;
      case "req-pass":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.4);
        `;
      case "req-warn":
        return `
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.4);
        `;
      default:
        return `
          background: rgba(255, 255, 255, 0.05);
          color: var(--color-text-muted, #8b949e);
          border: 1px solid rgba(255, 255, 255, 0.08);
        `;
    }
  }}
`;

const TabNav = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 36px;
  min-height: 36px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  padding: 0 10px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const TabGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: none;
  border: none;
  height: 100%;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  color: ${(props) => (props.$active ? "var(--color-text-primary, #ffffff)" : "var(--color-text-muted, #8b949e)")};
  cursor: pointer;
  position: relative;
  outline: none;
  font-family: inherit;
  transition: color 0.15s ease;

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 6px;
      right: 6px;
      height: 2px;
      background: var(--color-accent-blue, #3b82f6);
      border-radius: 9999px;
    }
  `}

  &:hover {
    color: var(--color-text-primary, #ffffff);
  }
`;

const TabCount = styled.span<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 9999px;
  background: ${(props) => (props.$active ? "rgba(59, 130, 246, 0.22)" : "rgba(255, 255, 255, 0.07)")};
  color: ${(props) => (props.$active ? "#60a5fa" : "var(--color-text-muted, #8b949e)")};
`;

const SubViewSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  background: rgba(13, 17, 23, 0.85);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SubViewButton = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(props) => (props.$active ? "rgba(59, 130, 246, 0.22)" : "transparent")};
  color: ${(props) => (props.$active ? "#60a5fa" : "var(--color-text-muted, #8b949e)")};
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;

  &:hover {
    color: var(--color-text-primary, #f0f6fc);
  }
`;

const ContentBody = styled.div<{ $noPadding?: boolean | undefined }>`
  flex: 1;
  overflow: auto;
  padding: ${(props) => (props.$noPadding ? "0" : "12px")};
  background: var(--color-canvas-default, #0d1117);
  position: relative;
`;

const DiagramStage = styled.div`
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  background: #0b111e;
  position: relative;
  overflow: hidden;
`;

const DiagramHudBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.75);
  border-bottom: 1px solid rgba(51, 65, 85, 0.5);
  gap: 8px;
  z-index: 5;
`;

const TreeCard = styled.div`
  background: var(--color-canvas-subtle, #161b22);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: rgba(59, 130, 246, 0.4);
  }
`;

const CodeEditor = styled.pre`
  margin: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-primary, #e6edf3);
  overflow: auto;
  white-space: pre;
`;

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatConstraintMath(expr: string): string {
  return expr
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/==/g, "=")
    .replace(/!=/g, "≠")
    .replace(/\band\b/gi, "∧")
    .replace(/\bor\b/gi, "∨");
}

export function parseSysmlSource(code: string): {
  packageName: string;
  rootPartDef: string;
  parts: SysmlPart[];
  partDefs: SysmlPart[];
  portDefs: SysmlPortDef[];
  requirements: SysmlRequirement[];
  connections: SysmlConnection[];
  states: SysmlStateMachine[];
} {
  const parts: SysmlPart[] = [];
  const partDefsList: SysmlPart[] = [];
  const portDefs: SysmlPortDef[] = [];
  const requirements: SysmlRequirement[] = [];
  const connections: SysmlConnection[] = [];
  const states: SysmlStateMachine[] = [];

  if (!code.trim()) {
    return {
      packageName: "",
      rootPartDef: "",
      parts,
      partDefs: partDefsList,
      portDefs,
      requirements,
      connections,
      states,
    };
  }

  const pkgMatch = code.match(/\bpackage\s+([A-Za-z_]\w*)/);
  const packageName = pkgMatch?.[1] || "";

  // 1. Collect all numeric attribute bindings across the model for formal constraint evaluation
  const attrValues = new Map<string, { value: number; unit?: string | undefined }>();
  const attrValRe =
    /\battribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = attrValRe.exec(code)) !== null) {
    const attrName = m[1]!;
    const attrType = m[2] || "";
    const num = Number(m[3]);
    if (Number.isFinite(num)) {
      let unit = "";
      if (/Velocity|Mps/i.test(attrType) || /Mps$/i.test(attrName)) unit = "m/s";
      else if (/Thrust|Kn/i.test(attrType)) unit = "kN";
      else if (/Angle|Deg/i.test(attrType) || /Deg$/i.test(attrName)) unit = "deg";
      else if (/TimeMs|Ms$/i.test(attrType) || /Ms$/i.test(attrName)) unit = "ms";
      else if (/Sec$/i.test(attrName)) unit = "s";
      else if (/Pct|Percentage/i.test(attrType) || /Pct$/i.test(attrName)) unit = "%";
      else if (/Meters$/i.test(attrName)) unit = "m";
      else if (/Cm$/i.test(attrName)) unit = "cm";
      attrValues.set(attrName, { value: num, ...(unit ? { unit } : {}) });
    }
  }

  // 2. Extract port definitions
  const portDefRe = /\bport\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = portDefRe.exec(code)) !== null) {
    const pName = m[1]!;
    const pBody = m[2] || "";
    const attrs: string[] = [];
    const attrRe =
      /\b(?:(in|out|inout)\s+)?attribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?(?:\s*=\s*([^;\n]+))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(pBody)) !== null) {
      const dir = am[1] ? `${am[1]} ` : "";
      const aName = am[2]!;
      const aType = am[3] ? ` : ${am[3]}` : "";
      const aVal = am[4] ? ` = ${am[4].trim()}` : "";
      attrs.push(`${dir}${aName}${aType}${aVal}`);
    }
    portDefs.push({ name: pName, attributes: attrs });
  }

  // 3. Extract part definitions and usages
  const partDefRe = /\bpart\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  const defMetaMap = new Map<
    string,
    {
      ports: string[];
      rawPorts: { name: string; type: string; conjugated: boolean; dir: string }[];
      attributes: string[];
      doc?: string | undefined;
      hasSubParts: boolean;
    }
  >();
  let rootPartDef = "";

  while ((m = partDefRe.exec(code)) !== null) {
    const defName = m[1]!;
    const body = m[2] || "";
    const docMatch = body.match(/\bdoc\s*\/\*([\s\S]*?)\*\//);
    const doc = docMatch?.[1]?.replace(/\s+/g, " ").trim();

    const ports: string[] = [];
    const rawPorts: { name: string; type: string; conjugated: boolean; dir: string }[] = [];
    const portRe = /\b(?:(in|out|inout)\s+)?port\s+([A-Za-z_]\w*)(?:\s*:\s*(~?)([A-Za-z_]\w*))?/g;
    let pm: RegExpExecArray | null;
    while ((pm = portRe.exec(body)) !== null) {
      const explicitDir = pm[1];
      const pName = pm[2]!;
      const isConj = pm[3] === "~";
      const pType = pm[4] || "Port";
      const dir = explicitDir || (isConj || /In$/i.test(pName) ? "in" : "out");
      ports.push(`${dir} ${pName} : ${isConj ? "~" : ""}${pType}`);
      rawPorts.push({ name: pName, type: pType, conjugated: isConj, dir });
    }

    const attributes: string[] = [];
    const attrRe = /\battribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?(?:\s*=\s*([^;\n]+))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(body)) !== null) {
      const aName = am[1]!;
      const aType = am[2];
      const aVal = am[3]?.trim();
      const info = attrValues.get(aName);
      const unitSuffix = info?.unit && aVal && !aVal.includes(info.unit) ? ` ${info.unit}` : "";
      if (aVal) {
        attributes.push(`${aName} = ${aVal}${unitSuffix}`);
      } else if (aType) {
        attributes.push(`${aName} : ${aType}`);
      } else {
        attributes.push(aName);
      }
    }

    const hasSubParts = /\bpart\s+(?!def\b)[A-Za-z_]\w*\s*:/.test(body);
    if (hasSubParts) {
      rootPartDef = defName;
    }

    defMetaMap.set(defName, { ports, rawPorts, attributes, doc, hasSubParts });
    partDefsList.push({
      name: defName,
      type: hasSubParts ? "System Assembly" : "PartDefinition",
      multiplicity: "1",
      ports,
      attributes,
      description: doc,
    });
  }

  const portTypeByEndpoint = new Map<string, string>();
  const partUsageRe = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)(?:\s*\[([^\]]+)\])?/g;
  while ((m = partUsageRe.exec(code)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const mult = m[3]?.trim() || "1";
    const meta = defMetaMap.get(type);
    for (const rp of meta?.rawPorts || []) {
      portTypeByEndpoint.set(`${name}.${rp.name}`, rp.type);
    }
    parts.push({
      name,
      type,
      multiplicity: mult,
      ports: meta?.ports || [],
      attributes: meta?.attributes || [],
      description: meta?.doc,
    });
  }

  if (parts.length === 0) {
    for (const pd of partDefsList) {
      parts.push(pd);
    }
  }

  // 4. Extract state machines
  const stateDefRe = /\bstate\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = stateDefRe.exec(code)) !== null) {
    const smName = m[1]!;
    const smBody = m[2] || "";
    const stNames: string[] = [];
    const stRe = /\bstate\s+(?!def\b)([A-Za-z_]\w*)\s*;/g;
    let smMatch: RegExpExecArray | null;
    while ((smMatch = stRe.exec(smBody)) !== null) {
      stNames.push(smMatch[1]!);
    }
    const transitions: SysmlStateMachine["transitions"] = [];
    const trRe =
      /\btransition\s+(?:[A-Za-z_]\w*\s+)?first\s+([A-Za-z_]\w*)(?:\s+if\s+([\s\S]*?))?\s+then\s+([A-Za-z_]\w*)\s*;/g;
    while ((smMatch = trRe.exec(smBody)) !== null) {
      transitions.push({
        from: smMatch[1]!,
        to: smMatch[3]!,
        ...(smMatch[2] ? { guard: smMatch[2].replace(/\s+/g, " ").trim() } : {}),
      });
    }
    if (stNames.length > 0) {
      states.push({ name: smName, states: stNames, transitions });
    }
  }

  // 5. Extract requirement definitions, satisfy/verify links, and formal constraints
  const satisfyByMap = new Map<string, string>();
  const satisfyRe = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = satisfyRe.exec(code)) !== null) {
    satisfyByMap.set(m[1]!, m[2] || "System");
  }
  const verifyByMap = new Map<string, string>();
  const verifyRe = /\bverify\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = verifyRe.exec(code)) !== null) {
    verifyByMap.set(m[1]!, m[2] || "VerificationCase");
  }

  const reqHeaderRe = /\brequirement\s+(?:def\s+)?(?:<'([^']+)'>\s*)?([A-Za-z_]\w*)\s*\{/g;
  let reqIdx = 1;
  while ((m = reqHeaderRe.exec(code)) !== null) {
    const explicitId = m[1];
    const reqName = m[2]!;
    const openBraceIdx = m.index + m[0].length - 1;
    let depth = 1;
    let pos = openBraceIdx + 1;
    while (pos < code.length && depth > 0) {
      if (code[pos] === "{") depth++;
      else if (code[pos] === "}") depth--;
      pos++;
    }
    const body = code.slice(openBraceIdx + 1, pos - 1);
    const docMatch = body.match(/\bdoc\s*\/\*([\s\S]*?)\*\//) || body.match(/\/\*([\s\S]*?)\*\//);
    const text = docMatch ? docMatch[1]!.replace(/\s+/g, " ").trim() : `Requirement specification for ${reqName}`;

    const subjMatch = body.match(/\bsubject\s+([A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*)/);
    const subject = subjMatch?.[1]?.replace(/\s+/g, " ").trim();

    const constraintMatch = body.match(/\b(?:require|assume)\s+constraint\s*\{([\s\S]*?)\}/);
    const constraintExpr = constraintMatch?.[1]?.replace(/\s+/g, " ").trim();

    const witnesses: SysmlConstraintWitness[] = [];
    if (constraintExpr) {
      const clauses = constraintExpr
        .split(/\band\b|&&/i)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const clause of clauses) {
        const relMatch = clause.match(/^([A-Za-z0-9_.]+)\s*(<=|>=|==|<|>)\s*([-+]?\d+(?:\.\d+)?)$/);
        if (relMatch) {
          const lhs = relMatch[1]!;
          const op = relMatch[2]!;
          const rhsNum = Number(relMatch[3]);
          const shortVar = lhs.split(".").pop()!;
          const found = attrValues.get(shortVar);
          if (found !== undefined) {
            const actualVal = found.value;
            const unitStr = found.unit ? ` ${found.unit}` : "";
            let passed = true;
            if (op === "<=") passed = actualVal <= rhsNum + 1e-9;
            else if (op === "<") passed = actualVal < rhsNum - 1e-9;
            else if (op === ">=") passed = actualVal >= rhsNum - 1e-9;
            else if (op === ">") passed = actualVal > rhsNum + 1e-9;
            else if (op === "==") passed = Math.abs(actualVal - rhsNum) <= 1e-9;

            let margin = "exact";
            if (Math.abs(rhsNum) > 1e-9) {
              const diff = op.startsWith("<") ? rhsNum - actualVal : actualVal - rhsNum;
              const pct = (diff / Math.abs(rhsNum)) * 100;
              margin = Math.abs(pct) < 1e-4 ? "exact" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
            } else if (Math.abs(actualVal - rhsNum) > 1e-9) {
              const diff = op.startsWith("<") ? rhsNum - actualVal : actualVal - rhsNum;
              margin = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}${unitStr}`;
            }

            witnesses.push({
              expr: `${shortVar} ${op} ${rhsNum}`,
              actual: `${actualVal}${unitStr}`,
              bound: `${rhsNum}${unitStr}`,
              margin,
              passed,
            });
          } else {
            witnesses.push({
              expr: clause,
              actual: "symbolic",
              bound: String(rhsNum),
              margin: "symbolic",
              passed: true,
            });
          }
        }
      }
    }

    const satisfiedBy = satisfyByMap.get(reqName) || verifyByMap.get(reqName);
    let status: SysmlRequirement["status"] = "unverified";
    if (witnesses.length > 0) {
      status = witnesses.every((w) => w.passed) ? "verified" : "violated";
    } else if (constraintExpr) {
      status = "verified";
    } else if (satisfiedBy) {
      status = "satisfied";
    }

    requirements.push({
      id: explicitId || `REQ-${String(reqIdx).padStart(2, "0")}`,
      name: reqName,
      text,
      status,
      ...(subject ? { subject } : {}),
      ...(satisfiedBy ? { satisfiedBy } : {}),
      ...(constraintExpr ? { constraintExpr } : {}),
      ...(witnesses.length > 0 ? { witnesses } : {}),
    });
    reqIdx++;
  }

  // 6. Extract connections
  const connRe = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRe.exec(code)) !== null) {
    const source = m[1]!;
    const target = m[2]!;
    const flowType = portTypeByEndpoint.get(source) || portTypeByEndpoint.get(target);
    connections.push({
      source,
      target,
      ...(flowType ? { flowType } : {}),
    });
  }

  return {
    packageName,
    rootPartDef,
    parts,
    partDefs: partDefsList,
    portDefs,
    requirements,
    connections,
    states,
  };
}

function buildIbdDiagramSvg(
  systemName: string,
  rootPartDef: string,
  parts: SysmlPart[],
  connections: SysmlConnection[],
  states: SysmlStateMachine[],
  requirements: SysmlRequirement[],
  isFullScreen = false,
): string {
  const width = 940;
  const hasStateMachine = states.length > 0;
  const hasReqs = requirements.length > 0;

  const partBoxes = parts.slice(0, 12);
  const nParts = Math.max(1, partBoxes.length);
  const maxCols = 4;
  const nCols = Math.min(maxCols, nParts);
  const nRows = Math.ceil(nParts / maxCols);
  const totalInnerW = width - 72;
  const boxW = Math.min(252, Math.floor((totalInnerW - (nCols - 1) * 56) / nCols));
  const boxH = 126;
  const rowGap = 34;
  const partY = 64;

  const reqList = requirements.slice(0, 6);
  const reqRows = hasReqs ? Math.ceil(reqList.length / 3) : 0;
  const height =
    partY + nRows * boxH + (nRows - 1) * rowGap + 36 + (hasStateMachine ? 88 : 0) + (hasReqs ? reqRows * 104 + 10 : 0);

  const partPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const nodesSvg: string[] = [];

  partBoxes.forEach((p, idx) => {
    const row = Math.floor(idx / maxCols);
    const col = idx % maxCols;
    const colsInRow = Math.min(maxCols, partBoxes.length - row * maxCols);
    const rowStartX = Math.floor((width - (colsInRow * boxW + (colsInRow - 1) * 56)) / 2);
    const x = rowStartX + col * (boxW + 56);
    const y = partY + row * (boxH + rowGap);
    partPos.set(p.name, { x, y, w: boxW, h: boxH });
    const multNum = parseInt(p.multiplicity || "1", 10) || 1;

    const stackShadows =
      multNum > 1
        ? `<rect x="${x + 6}" y="${y - 6}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.38"/>
           <rect x="${x + 3}" y="${y - 3}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.68"/>`
        : "";

    const attrLines = (p.attributes || []).slice(0, 2).map((attr, aIdx) => {
      const dispAttr = attr.length > 36 ? `${attr.slice(0, 35)}…` : attr;
      return `<text x="${x + 12}" y="${y + 68 + aIdx * 13}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5">${escapeXml(dispAttr)}</text>`;
    });

    const portPins: string[] = [];
    (p.ports || []).slice(0, 3).forEach((rawPort, pIdx) => {
      const isIn = /^in\b/.test(rawPort) || rawPort.includes("~");
      const isConj = rawPort.includes("~");
      const cleanPort = rawPort.replace(/^(?:in|out|inout)\s+/, "");
      const dispPort = cleanPort.length > 38 ? `${cleanPort.slice(0, 37)}…` : cleanPort;
      const pinX = isIn ? x - 5 : x + boxW - 5;
      const pinY = y + 36 + pIdx * 28;
      const pinFill = isConj ? "#3b82f6" : "#0f172a";
      portPins.push(
        `<rect x="${pinX}" y="${pinY - 5}" width="10" height="10" rx="2" fill="${pinFill}" stroke="#60a5fa" stroke-width="1.5"/>`,
        `<text x="${x + 12}" y="${y + 100 + pIdx * 13}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9">${escapeXml(dispPort)}</text>`,
      );
    });

    nodesSvg.push(`<g>
      ${stackShadows}
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="#161f33" stroke="#3b82f6" stroke-width="1.6"/>
      <path d="M ${x} ${y + 6} A 6 6 0 0 1 ${x + 6} ${y} L ${x + boxW - 6} ${y} A 6 6 0 0 1 ${x + boxW} ${y + 6} L ${x + boxW} ${y + 42} L ${x} ${y + 42} Z" fill="rgba(59, 130, 246, 0.14)"/>
      <line x1="${x}" y1="${y + 42}" x2="${x + boxW}" y2="${y + 42}" stroke="#3b82f6" stroke-width="1"/>
      <text x="${x + boxW / 2}" y="${y + 15}" text-anchor="middle" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">«part» ${escapeXml(p.type)}</text>
      <text x="${x + boxW / 2}" y="${y + 33}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11.5" font-weight="700">${escapeXml(p.name)}${p.multiplicity && p.multiplicity !== "1" ? ` [${escapeXml(p.multiplicity)}]` : ""}</text>
      <text x="${x + 12}" y="${y + 54}" fill="#64748b" font-family="system-ui, sans-serif" font-size="8" font-weight="700" letter-spacing="0.05em">ATTRIBUTES &amp; PORTS</text>
      ${attrLines.join("\n      ")}
      ${portPins.join("\n      ")}
    </g>`);
  });

  const edgesSvg: string[] = [];
  const srcPortCounts = new Map<string, number>();
  const tgtPortCounts = new Map<string, number>();

  connections.forEach((c, connIdx) => {
    const srcPart = c.source.split(".")[0]!;
    const tgtPart = c.target.split(".")[0]!;
    const b1 = partPos.get(srcPart);
    const b2 = partPos.get(tgtPart);
    if (!b1 || !b2) return;
    const srcCount = srcPortCounts.get(srcPart) || 0;
    const tgtCount = tgtPortCounts.get(tgtPart) || 0;
    srcPortCounts.set(srcPart, srcCount + 1);
    tgtPortCounts.set(tgtPart, tgtCount + 1);

    const goingRight = b2.x >= b1.x;
    const x1 = goingRight ? b1.x + b1.w + 5 : b1.x - 5;
    const y1 = b1.y + 40 + (srcCount % 4) * 20;
    const x2 = goingRight ? b2.x - 5 : b2.x + b2.w + 5;
    const y2 = b2.y + 40 + (tgtCount % 4) * 20;
    const midX = Math.round((x1 + x2) / 2) + ((connIdx % 3) - 1) * 6;
    const flowLabel = c.flowType || `${c.source.split(".")[1] || "out"} → ${c.target.split(".")[1] || "in"}`;
    const badgeW = Math.max(84, flowLabel.length * 5.6 + 14);
    const badgeY = Math.round((y1 + y2) / 2) - 22 + (connIdx % 2) * 14;
    edgesSvg.push(`<g>
      <path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}" fill="none" stroke="#34d399" stroke-width="1.8" marker-end="url(#sysml-arrow)"/>
      <rect x="${midX - badgeW / 2}" y="${badgeY}" width="${badgeW}" height="16" rx="4" fill="#0d1526" stroke="#10b981" stroke-width="1"/>
      <text x="${midX}" y="${badgeY + 11}" text-anchor="middle" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="600">${escapeXml(flowLabel)}</text>
    </g>`);
  });

  let curBottomY = partY + nRows * boxH + (nRows - 1) * rowGap + 18;
  const smSvg: string[] = [];
  if (hasStateMachine) {
    const sm = states[0]!;
    const stList = sm.states.slice(0, 5);
    const bandX = 32;
    const bandW = width - 64;
    const bandH = 72;
    smSvg.push(
      `<rect x="${bandX}" y="${curBottomY}" width="${bandW}" height="${bandH}" rx="6" fill="rgba(168, 85, 247, 0.06)" stroke="rgba(168, 85, 247, 0.35)" stroke-width="1.2" stroke-dasharray="4 3"/>`,
      `<text x="${bandX + 14}" y="${curBottomY + 16}" fill="#c084fc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«state def» ${escapeXml(sm.name)} (Modal GNC Trajectory Schedule)</text>`,
    );
    const pillW = Math.min(168, Math.floor((bandW - 48 - (stList.length - 1) * 36) / Math.max(1, stList.length)));
    const pillH = 28;
    const gap = 36;
    const stStartX = bandX + 24;
    const stY = curBottomY + 28;
    stList.forEach((stName, idx) => {
      const sx = stStartX + idx * (pillW + gap);
      smSvg.push(
        `<rect x="${sx}" y="${stY}" width="${pillW}" height="${pillH}" rx="14" fill="#1e1b38" stroke="#a855f7" stroke-width="1.4"/>`,
        `<text x="${sx + pillW / 2}" y="${stY + 18}" text-anchor="middle" fill="#f3e8ff" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">${escapeXml(stName)}</text>`,
      );
      if (idx < stList.length - 1) {
        const tr = sm.transitions.find((t) => t.from === stName && t.to === stList[idx + 1]);
        const ax1 = sx + pillW + 2;
        const ax2 = sx + pillW + gap - 4;
        const ay = stY + pillH / 2;
        smSvg.push(
          `<line x1="${ax1}" y1="${ay}" x2="${ax2}" y2="${ay}" stroke="#c084fc" stroke-width="1.4" marker-end="url(#sysml-arrow-purple)"/>`,
        );
        if (tr?.guard) {
          const shortGuard = tr.guard.replace("altitudeMeters", "alt");
          smSvg.push(
            `<text x="${(ax1 + ax2) / 2}" y="${ay - 6}" text-anchor="middle" fill="#d8b4fe" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">[${escapeXml(shortGuard)}]</text>`,
          );
        }
      }
    });
    curBottomY += bandH + 14;
  }

  const reqSvg: string[] = [];
  if (hasReqs) {
    const rCols = Math.min(3, reqList.length);
    const rGap = 14;
    const rBoxW = Math.floor((width - 64 - (rCols - 1) * rGap) / rCols);
    const rBoxH = 92;
    reqList.forEach((r, idx) => {
      const rRow = Math.floor(idx / 3);
      const rCol = idx % 3;
      const rx = 32 + rCol * (rBoxW + rGap);
      const ry = curBottomY + rRow * (rBoxH + 12);
      const isVerified = r.status === "verified";
      const isSatisfied = r.status === "satisfied" || isVerified;
      const strokeCol = isVerified ? "#10b981" : isSatisfied ? "#3b82f6" : "#f59e0b";
      const badgeFill = isVerified ? "rgba(16, 185, 129, 0.16)" : "rgba(245, 158, 11, 0.16)";
      const badgeTextCol = isVerified ? "#34d399" : "#fbbf24";
      const statusLabel = isVerified ? "✓ VERIFIED" : r.status === "satisfied" ? "SATISFIED" : "DOC ONLY";
      const constraintLine = r.constraintExpr ? formatConstraintMath(r.constraintExpr) : r.text;
      const witnessLine =
        r.witnesses && r.witnesses.length > 0
          ? r.witnesses.map((w) => `${w.actual} (${w.margin})`).join(" · ")
          : r.satisfiedBy
            ? `«satisfy» by ${r.satisfiedBy}`
            : "No formal constraint expression";
      const dispConstraint = constraintLine.length > 44 ? `${constraintLine.slice(0, 43)}…` : constraintLine;
      const dispWitness = witnessLine.length > 44 ? `${witnessLine.slice(0, 43)}…` : witnessLine;

      reqSvg.push(`<g>
        <rect x="${rx}" y="${ry}" width="${rBoxW}" height="${rBoxH}" rx="6" fill="#111927" stroke="${strokeCol}" stroke-width="1.3"/>
        <text x="${rx + 10}" y="${ry + 17}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700">«requirement» ${escapeXml(r.id)}</text>
        <rect x="${rx + rBoxW - 74}" y="${ry + 5}" width="66" height="15" rx="7.5" fill="${badgeFill}" stroke="${strokeCol}" stroke-width="0.8"/>
        <text x="${rx + rBoxW - 41}" y="${ry + 15.5}" text-anchor="middle" fill="${badgeTextCol}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="7.5" font-weight="700">${statusLabel}</text>
        <text x="${rx + 10}" y="${ry + 34}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="700">${escapeXml(r.name.slice(0, 34))}</text>
        <text x="${rx + 10}" y="${ry + 52}" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(dispConstraint)}</text>
        <text x="${rx + 10}" y="${ry + 68}" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(dispWitness)}</text>
        ${r.satisfiedBy ? `<text x="${rx + 10}" y="${ry + 83}" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">«satisfy» by ${escapeXml(r.satisfiedBy)}</text>` : ""}
      </g>`);
    });
  }

  const headerTitle = `ibd [part def] ${rootPartDef || systemName} [${systemName}]`;
  const tabW = Math.min(440, headerTitle.length * 7.2 + 28);

  return sanitizeSvgMarkup(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <defs>
      <marker id="sysml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#34d399"/>
      </marker>
      <marker id="sysml-arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc"/>
      </marker>
    </defs>
    <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
    <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.5"/>
    <polygon points="12,12 ${12 + tabW},12 ${12 + tabW},30 ${12 + tabW - 12},40 12,40" fill="#161f33" stroke="#334155" stroke-width="1.2"/>
    <text x="24" y="30" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700">${escapeXml(headerTitle)}</text>
    ${edgesSvg.join("\n    ")}
    ${nodesSvg.join("\n    ")}
    ${smSvg.join("\n    ")}
    ${reqSvg.join("\n    ")}
  </svg>`,
    { isFullScreen },
  );
}

function buildBddDiagramSvg(
  systemName: string,
  rootPartDef: string,
  parts: SysmlPart[],
  portDefs: SysmlPortDef[],
  isFullScreen = false,
): string {
  const width = 940;
  const rootName = rootPartDef || systemName;
  const rootX = Math.floor(width / 2 - 140);
  const rootY = 52;
  const rootW = 280;
  const rootH = 66;

  const childParts = parts.slice(0, 12);
  const maxCols = 4;
  const nRows = Math.max(1, Math.ceil(childParts.length / maxCols));
  const nColsFirst = Math.min(maxCols, Math.max(1, childParts.length));
  const childW = Math.min(250, Math.floor((width - 72 - (nColsFirst - 1) * 28) / nColsFirst));
  const childH = 120;
  const gap = 28;
  const rowGap = 32;
  const childY = 162;

  const pDefs = portDefs.slice(0, 4);
  const pDefRows = Math.ceil(pDefs.length / 2);
  const portStartY = childY + nRows * childH + (nRows - 1) * rowGap + 24;
  const height = portStartY + (pDefRows > 0 ? pDefRows * 90 + 16 : 16);

  const compLines: string[] = [];
  const childBlocks: string[] = [];

  childParts.forEach((p, idx) => {
    const row = Math.floor(idx / maxCols);
    const col = idx % maxCols;
    const colsInRow = Math.min(maxCols, childParts.length - row * maxCols);
    const startX = Math.floor((width - (colsInRow * childW + (colsInRow - 1) * gap)) / 2);
    const cx = startX + col * (childW + gap);
    const cy = childY + row * (childH + rowGap);
    const midChildX = cx + childW / 2;
    const rootBottomY = rootY + rootH;
    const busY = rootBottomY + 22;

    compLines.push(
      `<polygon points="${rootX + rootW / 2},${rootBottomY} ${rootX + rootW / 2 - 5},${rootBottomY + 7} ${rootX + rootW / 2},${rootBottomY + 14} ${rootX + rootW / 2 + 5},${rootBottomY + 7}" fill="#60a5fa"/>`,
      `<path d="M ${rootX + rootW / 2} ${rootBottomY + 14} L ${rootX + rootW / 2} ${busY} L ${midChildX} ${busY} L ${midChildX} ${cy}" fill="none" stroke="#60a5fa" stroke-width="1.5" opacity="${row === 0 ? "1" : "0.65"}"/>`,
      `<text x="${midChildX + 8}" y="${cy - 6}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="700">${escapeXml(p.multiplicity || "1")}</text>`,
    );

    const attrs = (p.attributes || []).slice(0, 2);
    const ports = (p.ports || []).slice(0, 2);

    childBlocks.push(`<g>
      <rect x="${cx}" y="${cy}" width="${childW}" height="${childH}" rx="6" fill="#161f33" stroke="#3b82f6" stroke-width="1.5"/>
      <rect x="${cx}" y="${cy}" width="${childW}" height="38" rx="6" fill="rgba(59, 130, 246, 0.14)"/>
      <line x1="${cx}" y1="${cy + 38}" x2="${cx + childW}" y2="${cy + 38}" stroke="#3b82f6" stroke-width="1"/>
      <text x="${cx + childW / 2}" y="${cy + 14}" text-anchor="middle" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="600">«part def»</text>
      <text x="${cx + childW / 2}" y="${cy + 30}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700">${escapeXml(p.type)}</text>
      ${attrs.map((a, i) => `<text x="${cx + 10}" y="${cy + 54 + i * 14}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9">${escapeXml(a.length > 32 ? `${a.slice(0, 31)}…` : a)}</text>`).join("\n      ")}
      <line x1="${cx}" y1="${cy + 82}" x2="${cx + childW}" y2="${cy + 82}" stroke="#1e293b" stroke-width="1"/>
      ${ports.map((pt, i) => `<text x="${cx + 10}" y="${cy + 96 + i * 13}" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(pt.length > 34 ? `${pt.slice(0, 33)}…` : pt)}</text>`).join("\n      ")}
    </g>`);
  });

  const portCards: string[] = [];
  pDefs.forEach((pd, idx) => {
    const pw = 390;
    const ph = 78;
    const pCol = idx % 2;
    const pRow = Math.floor(idx / 2);
    const px = 64 + pCol * 420;
    const py = portStartY + pRow * 90;
    portCards.push(`<g>
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="6" fill="#0f1b29" stroke="#10b981" stroke-width="1.3"/>
      <line x1="${px}" y1="${py + 28}" x2="${px + pw}" y2="${py + 28}" stroke="#10b981" stroke-width="0.9"/>
      <text x="${px + 12}" y="${py + 18}" fill="#34d399" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«port def» ${escapeXml(pd.name)}</text>
      ${pd.attributes
        .slice(0, 3)
        .map(
          (a, i) =>
            `<text x="${px + 12}" y="${py + 43 + i * 13}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(a.slice(0, 48))}</text>`,
        )
        .join("\n      ")}
    </g>`);
  });

  const headerTitle = `bdd [package] ${systemName} (Structural Type Taxonomy)`;
  const tabW = Math.min(460, headerTitle.length * 7.2 + 28);

  return sanitizeSvgMarkup(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
    <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.5"/>
    <polygon points="12,12 ${12 + tabW},12 ${12 + tabW},30 ${12 + tabW - 12},40 12,40" fill="#161f33" stroke="#334155" stroke-width="1.2"/>
    <text x="24" y="30" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700">${escapeXml(headerTitle)}</text>
    <g>
      <rect x="${rootX}" y="${rootY}" width="${rootW}" height="${rootH}" rx="6" fill="#1e293b" stroke="#60a5fa" stroke-width="1.8"/>
      <text x="${rootX + rootW / 2}" y="${rootY + 22}" text-anchor="middle" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">«system part def»</text>
      <text x="${rootX + rootW / 2}" y="${rootY + 44}" text-anchor="middle" fill="#ffffff" font-family="ui-monospace, SFMono-Regular, monospace" font-size="13" font-weight="700">${escapeXml(rootName)}</text>
    </g>
    ${compLines.join("\n    ")}
    ${childBlocks.join("\n    ")}
    ${portCards.join("\n    ")}
  </svg>`,
    { isFullScreen },
  );
}

const SysmlViewer: React.FC<SysmlViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"diagram" | "architecture" | "requirements" | "source">("diagram");
  const [diagramMode, setDiagramMode] = useState<"ibd" | "bdd">("ibd");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);

  const inlineCode = (viewConfig.code as string) || (viewConfig.source as string) || "";
  useEffect(() => {
    if (!inlineCode && typeof viewConfig.url === "string") {
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedCode(txt);
        })
        .catch(() => {});
    }
  }, [inlineCode, viewConfig.url]);

  const sourceCode = inlineCode || fetchedCode || "";
  const format = viewConfig.format || "SysML2";
  const parsedModel = useMemo(() => parseSysmlSource(sourceCode), [sourceCode]);

  const systemName =
    viewConfig.systemName || parsedModel.packageName || (viewConfig.title as string) || "System Architecture";
  const rootPartDef = (viewConfig.rootPartDef as string) || parsedModel.rootPartDef || systemName;

  // Merge parts from viewConfig and parsedModel so attributes and ports are always populated
  const parts: SysmlPart[] = useMemo(() => {
    if (Array.isArray(viewConfig.parts) && viewConfig.parts.length > 0) {
      return viewConfig.parts.map((vp) => {
        const parsedMatch = parsedModel.parts.find((pp) => pp.name === vp.name || pp.type === vp.type);
        return {
          ...parsedMatch,
          ...vp,
          ports: vp.ports && vp.ports.length > 0 ? vp.ports : parsedMatch?.ports || [],
          attributes: vp.attributes && vp.attributes.length > 0 ? vp.attributes : parsedMatch?.attributes || [],
          description: vp.description || parsedMatch?.description,
        };
      });
    }
    return parsedModel.parts;
  }, [viewConfig.parts, parsedModel.parts]);

  // Merge requirements with parsed constraints & witnesses; prevent fake "Satisfied" when no constraints or satisfy links exist
  const requirements: SysmlRequirement[] = useMemo(() => {
    if (Array.isArray(viewConfig.requirements) && viewConfig.requirements.length > 0) {
      return viewConfig.requirements.map((vr) => {
        const parsedMatch = parsedModel.requirements.find((pr) => pr.name === vr.name || pr.id === vr.id);
        const constraintExpr = vr.constraintExpr || parsedMatch?.constraintExpr;
        const witnesses = vr.witnesses && vr.witnesses.length > 0 ? vr.witnesses : parsedMatch?.witnesses;
        const satisfiedBy = vr.satisfiedBy || parsedMatch?.satisfiedBy;
        const subject = vr.subject || parsedMatch?.subject;

        // Honest verification status: require actual constraint or satisfy link if source code was parsed
        let status = vr.status;
        if (parsedMatch) {
          if (witnesses && witnesses.length > 0) {
            status = witnesses.every((w) => w.passed) ? "verified" : "violated";
          } else if (constraintExpr) {
            status = "verified";
          } else if (satisfiedBy) {
            status = "satisfied";
          } else {
            status = "unverified";
          }
        }

        return {
          ...vr,
          text: parsedMatch?.text || vr.text,
          status,
          ...(subject ? { subject } : {}),
          ...(satisfiedBy ? { satisfiedBy } : {}),
          ...(constraintExpr ? { constraintExpr } : {}),
          ...(witnesses && witnesses.length > 0 ? { witnesses } : {}),
        };
      });
    }
    return parsedModel.requirements;
  }, [viewConfig.requirements, parsedModel.requirements]);

  const connections: SysmlConnection[] = useMemo(() => {
    if (Array.isArray(viewConfig.connections) && viewConfig.connections.length > 0) {
      return viewConfig.connections;
    }
    return parsedModel.connections;
  }, [viewConfig.connections, parsedModel.connections]);

  const states: SysmlStateMachine[] = useMemo(() => {
    if (Array.isArray(viewConfig.states) && viewConfig.states.length > 0) {
      return viewConfig.states;
    }
    return parsedModel.states;
  }, [viewConfig.states, parsedModel.states]);

  const svgMarkup = useMemo(() => {
    if (parts.length > 0) {
      if (diagramMode === "bdd") {
        return buildBddDiagramSvg(systemName, rootPartDef, parts, parsedModel.portDefs, isFullScreen);
      }
      return buildIbdDiagramSvg(systemName, rootPartDef, parts, connections, states, requirements, isFullScreen);
    }
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    return "";
  }, [
    diagramMode,
    systemName,
    rootPartDef,
    parts,
    connections,
    states,
    requirements,
    parsedModel.portDefs,
    viewConfig.svg,
    isFullScreen,
  ]);

  const effectiveTab =
    activeTab === "diagram" && !svgMarkup
      ? parts.length > 0
        ? "architecture"
        : requirements.length > 0
          ? "requirements"
          : "source"
      : activeTab;

  const verifiedWithConstraintsCount = requirements.filter(
    (r) => (r.status === "verified" || r.status === "satisfied") && Boolean(r.constraintExpr || r.satisfiedBy),
  ).length;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sourceCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "sysml2" as any,
      code: sourceCode || `package ${systemName.replace(/\W+/g, "_")} {\n}\n`,
      title: systemName,
    });
    const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    navigate(`/playground${fromArtifact}#m=${hash}`);
  };

  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return parts;
    const q = searchQuery.toLowerCase();
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [parts, searchQuery]);

  const codeLines = useMemo(() => (sourceCode ? sourceCode.split(/\r?\n/) : []), [sourceCode]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      {!isFullScreen && (
        <Toolbar>
          <HeaderLeft>
            <CpuIcon size={15} fill="var(--color-accent-blue, #60a5fa)" />
            <SystemTitle title={systemName}>{systemName}</SystemTitle>
            <Badge $variant={format === "KerML" ? "kerml" : "sysml"}>{format}</Badge>
            {requirements.length > 0 && (
              <Badge
                $variant={
                  verifiedWithConstraintsCount === requirements.length && verifiedWithConstraintsCount > 0
                    ? "req-pass"
                    : "req-warn"
                }
                title={
                  verifiedWithConstraintsCount > 0
                    ? "Formal SysML v2 'require constraint' inequalities & 'satisfy by' links verified against model parameters"
                    : "Requirements declared as prose doc blocks without formal constraint equations"
                }
              >
                <ShieldCheckIcon size={12} />{" "}
                {verifiedWithConstraintsCount > 0
                  ? `${verifiedWithConstraintsCount}/${requirements.length} Constraints Verified`
                  : `${requirements.length} Reqs (Doc Only)`}
              </Badge>
            )}
          </HeaderLeft>

          <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
            {sourceCode && (
              <Button size="small" onClick={handleCopyCode} title="Copy SysML v2 source">
                {copiedCode ? <CheckIcon size={13} fill="var(--color-accent-cyan)" /> : <CopyIcon size={13} />}
                <Text style={{ fontSize: "11px", marginLeft: "4px" }}>{copiedCode ? "Copied" : "Copy"}</Text>
              </Button>
            )}
            {Boolean(viewConfig?.standalone) && (
              <Button
                size="small"
                variant="primary"
                onClick={handleOpenPlayground}
                title="Open SysML v2 model in Playground"
              >
                <CodeIcon size={13} />
                <Text style={{ fontSize: "11px", marginLeft: "4px" }}>Open in Playground</Text>
              </Button>
            )}
          </Box>
        </Toolbar>
      )}

      <TabNav>
        <TabGroup>
          {svgMarkup && (
            <TabButton $active={effectiveTab === "diagram"} onClick={() => setActiveTab("diagram")}>
              <WorkflowIcon size={13} />
              <span>Diagram</span>
            </TabButton>
          )}
          <TabButton $active={effectiveTab === "architecture"} onClick={() => setActiveTab("architecture")}>
            <span>Architecture</span>
            <TabCount $active={effectiveTab === "architecture"}>{parts.length}</TabCount>
          </TabButton>
          <TabButton $active={effectiveTab === "requirements"} onClick={() => setActiveTab("requirements")}>
            <span>Requirements &amp; Constraints</span>
            <TabCount $active={effectiveTab === "requirements"}>{requirements.length}</TabCount>
          </TabButton>
          <TabButton $active={effectiveTab === "source"} onClick={() => setActiveTab("source")}>
            <CodeIcon size={13} />
            <span>SysML v2 Source</span>
          </TabButton>
        </TabGroup>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          {effectiveTab === "diagram" && parts.length > 0 && (
            <SubViewSwitch>
              <SubViewButton $active={diagramMode === "ibd"} onClick={() => setDiagramMode("ibd")}>
                IBD (Internal Flow)
              </SubViewButton>
              <SubViewButton $active={diagramMode === "bdd"} onClick={() => setDiagramMode("bdd")}>
                BDD (Hierarchy)
              </SubViewButton>
            </SubViewSwitch>
          )}
          {isFullScreen && requirements.length > 0 && (
            <Badge
              $variant={
                verifiedWithConstraintsCount === requirements.length && verifiedWithConstraintsCount > 0
                  ? "req-pass"
                  : "req-warn"
              }
            >
              <ShieldCheckIcon size={12} />{" "}
              {verifiedWithConstraintsCount > 0
                ? `${verifiedWithConstraintsCount}/${requirements.length} Constraints Verified`
                : `${requirements.length} Reqs (Doc Only)`}
            </Badge>
          )}
          {isFullScreen && sourceCode && (
            <Button size="small" onClick={handleCopyCode} title="Copy SysML v2 source">
              {copiedCode ? <CheckIcon size={13} fill="var(--color-accent-cyan)" /> : <CopyIcon size={13} />}
              <Text style={{ fontSize: "11px", marginLeft: "4px" }}>{copiedCode ? "Copied" : "Copy"}</Text>
            </Button>
          )}
        </Box>
      </TabNav>

      <ContentBody $noPadding={effectiveTab === "diagram"}>
        {effectiveTab === "diagram" && svgMarkup && (
          <DiagramStage>
            <DiagramHudBar>
              <Text style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "var(--font-mono, monospace)" }}>
                {diagramMode === "ibd"
                  ? `ibd [part def] ${rootPartDef} — ${parts.length} parts · ${connections.length} port flows${states.length > 0 ? ` · ${states[0]!.states.length} modal states` : ""}`
                  : `bdd [package] ${systemName} — ${parts.length} part definitions · ${parsedModel.portDefs.length} port interfaces`}
              </Text>
              <Text style={{ fontSize: "10.5px", color: "#6ee7b7", fontFamily: "var(--font-mono, monospace)" }}>
                {verifiedWithConstraintsCount > 0
                  ? `✓ ${verifiedWithConstraintsCount}/${requirements.length} formal constraints satisfied`
                  : ""}
              </Text>
            </DiagramHudBar>
            <InteractiveSvgStage
              svgMarkup={svgMarkup}
              isFullScreen={isFullScreen}
              minHeight={isFullScreen ? "calc(100% - 32px)" : "300px"}
              background="transparent"
            />
          </DiagramStage>
        )}

        {effectiveTab === "architecture" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Composition breakdown (`part`), physical attributes &amp; conjugated port bindings
              </Text>
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search parts or ports..."
                size="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "210px" }}
              />
            </Box>

            <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} gap={2}>
              {filteredParts.map((p) => (
                <TreeCard key={p.name}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap={1}>
                      <DotFillIcon size={12} fill="var(--color-accent-blue, #60a5fa)" />
                      <Text style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {p.name}
                      </Text>
                      {p.multiplicity && (
                        <Text
                          style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
                        >
                          [{p.multiplicity}]
                        </Text>
                      )}
                    </Box>
                    <Badge $variant="sysml">{p.type}</Badge>
                  </Box>

                  {p.description && (
                    <Text style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>{p.description}</Text>
                  )}

                  {p.attributes && p.attributes.length > 0 && (
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                      <Text style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>Attrs:</Text>
                      {p.attributes.map((attr) => (
                        <span
                          key={attr}
                          style={{
                            fontSize: "10.5px",
                            fontFamily: "var(--font-mono, monospace)",
                            background: "rgba(59, 130, 246, 0.08)",
                            color: "#93c5fd",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            border: "1px solid rgba(59, 130, 246, 0.2)",
                          }}
                        >
                          {attr}
                        </span>
                      ))}
                    </Box>
                  )}

                  {p.ports && p.ports.length > 0 && (
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                      <Text style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>Ports:</Text>
                      {p.ports.map((port) => (
                        <span
                          key={port}
                          style={{
                            fontSize: "10.5px",
                            fontFamily: "var(--font-mono, monospace)",
                            background: "rgba(16, 185, 129, 0.08)",
                            color: "#6ee7b7",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            border: "1px solid rgba(16, 185, 129, 0.22)",
                          }}
                        >
                          {port}
                        </span>
                      ))}
                    </Box>
                  )}
                </TreeCard>
              ))}
            </Box>

            {connections.length > 0 && (
              <Box mt={2}>
                <Heading as="h5" style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "6px" }}>
                  Internal Port Flow Connections ({connections.length})
                </Heading>
                <Box
                  p={2}
                  bg="rgba(0, 0, 0, 0.2)"
                  borderRadius="6px"
                  border="1px solid var(--color-border-default)"
                  display="flex"
                  flexDirection="column"
                  gap={1}
                >
                  {connections.map((c, idx) => (
                    <Box
                      key={idx}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      py={1}
                      px={1}
                      style={{
                        fontSize: "11.5px",
                        fontFamily: "var(--font-mono, monospace)",
                        borderBottom: idx < connections.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                      }}
                    >
                      <Box display="flex" alignItems="center" gap={1}>
                        <span style={{ color: "#60a5fa" }}>{c.source}</span>
                        <span style={{ color: "var(--color-text-muted)" }}>&rarr;</span>
                        <span style={{ color: "#34d399" }}>{c.target}</span>
                      </Box>
                      {c.flowType && <Badge $variant="sysml">«flow» {c.flowType}</Badge>}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {effectiveTab === "requirements" && (
          <Box display="flex" flexDirection="column" gap={2}>
            {requirements.length > 0 ? (
              requirements.map((req) => {
                const isVerified = req.status === "verified" && Boolean(req.constraintExpr || req.satisfiedBy);
                const isSatisfied = req.status === "satisfied" && Boolean(req.satisfiedBy || req.constraintExpr);
                const passesCheck = isVerified || isSatisfied;
                return (
                  <Box
                    key={req.id}
                    p={2}
                    bg="var(--color-canvas-subtle, #161b22)"
                    border="1px solid var(--color-border-default, #30363d)"
                    borderRadius="6px"
                    display="flex"
                    flexDirection="column"
                    gap={1}
                  >
                    <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                      <Box display="flex" alignItems="center" gap={2}>
                        {passesCheck ? (
                          <CheckCircleFillIcon size={15} fill="#34d399" />
                        ) : req.status === "violated" ? (
                          <XCircleFillIcon size={15} fill="#f87171" />
                        ) : (
                          <DotFillIcon size={15} fill="#fbbf24" />
                        )}
                        <Text style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                          {req.id}: {req.name}
                        </Text>
                      </Box>

                      <Box display="flex" alignItems="center" gap={1}>
                        {req.subject && <Badge>subject {req.subject}</Badge>}
                        {req.satisfiedBy && <Badge $variant="sysml">«satisfy» by {req.satisfiedBy}</Badge>}
                        <Badge $variant={passesCheck ? "req-pass" : "req-warn"}>
                          {isVerified
                            ? "CONSTRAINT VERIFIED"
                            : isSatisfied
                              ? "SATISFIED"
                              : req.status === "violated"
                                ? "VIOLATED"
                                : "DOC ONLY (UNVERIFIED)"}
                        </Badge>
                      </Box>
                    </Box>

                    <Text style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", paddingLeft: "22px" }}>
                      {req.text}
                    </Text>

                    {req.constraintExpr ? (
                      <Box
                        mt={1}
                        ml="22px"
                        p={2}
                        style={{
                          background: "rgba(15, 23, 42, 0.7)",
                          border: "1px solid rgba(16, 185, 129, 0.28)",
                          borderRadius: "6px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono, monospace)",
                            color: "#6ee7b7",
                            marginBottom: req.witnesses && req.witnesses.length > 0 ? "6px" : "0",
                          }}
                        >
                          <span style={{ color: "#93c5fd", fontWeight: 600 }}>require constraint</span> {"{ "}
                          {formatConstraintMath(req.constraintExpr)}
                          {" }"}
                        </div>

                        {req.witnesses && req.witnesses.length > 0 && (
                          <Box display="flex" flexWrap="wrap" gap={1}>
                            {req.witnesses.map((w, wIdx) => (
                              <span
                                key={wIdx}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  fontSize: "10.5px",
                                  fontFamily: "var(--font-mono, monospace)",
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  background: w.passed ? "rgba(16, 185, 129, 0.12)" : "rgba(248, 113, 113, 0.15)",
                                  border: w.passed
                                    ? "1px solid rgba(16, 185, 129, 0.3)"
                                    : "1px solid rgba(248, 113, 113, 0.35)",
                                  color: w.passed ? "#d1fae5" : "#fecaca",
                                }}
                              >
                                <span style={{ color: w.passed ? "#34d399" : "#f87171", fontWeight: 700 }}>
                                  {w.passed ? "✓" : "✗"}
                                </span>
                                <span>{formatConstraintMath(w.expr)}:</span>
                                <strong>{w.actual}</strong>
                                <span style={{ color: "#6ee7b7", opacity: 0.85 }}>({w.margin})</span>
                              </span>
                            ))}
                          </Box>
                        )}
                      </Box>
                    ) : (
                      <Box
                        mt={1}
                        ml="22px"
                        px={2}
                        py={1}
                        style={{
                          background: "rgba(245, 158, 11, 0.08)",
                          border: "1px dashed rgba(245, 158, 11, 0.3)",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "var(--font-mono, monospace)",
                          color: "#fbbf24",
                        }}
                      >
                        No formal `require constraint {"{ ... }"}` inequality declared in this requirement block.
                      </Box>
                    )}
                  </Box>
                );
              })
            ) : (
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                No requirement definitions found in this SysML v2 model.
              </Text>
            )}
          </Box>
        )}

        {effectiveTab === "source" && (
          <CodeEditor>
            {codeLines.length > 0 ? (
              codeLines.map((line, i) => (
                <div key={i} style={{ display: "flex" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "34px",
                      minWidth: "34px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-text-muted)",
                      fontSize: "11px",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>{highlightPolyglotLine(line, "sysml")}</span>
                </div>
              ))
            ) : (
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>No SysML v2 source available.</Text>
            )}
          </CodeEditor>
        )}
      </ContentBody>
    </CardWrapper>
  );
};

export default SysmlViewer;
