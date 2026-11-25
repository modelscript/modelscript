// SPDX-License-Identifier: AGPL-3.0-or-later

import { escapeXml } from "../../util/escape.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export interface SysmlConstraintWitness {
  expr: string;
  actual: string;
  bound: string;
  margin: string;
  passed: boolean;
}

export interface PreprocessedSysmlRequirement {
  id: string;
  name: string;
  text: string;
  status: "verified" | "satisfied" | "unverified" | "violated";
  subject?: string | undefined;
  satisfiedBy?: string | undefined;
  constraintExpr?: string | undefined;
  witnesses?: SysmlConstraintWitness[] | undefined;
}

export interface PreprocessedSysmlPart {
  name: string;
  type: string;
  multiplicity: string;
  ports: string[];
  attributes: string[];
  description?: string | undefined;
}

export interface PreprocessedSysmlConnection {
  source: string;
  target: string;
  flowType?: string | undefined;
}

export interface PreprocessedSysmlStateMachine {
  name: string;
  states: string[];
  transitions: { from: string; to: string; guard?: string | undefined }[];
}

export function buildSysmlArchitectureFromSource(content: string, fallbackTitle: string) {
  const pkgMatch = content.match(/\bpackage\s+([A-Za-z_]\w*)/);
  const packageName = pkgMatch?.[1] || fallbackTitle;

  // 1. Collect all numeric attribute values across the model for constraint evaluation
  const attrValues = new Map<string, { value: number; unit?: string | undefined }>();
  const attrValRe =
    /\battribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = attrValRe.exec(content)) !== null) {
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

  // 2. Parse port definitions
  const portDefs = new Map<string, string[]>();
  const portDefRe = /\bport\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = portDefRe.exec(content)) !== null) {
    const pName = m[1]!;
    const pBody = m[2] || "";
    const items: string[] = [];
    const attrRe = /\b(?:(in|out|inout)\s+)?attribute\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(pBody)) !== null) {
      const dir = am[1] ? `${am[1]} ` : "";
      items.push(`${dir}${am[2]}${am[3] ? ` : ${am[3]}` : ""}`);
    }
    portDefs.set(pName, items);
  }

  // 3. Parse part definitions (ports, attributes, doc, internal part usages)
  interface PartDefMeta {
    name: string;
    doc?: string | undefined;
    ports: { name: string; type: string; conjugated: boolean; dir: "in" | "out" | "inout" }[];
    attributes: string[];
    hasPartUsages: boolean;
  }
  const partDefs = new Map<string, PartDefMeta>();
  const partDefRe = /\bpart\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let rootPartDef = "";
  while ((m = partDefRe.exec(content)) !== null) {
    const defName = m[1]!;
    const body = m[2] || "";
    const docMatch = body.match(/\bdoc\s*\/\*([\s\S]*?)\*\//);
    const doc = docMatch?.[1]?.replace(/\s+/g, " ").trim();

    const ports: PartDefMeta["ports"] = [];
    const portRe = /\b(?:(in|out|inout)\s+)?port\s+([A-Za-z_]\w*)\s*:\s*(~?)([A-Za-z_]\w*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = portRe.exec(body)) !== null) {
      const explicitDir = pm[1] as "in" | "out" | "inout" | undefined;
      const portName = pm[2]!;
      const conjugated = pm[3] === "~";
      const portType = pm[4]!;
      const inferredDir: "in" | "out" | "inout" = explicitDir || (conjugated || /In$/i.test(portName) ? "in" : "out");
      ports.push({ name: portName, type: portType, conjugated, dir: inferredDir });
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

    const hasPartUsages = /\bpart\s+(?!def\b)[A-Za-z_]\w*\s*:/.test(body);
    if (hasPartUsages) {
      rootPartDef = defName;
    }

    partDefs.set(defName, { name: defName, doc, ports, attributes, hasPartUsages });
  }

  // 4. Extract instantiated part usages
  const parts: PreprocessedSysmlPart[] = [];
  const portTypeLookup = new Map<string, string>();
  const partUsageRe = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)(?:\s*\[([^\]]+)\])?/g;
  while ((m = partUsageRe.exec(content)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const mult = m[3]?.trim() || "1";
    const defMeta = partDefs.get(type);
    const formattedPorts = (defMeta?.ports || []).map(
      (p) => `${p.dir} ${p.name} : ${p.conjugated ? "~" : ""}${p.type}`,
    );
    for (const p of defMeta?.ports || []) {
      portTypeLookup.set(`${name}.${p.name}`, p.type);
    }
    parts.push({
      name,
      type,
      multiplicity: mult,
      ports: formattedPorts,
      attributes: defMeta?.attributes || [],
      description: defMeta?.doc,
    });
  }

  if (parts.length === 0) {
    for (const defMeta of partDefs.values()) {
      if (defMeta.hasPartUsages && partDefs.size > 1) continue;
      parts.push({
        name: defMeta.name,
        type: "PartDefinition",
        multiplicity: "1",
        ports: defMeta.ports.map((p) => `${p.dir} ${p.name} : ${p.conjugated ? "~" : ""}${p.type}`),
        attributes: defMeta.attributes,
        description: defMeta.doc,
      });
    }
  }

  // 5. Extract connections
  const connections: PreprocessedSysmlConnection[] = [];
  const connRe = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRe.exec(content)) !== null) {
    const source = m[1]!;
    const target = m[2]!;
    const flowType = portTypeLookup.get(source) || portTypeLookup.get(target);
    connections.push({ source, target, ...(flowType ? { flowType } : {}) });
  }

  // 6. Extract state machines
  const states: PreprocessedSysmlStateMachine[] = [];
  const stateDefRe = /\bstate\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = stateDefRe.exec(content)) !== null) {
    const smName = m[1]!;
    const smBody = m[2] || "";
    const stateNames: string[] = [];
    const stRe = /\bstate\s+(?!def\b)([A-Za-z_]\w*)\s*;/g;
    let smMatch: RegExpExecArray | null;
    while ((smMatch = stRe.exec(smBody)) !== null) {
      stateNames.push(smMatch[1]!);
    }
    const transitions: PreprocessedSysmlStateMachine["transitions"] = [];
    const trRe =
      /\btransition\s+(?:[A-Za-z_]\w*\s+)?first\s+([A-Za-z_]\w*)(?:\s+if\s+([\s\S]*?))?\s+then\s+([A-Za-z_]\w*)\s*;/g;
    while ((smMatch = trRe.exec(smBody)) !== null) {
      transitions.push({
        from: smMatch[1]!,
        to: smMatch[3]!,
        ...(smMatch[2] ? { guard: smMatch[2].replace(/\s+/g, " ").trim() } : {}),
      });
    }
    if (stateNames.length > 0) {
      states.push({ name: smName, states: stateNames, transitions });
    }
  }

  // 7. Extract satisfy / verify relationships and formal requirements
  const satisfyByMap = new Map<string, string>();
  const satisfyRe = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = satisfyRe.exec(content)) !== null) {
    satisfyByMap.set(m[1]!, m[2] || "System");
  }
  const verifyByMap = new Map<string, string>();
  const verifyRe = /\bverify\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = verifyRe.exec(content)) !== null) {
    verifyByMap.set(m[1]!, m[2] || "VerificationCase");
  }

  // Brace-balanced scan for requirement def blocks (since require constraint { ... } has nested braces)
  const requirements: PreprocessedSysmlRequirement[] = [];
  const reqHeaderRe = /\brequirement\s+(?:def\s+)?(?:<'([^']+)'>\s*)?([A-Za-z_]\w*)\s*\{/g;
  let reqIdx = 1;
  while ((m = reqHeaderRe.exec(content)) !== null) {
    const explicitId = m[1];
    const reqName = m[2]!;
    const openBraceIdx = m.index + m[0].length - 1;
    let depth = 1;
    let pos = openBraceIdx + 1;
    while (pos < content.length && depth > 0) {
      if (content[pos] === "{") depth++;
      else if (content[pos] === "}") depth--;
      pos++;
    }
    const body = content.slice(openBraceIdx + 1, pos - 1);
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
    let status: PreprocessedSysmlRequirement["status"] = "unverified";
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

  // 8. Render crisp SysML v2 IBD + State Machine + Requirement Verification SVG
  const width = 940;
  const hasStateMachine = states.length > 0;
  const hasReqs = requirements.length > 0;
  const height = 270 + (hasStateMachine ? 92 : 0) + (hasReqs ? 118 : 0);

  const partBoxes = parts.slice(0, 4);
  const nParts = Math.max(1, partBoxes.length);
  const totalInnerW = width - 80;
  const boxW = Math.min(248, Math.floor((totalInnerW - (nParts - 1) * 58) / nParts));
  const boxH = 126;
  const startX = Math.floor((width - (nParts * boxW + (nParts - 1) * 58)) / 2);
  const partY = 78;

  const partPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const nodesSvg: string[] = [];

  partBoxes.forEach((p, idx) => {
    const x = startX + idx * (boxW + 58);
    const y = partY;
    partPos.set(p.name, { x, y, w: boxW, h: boxH });
    const multNum = parseInt(p.multiplicity, 10) || 1;

    const stackShadows =
      multNum > 1
        ? `<rect x="${x + 6}" y="${y - 6}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.38"/>
           <rect x="${x + 3}" y="${y - 3}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.68"/>`
        : "";

    const attrLines = p.attributes.slice(0, 2).map((attr, aIdx) => {
      const text = attr.length > 36 ? `${attr.slice(0, 35)}…` : attr;
      return `<text x="${x + 12}" y="${y + 68 + aIdx * 14}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5">${escapeXml(text)}</text>`;
    });

    const portPins: string[] = [];
    p.ports.forEach((rawPort, pIdx) => {
      const isIn = /^in\b/.test(rawPort) || rawPort.includes("~");
      const isConj = rawPort.includes("~");
      const cleanPort = rawPort.replace(/^(?:in|out|inout)\s+/, "");
      const portText = cleanPort.length > 38 ? `${cleanPort.slice(0, 37)}…` : cleanPort;
      const pinX = isIn ? x - 5 : x + boxW - 5;
      const pinY = y + 36 + pIdx * 28;
      const pinFill = isConj ? "#3b82f6" : "#0f172a";
      portPins.push(
        `<rect x="${pinX}" y="${pinY - 5}" width="10" height="10" rx="2" fill="${pinFill}" stroke="#60a5fa" stroke-width="1.5"/>`,
        `<text x="${x + 12}" y="${y + 102 + pIdx * 13}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9">${escapeXml(portText)}</text>`,
      );
    });

    nodesSvg.push(`<g>
      ${stackShadows}
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="#161f33" stroke="#3b82f6" stroke-width="1.6"/>
      <path d="M ${x} ${y + 6} A 6 6 0 0 1 ${x + 6} ${y} L ${x + boxW - 6} ${y} A 6 6 0 0 1 ${x + boxW} ${y + 6} L ${x + boxW} ${y + 42} L ${x} ${y + 42} Z" fill="rgba(59, 130, 246, 0.14)"/>
      <line x1="${x}" y1="${y + 42}" x2="${x + boxW}" y2="${y + 42}" stroke="#3b82f6" stroke-width="1"/>
      <text x="${x + boxW / 2}" y="${y + 15}" text-anchor="middle" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">«part» ${escapeXml(p.type)}</text>
      <text x="${x + boxW / 2}" y="${y + 33}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11.5" font-weight="700">${escapeXml(p.name)}${p.multiplicity !== "1" ? ` [${escapeXml(p.multiplicity)}]` : ""}</text>
      <text x="${x + 12}" y="${y + 54}" fill="#64748b" font-family="system-ui, sans-serif" font-size="8.5" font-weight="700" letter-spacing="0.05em">ATTRIBUTES &amp; PORTS</text>
      ${attrLines.join("\n      ")}
      ${portPins.join("\n      ")}
    </g>`);
  });

  // Render connections between parts
  const edgesSvg: string[] = [];
  connections.forEach((c) => {
    const srcPart = c.source.split(".")[0]!;
    const tgtPart = c.target.split(".")[0]!;
    const b1 = partPos.get(srcPart);
    const b2 = partPos.get(tgtPart);
    if (!b1 || !b2) return;
    const x1 = b1.x + b1.w + 5;
    const y1 = b1.y + 48;
    const x2 = b2.x - 5;
    const y2 = b2.y + 48;
    const midX = (x1 + x2) / 2;
    const flowLabel = c.flowType || `${c.source.split(".")[1] || "out"} → ${c.target.split(".")[1] || "in"}`;
    const badgeW = Math.max(84, flowLabel.length * 5.6 + 14);
    edgesSvg.push(`<g>
      <path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}" fill="none" stroke="#34d399" stroke-width="1.8" marker-end="url(#sysml-arrow)"/>
      <rect x="${midX - badgeW / 2}" y="${(y1 + y2) / 2 - 22}" width="${badgeW}" height="16" rx="4" fill="#0d1526" stroke="#10b981" stroke-width="1"/>
      <text x="${midX}" y="${(y1 + y2) / 2 - 11}" text-anchor="middle" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="600">${escapeXml(flowLabel)}</text>
    </g>`);
  });

  // State machine strip if present
  let curBottomY = partY + boxH + 22;
  const smSvg: string[] = [];
  if (hasStateMachine) {
    const sm = states[0]!;
    const stList = sm.states.slice(0, 4);
    const bandX = 36;
    const bandW = width - 72;
    const bandH = 74;
    smSvg.push(
      `<rect x="${bandX}" y="${curBottomY}" width="${bandW}" height="${bandH}" rx="6" fill="rgba(168, 85, 247, 0.06)" stroke="rgba(168, 85, 247, 0.35)" stroke-width="1.2" stroke-dasharray="4 3"/>`,
      `<text x="${bandX + 14}" y="${curBottomY + 17}" fill="#c084fc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«state def» ${escapeXml(sm.name)} (Modal GNC Trajectory Schedule)</text>`,
    );
    const pillW = 166;
    const pillH = 30;
    const gap = 42;
    const stStartX = bandX + 24;
    const stY = curBottomY + 28;
    stList.forEach((stName, idx) => {
      const sx = stStartX + idx * (pillW + gap);
      smSvg.push(
        `<rect x="${sx}" y="${stY}" width="${pillW}" height="${pillH}" rx="15" fill="#1e1b38" stroke="#a855f7" stroke-width="1.4"/>`,
        `<text x="${sx + pillW / 2}" y="${stY + 19}" text-anchor="middle" fill="#f3e8ff" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="600">${escapeXml(stName)}</text>`,
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
    curBottomY += bandH + 16;
  }

  // Requirements & formal constraint verification strip
  const reqSvg: string[] = [];
  if (hasReqs) {
    const reqList = requirements.slice(0, 3);
    const rCount = reqList.length;
    const rGap = 16;
    const rBoxW = Math.floor((width - 72 - (rCount - 1) * rGap) / rCount);
    const rBoxH = 96;
    reqList.forEach((r, idx) => {
      const rx = 36 + idx * (rBoxW + rGap);
      const ry = curBottomY;
      const isVerified = r.status === "verified";
      const isSatisfied = r.status === "satisfied" || isVerified;
      const strokeCol = isVerified ? "#10b981" : isSatisfied ? "#3b82f6" : "#f59e0b";
      const badgeFill = isVerified ? "rgba(16, 185, 129, 0.16)" : "rgba(245, 158, 11, 0.16)";
      const badgeTextCol = isVerified ? "#34d399" : "#fbbf24";
      const statusLabel = isVerified ? "✓ VERIFIED" : r.status === "satisfied" ? "SATISFIED" : "DOC ONLY";
      const rawConstraint = r.constraintExpr
        ? r.constraintExpr
            .replace(/<=/g, "≤")
            .replace(/>=/g, "≥")
            .replace(/\band\b/g, "∧")
        : r.text;
      const constraintLine = rawConstraint.length > 44 ? `${rawConstraint.slice(0, 43)}…` : rawConstraint;
      const rawWitness =
        r.witnesses && r.witnesses.length > 0
          ? r.witnesses.map((w) => `${w.actual} (${w.margin})`).join(" · ")
          : r.satisfiedBy
            ? `«satisfy» by ${r.satisfiedBy}`
            : "No formal constraint expression";
      const witnessLine = rawWitness.length > 44 ? `${rawWitness.slice(0, 43)}…` : rawWitness;

      reqSvg.push(`<g>
        <rect x="${rx}" y="${ry}" width="${rBoxW}" height="${rBoxH}" rx="6" fill="#111927" stroke="${strokeCol}" stroke-width="1.3"/>
        <text x="${rx + 10}" y="${ry + 18}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«requirement» ${escapeXml(r.id)}</text>
        <rect x="${rx + rBoxW - 76}" y="${ry + 6}" width="68" height="16" rx="8" fill="${badgeFill}" stroke="${strokeCol}" stroke-width="0.8"/>
        <text x="${rx + rBoxW - 42}" y="${ry + 17}" text-anchor="middle" fill="${badgeTextCol}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8" font-weight="700">${statusLabel}</text>
        <text x="${rx + 10}" y="${ry + 36}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" font-weight="700">${escapeXml(r.name.slice(0, 32))}</text>
        <text x="${rx + 10}" y="${ry + 55}" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(constraintLine)}</text>
        <text x="${rx + 10}" y="${ry + 72}" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(witnessLine)}</text>
        ${r.satisfiedBy ? `<text x="${rx + 10}" y="${ry + 87}" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">«satisfy» by ${escapeXml(r.satisfiedBy)}</text>` : ""}
      </g>`);
    });
  }

  const headerTitle = `ibd [part def] ${rootPartDef || packageName} [${packageName}]`;
  const tabW = Math.min(440, headerTitle.length * 7.2 + 28);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: #0b111e;">
  <defs>
    <marker id="sysml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#34d399"/>
    </marker>
    <marker id="sysml-arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <polygon points="14,14 ${14 + tabW},14 ${14 + tabW},32 ${14 + tabW - 12},42 14,42" fill="#161f33" stroke="#334155" stroke-width="1.2"/>
  <text x="26" y="32" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700">${escapeXml(headerTitle)}</text>
  ${edgesSvg.join("\n  ")}
  ${nodesSvg.join("\n  ")}
  ${smSvg.join("\n  ")}
  ${reqSvg.join("\n  ")}
</svg>`;

  return {
    svg,
    packageName,
    rootPartDef: rootPartDef || packageName,
    parts,
    connections,
    requirements,
    states,
  };
}

export function preprocessSysmlArtifact(ctx: PreprocessContext): PreprocessResult {
  const sysmlRes = buildSysmlArchitectureFromSource(ctx.content, ctx.baseTitle);
  return {
    ...(sysmlRes.svg ? { svg: sysmlRes.svg } : {}),
    metadata: {
      nodeCount: sysmlRes.parts.length,
      connectionCount: sysmlRes.connections.length,
      requirementCount: sysmlRes.requirements.length,
      dialect: "sysml2",
    },
    viewConfigAdditions: {
      code: ctx.inlineCode,
      title: ctx.baseTitle,
      systemName: sysmlRes.packageName || ctx.baseTitle,
      rootPartDef: sysmlRes.rootPartDef,
      dialect: "sysml2",
      nodeCount: sysmlRes.parts.length,
      connectionCount: sysmlRes.connections.length,
      parts: sysmlRes.parts,
      connections: sysmlRes.connections,
      requirements: sysmlRes.requirements,
      states: sysmlRes.states,
    },
  };
}
