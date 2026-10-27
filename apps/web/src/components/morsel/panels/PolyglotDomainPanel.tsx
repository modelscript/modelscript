// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export interface PolyglotDomainPanelProps {
  dialect: string;
  code: string;
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

interface KpiCard {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: string;
}

interface TableColumn {
  key: string;
  header: string;
  mono?: boolean;
  badge?: boolean;
}

interface TableSection {
  title: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: Record<string, any>[];
}

interface KinematicLink {
  joint: string;
  type: string;
  dof: number;
  parent: string;
  child: string;
  line: number;
}

interface DomainAnalysisResult {
  domainGroup: string;
  domainLabel: string;
  kpis: KpiCard[];
  kinematicChain?: KinematicLink[];
  sections: TableSection[];
}

function findLineNumber(lines: string[], pattern: string | RegExp, startFrom = 0): number {
  for (let i = startFrom; i < lines.length; i++) {
    const l = lines[i]!;
    if (typeof pattern === "string" ? l.includes(pattern) : pattern.test(l)) {
      return i + 1;
    }
  }
  return 1;
}

// ── 1. SysML v2 & ReqIF Requirements & Architecture Parser ──────────────────

function analyzeRequirementsAndSysml(dialect: string, code: string, lines: string[]): DomainAnalysisResult {
  const reqRows: Record<string, any>[] = [];
  const inventoryRows: Record<string, any>[] = [];
  const satisfyMap = new Map<string, string[]>();
  const verifyMap = new Map<string, string[]>();

  if (dialect === "reqif" || code.includes("<REQ-IF") || code.includes("<SPEC-OBJECTS>")) {
    const specObjRegex = /<SPEC-OBJECT\b([^>]*)>([\s\S]*?)<\/SPEC-OBJECT>/gi;
    let m: RegExpExecArray | null;
    while ((m = specObjRegex.exec(code)) !== null) {
      const attrs = m[1]!;
      const body = m[2]!;
      const id = /IDENTIFIER=["']([^"']+)["']/i.exec(attrs)?.[1] ?? `REQ-${reqRows.length + 1}`;
      const name = /LONG-NAME=["']([^"']+)["']/i.exec(attrs)?.[1] ?? id;
      const values = Array.from(body.matchAll(/THE-VALUE=["']([^"']+)["']/gi)).map((v) => v[1]!);
      const text = values.join(" — ") || "Requirement specification object";
      const line = code.slice(0, m.index).split("\n").length;
      reqRows.push({
        id,
        name,
        text,
        satisfiedBy: "—",
        verifiedBy: "—",
        status: "Tracked",
        line,
      });
    }
    const relRegex = /<SPEC-RELATION\b([^>]*)>([\s\S]*?)<\/SPEC-RELATION>/gi;
    while ((m = relRegex.exec(code)) !== null) {
      const attrs = m[1]!;
      const body = m[2]!;
      const id = /IDENTIFIER=["']([^"']+)["']/i.exec(attrs)?.[1] ?? `REL-${inventoryRows.length + 1}`;
      const src = /<SOURCE>\s*<[^>]+>([^<]+)</i.exec(body)?.[1]?.trim() ?? "—";
      const tgt = /<TARGET>\s*<[^>]+>([^<]+)</i.exec(body)?.[1]?.trim() ?? "—";
      const line = code.slice(0, m.index).split("\n").length;
      inventoryRows.push({
        name: id,
        kind: "SpecRelation",
        typeOrTarget: `${src} → ${tgt}`,
        details: "Traceability Link",
        line,
      });
    }
  } else {
    // SysML v2 satisfy / verify links
    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i]!;
      const satMatch = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z0-9_.:]+)\s+by\s+([A-Za-z0-9_.:]+)/.exec(lineStr);
      if (satMatch) {
        const reqName = satMatch[1]!.split(".").pop()!;
        const list = satisfyMap.get(reqName) ?? [];
        list.push(satMatch[2]!);
        satisfyMap.set(reqName, list);
      }
      const verMatch = /\bverify\s+(?:requirement\s+)?([A-Za-z0-9_.:]+)\s+by\s+([A-Za-z0-9_.:]+)/.exec(lineStr);
      if (verMatch) {
        const reqName = verMatch[1]!.split(".").pop()!;
        const list = verifyMap.get(reqName) ?? [];
        list.push(verMatch[2]!);
        verifyMap.set(reqName, list);
      }
    }

    // SysML v2 requirements
    const reqRegex =
      /\brequirement\s+(?:def\s+)?(?:<([^>]+)>\s*)?([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_.:]+))?\s*(?:\{([\s\S]*?)\}|;)/g;
    let m: RegExpExecArray | null;
    while ((m = reqRegex.exec(code)) !== null) {
      const explicitId = m[1];
      const name = m[2]!;
      const body = m[4] ?? "";
      const docMatch = /doc\s*\/\*\s*([\s\S]*?)\s*\*\//.exec(body);
      const id = explicitId || `REQ-${String(reqRows.length + 1).padStart(2, "0")}`;
      const satisfied = satisfyMap.get(name) ?? (explicitId ? satisfyMap.get(explicitId) : undefined) ?? [];
      const verified = verifyMap.get(name) ?? (explicitId ? verifyMap.get(explicitId) : undefined) ?? [];
      const status =
        satisfied.length > 0 && verified.length > 0 ? "Verified" : satisfied.length > 0 ? "Satisfied" : "Open";
      const line = code.slice(0, m.index).split("\n").length;
      reqRows.push({
        id,
        name,
        text: docMatch?.[1]?.replace(/\s+/g, " ").trim() || (m[3] ? `Specializes ${m[3]}` : "SysML v2 Requirement"),
        satisfiedBy: satisfied.length > 0 ? satisfied.join(", ") : "—",
        verifiedBy: verified.length > 0 ? verified.join(", ") : "—",
        status,
        line,
      });
    }

    // SysML v2 parts, ports, attributes, connections, states, actions
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

      const defMatch =
        /^(part|port|attribute|item|connection|interface|state|action|constraint|calc|verification|use\s+case)\s+(def\s+)?([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_.:]+))?(?:\s*\[([^\]]+)\])?(?:\s*=\s*([^;{]+))?/.exec(
          trimmed,
        );
      if (defMatch) {
        const kw = defMatch[1]!;
        const isDef = Boolean(defMatch[2]);
        const name = defMatch[3]!;
        const typeName = defMatch[4] ?? (isDef ? "Definition" : "—");
        const mult = defMatch[5] ? `[${defMatch[5]}]` : "";
        const val = defMatch[6] ? `= ${defMatch[6].trim()}` : "";
        inventoryRows.push({
          name,
          kind: isDef ? `${kw} def` : kw,
          typeOrTarget: typeName,
          details: [mult, val].filter(Boolean).join(" ") || "—",
          line: i + 1,
        });
        continue;
      }

      const connectMatch = /^connect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/.exec(trimmed);
      if (connectMatch) {
        inventoryRows.push({
          name: `${connectMatch[1]} → ${connectMatch[2]}`,
          kind: "connect",
          typeOrTarget: connectMatch[2]!,
          details: `From ${connectMatch[1]}`,
          line: i + 1,
        });
      }
    }
  }

  const satisfiedCount = reqRows.filter((r) => r.satisfiedBy !== "—").length;
  const verifiedCount = reqRows.filter((r) => r.verifiedBy !== "—").length;

  return {
    domainGroup: "sysml-reqif",
    domainLabel: dialect === "reqif" ? "ReqIF Requirements Management" : "SysML v2 Architecture & RTM",
    kpis: [
      { label: "Requirements", value: reqRows.length, sublabel: "Tracked specifications", accent: "#58a6ff" },
      {
        label: "Satisfied",
        value: reqRows.length > 0 ? `${Math.round((satisfiedCount / reqRows.length) * 100)}%` : "—",
        sublabel: `${satisfiedCount} / ${reqRows.length} linked`,
        accent: "#3fb950",
      },
      {
        label: "Verified",
        value: reqRows.length > 0 ? `${Math.round((verifiedCount / reqRows.length) * 100)}%` : "—",
        sublabel: `${verifiedCount} / ${reqRows.length} verified`,
        accent: "#a371f7",
      },
      {
        label: "Structural Elements",
        value: inventoryRows.length,
        sublabel: "Parts, ports & connectors",
        accent: "#d29922",
      },
    ],
    sections: [
      {
        title: "Requirements Traceability Matrix (RTM)",
        subtitle: "Click any requirement row to reveal its definition in the editor",
        columns: [
          { key: "id", header: "Req ID", mono: true },
          { key: "name", header: "Name", mono: true },
          { key: "text", header: "Specification" },
          { key: "satisfiedBy", header: "Satisfied By", mono: true },
          { key: "verifiedBy", header: "Verified By", mono: true },
          { key: "status", header: "Status", badge: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: reqRows,
      },
      {
        title: "Part / Port / Connection Inventory",
        subtitle: "System decomposition, typed usages, attributes, and connections",
        columns: [
          { key: "name", header: "Element", mono: true },
          { key: "kind", header: "Kind", badge: true },
          { key: "typeOrTarget", header: "Type / Target", mono: true },
          { key: "details", header: "Value / Multiplicity", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: inventoryRows,
      },
    ],
  };
}

// ── 2. Multibody Dynamics Parser (GENSYS, SIMPACK, ADAMS, URDF) ─────────────

function jointDofForType(jointType: string): number {
  const t = jointType.toLowerCase();
  if (t.includes("fixed") || t.includes("weld") || t.includes("0")) return 0;
  if (
    t.includes("revolute") ||
    t.includes("continuous") ||
    t.includes("prismatic") ||
    t.includes("translational") ||
    t.includes("hinge") ||
    t.includes("slider")
  ) {
    return 1;
  }
  if (t.includes("cylindrical") || t.includes("universal") || t.includes("hooke")) return 2;
  if (t.includes("spherical") || t.includes("planar") || t.includes("ball")) return 3;
  if (t.includes("floating") || t.includes("free") || t.includes("6dof") || t.includes("bushing")) return 6;
  return 1;
}

function analyzeMultibody(dialect: string, code: string, lines: string[]): DomainAnalysisResult {
  const bodyRows: Record<string, any>[] = [];
  const jointRows: Record<string, any>[] = [];
  const forceRows: Record<string, any>[] = [];
  const kinematicChain: KinematicLink[] = [];

  if (dialect === "urdf" || code.includes("<robot") || code.includes("<link")) {
    const linkRegex = /<link\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/link>|<link\s+name=["']([^"']+)["'][^>]*\/>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(code)) !== null) {
      const name = (m[1] || m[3])!;
      const body = m[2] ?? "";
      const mass = /<mass\s+value=["']([^"']+)["']/i.exec(body)?.[1] ?? "0.0";
      const ixx = /ixx=["']([^"']+)["']/i.exec(body)?.[1];
      const iyy = /iyy=["']([^"']+)["']/i.exec(body)?.[1];
      const izz = /izz=["']([^"']+)["']/i.exec(body)?.[1];
      const line = code.slice(0, m.index).split("\n").length;
      bodyRows.push({
        name,
        mass: `${mass} kg`,
        cg: /<origin[^>]*xyz=["']([^"']+)["']/i.exec(body)?.[1] ?? "0 0 0",
        inertia: ixx ? `I=(${ixx}, ${iyy ?? "0"}, ${izz ?? "0"})` : "Default",
        line,
      });
    }

    const jointRegex = /<joint\s+name=["']([^"']+)["']\s+type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/joint>/gi;
    while ((m = jointRegex.exec(code)) !== null) {
      const name = m[1]!;
      const jtype = m[2]!;
      const body = m[3]!;
      const parent = /<parent\s+link=["']([^"']+)["']/i.exec(body)?.[1] ?? "world";
      const child = /<child\s+link=["']([^"']+)["']/i.exec(body)?.[1] ?? "—";
      const axis = /<axis\s+xyz=["']([^"']+)["']/i.exec(body)?.[1] ?? "0 0 1";
      const dof = jointDofForType(jtype);
      const line = code.slice(0, m.index).split("\n").length;
      jointRows.push({
        name,
        type: jtype,
        bodies: `${parent} → ${child}`,
        dof,
        axisOrParams: `axis=(${axis})`,
        line,
      });
      kinematicChain.push({ joint: name, type: jtype, dof, parent, child, line });
    }
  } else if (dialect === "gensys") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
      const tokens = trimmed.split(/\s+/);
      const cmd = tokens[0]?.toLowerCase();
      if (cmd === "mass" && tokens.length >= 2) {
        bodyRows.push({
          name: tokens[1]!,
          mass: tokens[5] ? `${tokens[5]} kg` : "—",
          cg: tokens.length >= 5 ? `(${tokens[2]}, ${tokens[3]}, ${tokens[4]})` : "(0, 0, 0)",
          inertia: tokens.length >= 9 ? `J=(${tokens[6]}, ${tokens[7]}, ${tokens[8]})` : "—",
          line: i + 1,
        });
      } else if (cmd === "coupl" && tokens.length >= 4) {
        const ctype = tokens[1]!;
        const cname = tokens[2]!;
        const b1 = tokens[3]!;
        const b2 = tokens[4] ?? "track";
        forceRows.push({
          name: cname,
          type: ctype,
          bodies: `${b1} ↔ ${b2}`,
          parameters: tokens.slice(5, 9).join(" ") || "Standard stiffness/damping",
          line: i + 1,
        });
      } else if (cmd === "constr" || cmd === "joint") {
        const jname = tokens[1] ?? `joint_${i + 1}`;
        const jtype = tokens[2] ?? "revolute";
        const dof = jointDofForType(jtype);
        jointRows.push({
          name: jname,
          type: jtype,
          bodies: `${tokens[3] ?? "body1"} → ${tokens[4] ?? "body2"}`,
          dof,
          axisOrParams: tokens.slice(5).join(" ") || "—",
          line: i + 1,
        });
      }
    }
  } else if (dialect === "adams") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("!")) continue;
      if (/^PART\s*\//i.test(trimmed)) {
        const id = /^PART\s*\/\s*([^,\s]+)/i.exec(trimmed)?.[1] ?? `PART_${i + 1}`;
        const mass = /MASS\s*=\s*([0-9.eE+-]+)/i.exec(trimmed)?.[1] ?? "—";
        const ip = /IP\s*=\s*([^,\n]+(?:,[^,\n]+){0,2})/i.exec(trimmed)?.[1] ?? "—";
        bodyRows.push({
          name: `PART/${id}`,
          mass: mass !== "—" ? `${mass} kg` : "Ground / Fixed",
          cg: /CM\s*=\s*(\d+)/i.exec(trimmed)?.[1] ? `Marker ${/CM\s*=\s*(\d+)/i.exec(trimmed)?.[1]}` : "Origin",
          inertia: ip,
          line: i + 1,
        });
      } else if (/^JOINT\s*\//i.test(trimmed)) {
        const id = /^JOINT\s*\/\s*([^,\s]+)/i.exec(trimmed)?.[1] ?? `JOINT_${i + 1}`;
        const jtype =
          /(REVOLUTE|TRANSLATIONAL|SPHERICAL|CYLINDRICAL|UNIVERSAL|FIXED|PLANAR)/i.exec(trimmed)?.[1] ?? "REVOLUTE";
        const markerI = /I\s*=\s*(\d+)/i.exec(trimmed)?.[1] ?? "I";
        const markerJ = /J\s*=\s*(\d+)/i.exec(trimmed)?.[1] ?? "J";
        const dof = jointDofForType(jtype);
        jointRows.push({
          name: `JOINT/${id}`,
          type: jtype,
          bodies: `M${markerI} → M${markerJ}`,
          dof,
          axisOrParams: trimmed.slice(0, 60),
          line: i + 1,
        });
        kinematicChain.push({
          joint: `J/${id}`,
          type: jtype,
          dof,
          parent: `M${markerI}`,
          child: `M${markerJ}`,
          line: i + 1,
        });
      } else if (/^(SPRINGDAMPER|SFORCE|BUSHING|GFORCE)\s*\//i.test(trimmed)) {
        const kind = /^([A-Z]+)\s*\//i.exec(trimmed)?.[1] ?? "FORCE";
        const id = /^[A-Z]+\s*\/\s*([^,\s]+)/i.exec(trimmed)?.[1] ?? `${i + 1}`;
        forceRows.push({
          name: `${kind}/${id}`,
          type: kind,
          bodies: `${/I\s*=\s*(\d+)/i.exec(trimmed)?.[1] ?? "?"} ↔ ${/J\s*=\s*(\d+)/i.exec(trimmed)?.[1] ?? "?"}`,
          parameters: trimmed.slice(0, 64),
          line: i + 1,
        });
      }
    }
  } else {
    // SIMPACK (.spck / .sim) or general multibody
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      const bodyMatch = /^(?:body|\$MBD_BODY)\s+([A-Za-z0-9_.:-]+)/i.exec(trimmed);
      if (bodyMatch) {
        const mass = /mass\s*=\s*([0-9.eE+-]+)/i.exec(trimmed)?.[1] ?? "—";
        bodyRows.push({
          name: bodyMatch[1]!,
          mass: mass !== "—" ? `${mass} kg` : "—",
          cg: /cg\s*=\s*(\([^)]+\)|\[[^\]]+\])/i.exec(trimmed)?.[1] ?? "(0, 0, 0)",
          inertia: /inertia\s*=\s*(\([^)]+\)|\[[^\]]+\])/i.exec(trimmed)?.[1] ?? "Symmetric",
          line: i + 1,
        });
        continue;
      }
      const jointMatch = /^(?:joint|\$MBD_JOINT)\s+([A-Za-z0-9_.:-]+)/i.exec(trimmed);
      if (jointMatch) {
        const jtype = /type\s*=\s*([A-Za-z0-9_]+)/i.exec(trimmed)?.[1] ?? "revolute";
        const from = /from\s*=\s*([A-Za-z0-9_.$]+)/i.exec(trimmed)?.[1] ?? "base";
        const to = /to\s*=\s*([A-Za-z0-9_.$]+)/i.exec(trimmed)?.[1] ?? bodyMatch?.[1] ?? "body";
        const dof = jointDofForType(jtype);
        jointRows.push({
          name: jointMatch[1]!,
          type: jtype,
          bodies: `${from} → ${to}`,
          dof,
          axisOrParams: trimmed.slice(0, 56),
          line: i + 1,
        });
        kinematicChain.push({ joint: jointMatch[1]!, type: jtype, dof, parent: from, child: to, line: i + 1 });
        continue;
      }
      const forceMatch = /^(?:force|\$MBD_FORCE|spring|damper)\s+([A-Za-z0-9_.:-]+)/i.exec(trimmed);
      if (forceMatch) {
        forceRows.push({
          name: forceMatch[1]!,
          type: /type\s*=\s*([A-Za-z0-9_]+)/i.exec(trimmed)?.[1] ?? "Spring-Damper",
          bodies: `${/from\s*=\s*([A-Za-z0-9_.$]+)/i.exec(trimmed)?.[1] ?? "—"} ↔ ${/to\s*=\s*([A-Za-z0-9_.$]+)/i.exec(trimmed)?.[1] ?? "—"}`,
          parameters: trimmed.slice(0, 60),
          line: i + 1,
        });
      }
    }
  }

  // Compute spatial Grübler-Kutzbach mobility: M = 6*(N - 1 - J) + sum(f_i)
  // If no explicit joints are declared (e.g., GENSYS free-body + couplers), each body has 6 DOF
  const nBodiesWithGround = bodyRows.length + 1;
  const nJoints = jointRows.length;
  const sumJointDof = jointRows.reduce((acc, j) => acc + (Number(j.dof) || 0), 0);
  const grublerDof =
    nJoints > 0 ? Math.max(0, 6 * (nBodiesWithGround - 1 - nJoints) + sumJointDof) : bodyRows.length * 6;

  return {
    domainGroup: "multibody",
    domainLabel: `${dialect.toUpperCase()} Multibody Kinematics & Mobility`,
    kpis: [
      {
        label: "Rigid Bodies",
        value: bodyRows.length,
        sublabel: `${nBodiesWithGround} incl. ground frame`,
        accent: "#58a6ff",
      },
      {
        label: "Kinematic Joints",
        value: jointRows.length,
        sublabel: `Σfᵢ = ${sumJointDof} joint DOFs`,
        accent: "#3fb950",
      },
      {
        label: "Grübler Mobility",
        value: `${grublerDof} DOF`,
        sublabel: "Spatial Kutzbach criterion",
        accent: "#a371f7",
      },
      { label: "Force Elements", value: forceRows.length, sublabel: "Couplers, springs & bushings", accent: "#d29922" },
    ],
    kinematicChain,
    sections: [
      {
        title: "Bodies & Mass / Inertia Tensor Inventory",
        columns: [
          { key: "name", header: "Body Identifier", mono: true },
          { key: "mass", header: "Mass", mono: true },
          { key: "cg", header: "Center of Gravity", mono: true },
          { key: "inertia", header: "Moments of Inertia", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: bodyRows,
      },
      {
        title: "Joints & Kinematic Constraints",
        columns: [
          { key: "name", header: "Joint Name", mono: true },
          { key: "type", header: "Joint Type", badge: true },
          { key: "bodies", header: "Parent → Child", mono: true },
          { key: "dof", header: "DOF (fᵢ)", mono: true },
          { key: "axisOrParams", header: "Axis / Definition", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: jointRows,
      },
      {
        title: "Force Elements & Suspension Couplers",
        columns: [
          { key: "name", header: "Force Element", mono: true },
          { key: "type", header: "Type", badge: true },
          { key: "bodies", header: "Connected Bodies", mono: true },
          { key: "parameters", header: "Stiffness / Damping / Parameters", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: forceRows,
      },
    ],
  };
}

// ── 3. Power Systems & Circuits Parser (PSS/E, OpenDSS, PSCAD, SPICE, Verilog-A) ──

function analyzePowerAndCircuits(dialect: string, _code: string, lines: string[]): DomainAnalysisResult {
  const busRows: Record<string, any>[] = [];
  const branchRows: Record<string, any>[] = [];
  const genLoadRows: Record<string, any>[] = [];

  if (dialect === "spice") {
    const nodeSet = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith(";")) continue;
      if (trimmed.startsWith(".")) {
        genLoadRows.push({
          id: trimmed.split(/\s+/)[0]!,
          kind: "Directive",
          busOrNode: "Global",
          spec: trimmed,
          line: i + 1,
        });
        continue;
      }
      const tokens = trimmed.split(/\s+/);
      const desig = tokens[0]!;
      const prefix = desig[0]?.toUpperCase() ?? "";
      const n1 = tokens[1] ?? "0";
      const n2 = tokens[2] ?? "0";
      nodeSet.add(n1);
      nodeSet.add(n2);
      const val = tokens.slice(3).join(" ") || "—";
      if (prefix === "V" || prefix === "I" || prefix === "E" || prefix === "G") {
        genLoadRows.push({
          id: desig,
          kind: prefix === "V" || prefix === "E" ? "Voltage Source" : "Current Source",
          busOrNode: `${n1} → ${n2}`,
          spec: val,
          line: i + 1,
        });
      } else {
        const kindMap: Record<string, string> = {
          R: "Resistor",
          C: "Capacitor",
          L: "Inductor",
          D: "Diode",
          Q: "BJT",
          M: "MOSFET",
          X: "Subcircuit",
        };
        branchRows.push({
          id: desig,
          category: kindMap[prefix] ?? "Component",
          nodes: `${n1} ↔ ${n2}`,
          params: val,
          line: i + 1,
        });
      }
    }
    Array.from(nodeSet).forEach((n, idx) => {
      busRows.push({
        id: n,
        name: n === "0" || n.toLowerCase() === "gnd" ? `${n} (Reference Ground)` : `Net ${n}`,
        baseKvOrType: n === "0" ? "GND (0 V)" : "Electrical Node",
        voltageOrAngle: "Solved in OP/Tran",
        line: idx + 1,
      });
    });
  } else if (dialect === "opendss") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("//")) continue;
      const newMatch = /^(?:New|Edit)\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)\s*(.*)/i.exec(trimmed);
      if (newMatch) {
        const cls = newMatch[1]!;
        const name = newMatch[2]!;
        const rest = newMatch[3]!;
        const bus1 = /bus1=([^\s]+)/i.exec(rest)?.[1] ?? /bus=([^\s]+)/i.exec(rest)?.[1] ?? "—";
        const bus2 = /bus2=([^\s]+)/i.exec(rest)?.[1];
        if (/^(Line|Transformer|Reactor|Capacitor)$/i.test(cls)) {
          branchRows.push({
            id: `${cls}.${name}`,
            category: cls,
            nodes: bus2 ? `${bus1} → ${bus2}` : bus1,
            params: rest.slice(0, 70),
            line: i + 1,
          });
        } else {
          genLoadRows.push({
            id: `${cls}.${name}`,
            kind: cls,
            busOrNode: bus1,
            spec: rest.slice(0, 70),
            line: i + 1,
          });
        }
        if (bus1 !== "—") {
          const baseBus = bus1.split(".")[0]!;
          if (!busRows.some((b) => b.id === baseBus)) {
            busRows.push({
              id: baseBus,
              name: baseBus,
              baseKvOrType: /basekv=([0-9.]+)/i.exec(rest)?.[1]
                ? `${/basekv=([0-9.]+)/i.exec(rest)?.[1]} kV`
                : "Distribution Bus",
              voltageOrAngle: "1.0 pu nominal",
              line: i + 1,
            });
          }
        }
      }
    }
  } else if (dialect === "psse") {
    let section = "bus";
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("@!")) continue;
      if (/^0\s*\/.*BEGIN\s+([A-Z\s]+)\s+DATA/i.test(trimmed)) {
        const secName = /^0\s*\/.*BEGIN\s+([A-Z\s]+)\s+DATA/i.exec(trimmed)?.[1]?.toLowerCase() ?? "";
        if (secName.includes("load")) section = "load";
        else if (secName.includes("generator")) section = "gen";
        else if (secName.includes("branch") || secName.includes("transformer")) section = "branch";
        else section = "other";
        continue;
      }
      if (trimmed.startsWith("0 /") || trimmed.startsWith("Q")) continue;
      const parts = trimmed.split(",").map((s) => s.trim());
      if (parts.length >= 4 && /^\d+$/.test(parts[0]!)) {
        if (section === "bus" && parts.length >= 7) {
          busRows.push({
            id: parts[0]!,
            name: parts[1]?.replace(/'/g, "") || `Bus_${parts[0]}`,
            baseKvOrType: `${parts[2]} kV (Type ${parts[3]})`,
            voltageOrAngle: `V=${parts[7] ?? "1.0"} pu, θ=${parts[8] ?? "0.0"}°`,
            line: i + 1,
          });
        } else if (section === "load" || section === "gen") {
          genLoadRows.push({
            id: `${section.toUpperCase()}_${parts[0]}_${parts[1]?.replace(/'/g, "") || "1"}`,
            kind: section === "gen" ? "Generator" : "Load",
            busOrNode: `Bus ${parts[0]}`,
            spec: `P=${parts[section === "gen" ? 2 : 5] ?? "0"} MW, Q=${parts[section === "gen" ? 3 : 6] ?? "0"} Mvar`,
            line: i + 1,
          });
        } else if (section === "branch") {
          branchRows.push({
            id: `${parts[0]}-${parts[1]}(${parts[2]?.replace(/'/g, "") || "1"})`,
            category: "AC Branch",
            nodes: `Bus ${parts[0]} → Bus ${parts[1]}`,
            params: `R=${parts[3] ?? "0"}, X=${parts[4] ?? "0"} pu`,
            line: i + 1,
          });
        }
      }
    }
  } else {
    // Verilog-A or PSCAD
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const elecMatch = /^(electrical|thermal|magnetic|inout|input|output)\s+([^;]+);/.exec(trimmed);
      if (elecMatch) {
        const nodes = elecMatch[2]!.split(",").map((s) => s.trim());
        for (const n of nodes) {
          busRows.push({
            id: n,
            name: n,
            baseKvOrType: elecMatch[1]!,
            voltageOrAngle: "Discipline Node",
            line: i + 1,
          });
        }
      }
      const paramMatch = /^parameter\s+(real|integer)\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/.exec(trimmed);
      if (paramMatch) {
        genLoadRows.push({
          id: paramMatch[2]!,
          kind: `param ${paramMatch[1]}`,
          busOrNode: "Module",
          spec: paramMatch[3]!,
          line: i + 1,
        });
      }
      const contribMatch = /([VI])\s*\(\s*([^)]+)\s*\)\s*<\+\s*([^;]+);/.exec(trimmed);
      if (contribMatch) {
        branchRows.push({
          id: `${contribMatch[1]}(${contribMatch[2]})`,
          category: contribMatch[1] === "I" ? "Flow Contribution" : "Potential Contribution",
          nodes: contribMatch[2]!,
          params: contribMatch[3]!.trim(),
          line: i + 1,
        });
      }
      const pscadComp = /<component\b[^>]*name=["']([^"']+)["'][^>]*>/i.exec(trimmed);
      if (pscadComp) {
        branchRows.push({
          id: pscadComp[1]!,
          category: "PSCAD Block",
          nodes: "Schematic Canvas",
          params: trimmed.slice(0, 64),
          line: i + 1,
        });
      }
    }
  }

  return {
    domainGroup: "power-circuits",
    domainLabel: `${dialect.toUpperCase()} Power Grid & Circuit Netlist Inspector`,
    kpis: [
      { label: "Buses / Nodes", value: busRows.length, sublabel: "Topological electrical nodes", accent: "#58a6ff" },
      {
        label: "Branches / Elements",
        value: branchRows.length,
        sublabel: "Lines, passives & branches",
        accent: "#3fb950",
      },
      {
        label: "Sources / Loads",
        value: genLoadRows.length,
        sublabel: "Generators, loads & directives",
        accent: "#d29922",
      },
      { label: "Dialect", value: dialect.toUpperCase(), sublabel: "Netlist / Power Flow", accent: "#a371f7" },
    ],
    sections: [
      {
        title: "Buses & Electrical Nodes",
        columns: [
          { key: "id", header: "Bus / Node ID", mono: true },
          { key: "name", header: "Name", mono: true },
          { key: "baseKvOrType", header: "Base kV / Discipline", badge: true },
          { key: "voltageOrAngle", header: "Nominal State", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: busRows,
      },
      {
        title: "Branches, Lines & Netlist Components",
        columns: [
          { key: "id", header: "Designator / ID", mono: true },
          { key: "category", header: "Category", badge: true },
          { key: "nodes", header: "Nodes / From → To", mono: true },
          { key: "params", header: "Impedance / Value / Expression", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: branchRows,
      },
      {
        title: "Generators, Loads & Simulation Directives",
        columns: [
          { key: "id", header: "Identifier", mono: true },
          { key: "kind", header: "Type", badge: true },
          { key: "busOrNode", header: "Attachment", mono: true },
          { key: "spec", header: "Specification", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: genLoadRows,
      },
    ],
  };
}

// ── 4. Thermo-Fluid & Process Parser (OLGA, LPS, GT-SUITE, EASY5, ROCETS, RELAP5, ASPEN, EPANET, SWMM, ECLIPSE) ──

function analyzeThermoFluid(dialect: string, _code: string, lines: string[]): DomainAnalysisResult {
  const pipeRows: Record<string, any>[] = [];
  const boundaryRows: Record<string, any>[] = [];
  const fluidRows: Record<string, any>[] = [];

  let activeSection = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (
      !trimmed ||
      trimmed.startsWith(";") ||
      trimmed.startsWith("!") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }

    const secMatch = /^\[([A-Za-z0-9_]+)\]/.exec(trimmed);
    if (secMatch) {
      activeSection = secMatch[1]!.toUpperCase();
      continue;
    }

    if (
      activeSection === "PIPES" ||
      activeSection === "CONDUITS" ||
      activeSection === "PUMPS" ||
      activeSection === "VALVES"
    ) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        pipeRows.push({
          id: parts[0]!,
          type: activeSection.slice(0, -1),
          connection: `${parts[1]} → ${parts[2]}`,
          geometry: parts.slice(3, 6).join(", ") || "Standard",
          line: i + 1,
        });
      }
      continue;
    }

    if (
      activeSection === "JUNCTIONS" ||
      activeSection === "RESERVOIRS" ||
      activeSection === "TANKS" ||
      activeSection === "OUTFALLS" ||
      activeSection === "SUBCATCHMENTS"
    ) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        boundaryRows.push({
          id: parts[0]!,
          kind: activeSection.slice(0, -1),
          conditions: parts.slice(1).join(", "),
          line: i + 1,
        });
      }
      continue;
    }

    if (activeSection === "OPTIONS" || activeSection === "TIMES") {
      fluidRows.push({
        property: trimmed.split(/\s+/)[0]!,
        value: trimmed.split(/\s+/).slice(1).join(" "),
        line: i + 1,
      });
      continue;
    }

    // OLGA /GT-SUITE / RELAP5 / ASPEN / ECLIPSE / LPS / ROCETS keywords
    const kwMatch = /^([A-Za-z0-9_.-]+)\s+(.*)/.exec(trimmed);
    if (kwMatch) {
      const kw = kwMatch[1]!.toUpperCase();
      const rest = kwMatch[2]!;
      if (
        kw.includes("PIPE") ||
        kw.includes("BRANCH") ||
        kw.includes("DUCT") ||
        kw.includes("ORIFICE") ||
        kw.includes("VALVE") ||
        kw.includes("PUMP") ||
        kw.includes("TURB") ||
        kw.includes("BLOCK")
      ) {
        pipeRows.push({
          id: /LABEL\s*=\s*([^\s,;]+)/i.exec(rest)?.[1] ?? rest.split(/[\s,]+/)[0] ?? `${kw}_${i + 1}`,
          type: kw,
          connection: /FROM\s*=\s*([^\s,;]+)/i.exec(rest)?.[1]
            ? `${/FROM\s*=\s*([^\s,;]+)/i.exec(rest)?.[1]} → ${/TO\s*=\s*([^\s,;]+)/i.exec(rest)?.[1] ?? "?"}`
            : "Flowpath",
          geometry: rest.slice(0, 64),
          line: i + 1,
        });
      } else if (
        kw.includes("NODE") ||
        kw.includes("SOURCE") ||
        kw.includes("BOUND") ||
        kw.includes("WELL") ||
        kw.includes("WCON") ||
        kw.includes("STREAM") ||
        kw.includes("TANK") ||
        kw.includes("CHAMBER")
      ) {
        boundaryRows.push({
          id: /LABEL\s*=\s*([^\s,;]+)/i.exec(rest)?.[1] ?? rest.split(/[\s,]+/)[0] ?? `${kw}_${i + 1}`,
          kind: kw,
          conditions: rest.slice(0, 68),
          line: i + 1,
        });
      } else if (
        kw.includes("FLUID") ||
        kw.includes("PVT") ||
        kw.includes("PROP") ||
        kw.includes("COMP") ||
        kw.includes("INTEGRATION") ||
        kw.includes("DIMENS")
      ) {
        fluidRows.push({
          property: kw,
          value: rest.slice(0, 72),
          line: i + 1,
        });
      }
    }
  }

  return {
    domainGroup: "thermo-fluid",
    domainLabel: `${dialect.toUpperCase()} Thermo-Fluid & Process Cycle Inspector`,
    kpis: [
      {
        label: "Pipes & Branches",
        value: pipeRows.length,
        sublabel: "Conduits, valves & turbomachinery",
        accent: "#58a6ff",
      },
      {
        label: "Nodes & Boundaries",
        value: boundaryRows.length,
        sublabel: "Junctions, tanks, wells & streams",
        accent: "#3fb950",
      },
      {
        label: "Fluid / Cycle Props",
        value: fluidRows.length,
        sublabel: "PVT, EOS & solver options",
        accent: "#a371f7",
      },
      { label: "Domain", value: dialect.toUpperCase(), sublabel: "Thermo-Fluid Network", accent: "#d29922" },
    ],
    sections: [
      {
        title: "Pipes, Flow Branches & Unit Operations",
        columns: [
          { key: "id", header: "Component ID", mono: true },
          { key: "type", header: "Equipment Type", badge: true },
          { key: "connection", header: "Topology", mono: true },
          { key: "geometry", header: "Dimensions / Operating Spec", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: pipeRows,
      },
      {
        title: "Boundaries, Junctions, Tanks & Wells",
        columns: [
          { key: "id", header: "Node / Stream ID", mono: true },
          { key: "kind", header: "Boundary Kind", badge: true },
          { key: "conditions", header: "Pressure / Temperature / Flow Spec", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: boundaryRows,
      },
      {
        title: "Fluid Properties & Cycle / Solver Settings",
        columns: [
          { key: "property", header: "Property / Option", mono: true },
          { key: "value", header: "Specification", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: fluidRows,
      },
    ],
  };
}

// ── 5. CAE Parser (FEA, CFD, STEP, OpenSCAD) ────────────────────────────────

function analyzeCae(dialect: string, code: string, lines: string[]): DomainAnalysisResult {
  const meshRows: Record<string, any>[] = [];
  const materialRows: Record<string, any>[] = [];
  const bcSolverRows: Record<string, any>[] = [];

  if (dialect === "step" || code.trimStart().startsWith("ISO-10303-21;")) {
    const entityCounts = new Map<string, { count: number; firstLine: number; sample: string }>();
    for (let i = 0; i < lines.length; i++) {
      const m = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)/i.exec(lines[i]!);
      if (m) {
        const etype = m[2]!.toUpperCase();
        const existing = entityCounts.get(etype);
        if (existing) {
          existing.count++;
        } else {
          entityCounts.set(etype, { count: 1, firstLine: i + 1, sample: `#${m[1]} (${m[3]!.slice(0, 48)})` });
        }
      }
    }
    for (const [etype, info] of entityCounts.entries()) {
      meshRows.push({
        entity: etype,
        count: info.count,
        sample: info.sample,
        line: info.firstLine,
      });
    }
    const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(code)?.[1] ?? "AUTOMOTIVE_DESIGN";
    const fileName = /FILE_NAME\s*\(\s*'([^']+)'/i.exec(code)?.[1] ?? "document.step";
    bcSolverRows.push(
      { setting: "STEP Schema", value: schema, line: findLineNumber(lines, "FILE_SCHEMA") },
      { setting: "Part File Name", value: fileName, line: findLineNumber(lines, "FILE_NAME") },
    );

    const ptCount = entityCounts.get("CARTESIAN_POINT")?.count ?? 0;
    const faceCount = (entityCounts.get("ADVANCED_FACE")?.count ?? 0) + (entityCounts.get("FACE_SURFACE")?.count ?? 0);
    const solidCount =
      (entityCounts.get("MANIFOLD_SOLID_BREP")?.count ?? 0) + (entityCounts.get("PRODUCT")?.count ?? 0) || 1;

    return {
      domainGroup: "cae",
      domainLabel: "ISO 10303-21 STEP B-Rep & Assembly Inspector",
      kpis: [
        { label: "Cartesian Points", value: ptCount, sublabel: "3D geometric coordinates", accent: "#58a6ff" },
        { label: "B-Rep Faces", value: faceCount, sublabel: "Topological surface patches", accent: "#3fb950" },
        { label: "Solids / Products", value: solidCount, sublabel: "B-Rep bodies & products", accent: "#a371f7" },
        {
          label: "STEP Entities",
          value: Array.from(entityCounts.values()).reduce((a, b) => a + b.count, 0),
          sublabel: schema,
          accent: "#d29922",
        },
      ],
      sections: [
        {
          title: "STEP ISO-10303-21 Entity Inventory",
          columns: [
            { key: "entity", header: "Entity Type", badge: true },
            { key: "count", header: "Count", mono: true },
            { key: "sample", header: "First Instance", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: meshRows,
        },
        {
          title: "Header & Exchange Schema Metadata",
          columns: [
            { key: "setting", header: "Header Attribute", mono: true },
            { key: "value", header: "Value", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: bcSolverRows,
        },
      ],
    };
  }

  if (dialect === "cfd") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("%") || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      const kv = /^([A-Z0-9_]+)\s*=\s*(.+)$/i.exec(trimmed);
      if (kv) {
        const key = kv[1]!.toUpperCase();
        const val = kv[2]!.trim();
        if (key.startsWith("MARKER_")) {
          bcSolverRows.push({
            name: key,
            category: "Boundary Marker",
            value: val,
            line: i + 1,
          });
        } else if (
          key.includes("MACH") ||
          key.includes("REYNOLDS") ||
          key.includes("FREESTREAM") ||
          key.includes("AOA") ||
          key.includes("VISCOSITY") ||
          key.includes("GAMMA")
        ) {
          materialRows.push({
            name: key,
            property: "Freestream / Fluid",
            value: val,
            line: i + 1,
          });
        } else {
          meshRows.push({
            entity: key,
            count: val,
            sample: "Solver / Mesh Configuration",
            line: i + 1,
          });
        }
      }
    }
    return {
      domainGroup: "cae",
      domainLabel: "CFD Solver, Freestream & Boundary Marker Inspector",
      kpis: [
        { label: "Solver Settings", value: meshRows.length, sublabel: "Discretization & mesh keys", accent: "#58a6ff" },
        { label: "Fluid / Freestream", value: materialRows.length, sublabel: "Mach, Re, T∞, P∞", accent: "#3fb950" },
        {
          label: "Boundary Markers",
          value: bcSolverRows.length,
          sublabel: "Wall, inlet, outlet, farfield",
          accent: "#d29922",
        },
        { label: "Dialect", value: "CFD (SU2/Foam)", sublabel: "Aerodynamic / Flow Analysis", accent: "#a371f7" },
      ],
      sections: [
        {
          title: "Boundary Conditions & Surface Markers",
          columns: [
            { key: "name", header: "Marker Key", mono: true },
            { key: "category", header: "Category", badge: true },
            { key: "value", header: "Assigned Patch Names / Values", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: bcSolverRows,
        },
        {
          title: "Fluid & Freestream State Properties",
          columns: [
            { key: "name", header: "Parameter", mono: true },
            { key: "property", header: "Category", badge: true },
            { key: "value", header: "Value", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: materialRows,
        },
        {
          title: "Solver & Numerical Discretization Settings",
          columns: [
            { key: "entity", header: "Directive", mono: true },
            { key: "count", header: "Value", mono: true },
            { key: "sample", header: "Role" },
            { key: "line", header: "Line", mono: true },
          ],
          rows: meshRows,
        },
      ],
    };
  }

  if (dialect === "scad") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const paramMatch = /^(\$?[A-Za-z0-9_]+)\s*=\s*([^;]+);/.exec(trimmed);
      if (paramMatch) {
        materialRows.push({
          name: paramMatch[1]!,
          property: "CSG Parameter",
          value: paramMatch[2]!.trim(),
          line: i + 1,
        });
        continue;
      }
      const primMatch = /\b(cube|cylinder|sphere|polyhedron|linear_extrude|rotate_extrude)\s*\(([^)]*)\)/.exec(trimmed);
      if (primMatch) {
        meshRows.push({
          entity: primMatch[1]!,
          count: 1,
          sample: primMatch[2]!.trim() || "default",
          line: i + 1,
        });
      }
      const boolMatch =
        /\b(difference|union|intersection|hull|minkowski|translate|rotate|scale|mirror)\s*\(([^)]*)\)/.exec(trimmed);
      if (boolMatch) {
        bcSolverRows.push({
          name: boolMatch[1]!,
          category: "CSG Operation",
          value: boolMatch[2]!.trim() || "block",
          line: i + 1,
        });
      }
    }
    return {
      domainGroup: "cae",
      domainLabel: "OpenSCAD Parametric CSG Tree Inspector",
      kpis: [
        { label: "CSG Primitives", value: meshRows.length, sublabel: "Solids & extrusions", accent: "#58a6ff" },
        {
          label: "Booleans / Transforms",
          value: bcSolverRows.length,
          sublabel: "Union, difference, translate",
          accent: "#3fb950",
        },
        {
          label: "Parameters",
          value: materialRows.length,
          sublabel: "Variables & tessellation ($fn)",
          accent: "#a371f7",
        },
        { label: "3D Preview", value: "Active", sublabel: "Auto-tessellated in 3D tab", accent: "#d29922" },
      ],
      sections: [
        {
          title: "CSG Volumetric Primitives",
          columns: [
            { key: "entity", header: "Primitive", badge: true },
            { key: "sample", header: "Arguments", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: meshRows,
        },
        {
          title: "Boolean Operations & Spatial Transforms",
          columns: [
            { key: "name", header: "Operation", badge: true },
            { key: "category", header: "Kind" },
            { key: "value", header: "Arguments", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: bcSolverRows,
        },
        {
          title: "Parametric Variables",
          columns: [
            { key: "name", header: "Variable", mono: true },
            { key: "value", header: "Expression", mono: true },
            { key: "line", header: "Line", mono: true },
          ],
          rows: materialRows,
        },
      ],
    };
  }

  // FEA (.inp Abaqus / CalculiX / Nastran)
  let currentCard = "";
  let nodeCount = 0;
  let elemCount = 0;
  let currentMat = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("**")) continue;
    if (trimmed.startsWith("*")) {
      currentCard = trimmed.split(",")[0]!.toUpperCase();
      if (currentCard === "*ELEMENT") {
        const etype = /TYPE\s*=\s*([A-Za-z0-9_]+)/i.exec(trimmed)?.[1] ?? "C3D8R";
        const elset = /ELSET\s*=\s*([A-Za-z0-9_]+)/i.exec(trimmed)?.[1] ?? "ALL";
        meshRows.push({
          entity: `*ELEMENT (${etype})`,
          count: elset,
          sample: trimmed,
          line: i + 1,
        });
      } else if (currentCard === "*MATERIAL") {
        currentMat = /NAME\s*=\s*([A-Za-z0-9_.-]+)/i.exec(trimmed)?.[1] ?? `MAT_${materialRows.length + 1}`;
        materialRows.push({
          name: currentMat,
          property: "Material Definition",
          value: trimmed,
          line: i + 1,
        });
      } else if (
        currentCard === "*BOUNDARY" ||
        currentCard === "*CLOAD" ||
        currentCard === "*DLOAD" ||
        currentCard === "*DSLOAD" ||
        currentCard === "*STEP" ||
        currentCard === "*STATIC" ||
        currentCard === "*DYNAMIC" ||
        currentCard === "*FREQUENCY"
      ) {
        bcSolverRows.push({
          name: currentCard,
          category:
            currentCard === "*STEP" ||
            currentCard === "*STATIC" ||
            currentCard === "*DYNAMIC" ||
            currentCard === "*FREQUENCY"
              ? "Analysis Step"
              : "Load / Boundary",
          value: lines[i + 1]?.trim() && !lines[i + 1]!.trim().startsWith("*") ? lines[i + 1]!.trim() : trimmed,
          line: i + 1,
        });
      }
      continue;
    }
    if (currentCard === "*NODE") nodeCount++;
    else if (currentCard === "*ELEMENT") elemCount++;
    else if ((currentCard === "*ELASTIC" || currentCard === "*DENSITY" || currentCard === "*PLASTIC") && currentMat) {
      materialRows.push({
        name: currentMat,
        property: currentCard.slice(1),
        value: trimmed,
        line: i + 1,
      });
    }
  }

  meshRows.unshift({
    entity: "*NODE",
    count: nodeCount,
    sample: `${nodeCount} finite element mesh nodes`,
    line: findLineNumber(lines, /^\*NODE/i),
  });

  return {
    domainGroup: "cae",
    domainLabel: "FEA Mesh, Material & Boundary Condition Inspector",
    kpis: [
      { label: "Mesh Nodes", value: nodeCount, sublabel: "*NODE coordinates", accent: "#58a6ff" },
      { label: "Mesh Elements", value: elemCount, sublabel: "*ELEMENT connectivity", accent: "#3fb950" },
      { label: "Materials", value: materialRows.length, sublabel: "Elastic, density & plastic", accent: "#a371f7" },
      { label: "BCs & Steps", value: bcSolverRows.length, sublabel: "Constraints, loads & steps", accent: "#d29922" },
    ],
    sections: [
      {
        title: "Finite Element Mesh Summary",
        columns: [
          { key: "entity", header: "Mesh Section", badge: true },
          { key: "count", header: "Count / Set", mono: true },
          { key: "sample", header: "Card Specification", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: meshRows,
      },
      {
        title: "Materials & Constitutive Properties",
        columns: [
          { key: "name", header: "Material", mono: true },
          { key: "property", header: "Property Card", badge: true },
          { key: "value", header: "Constants (E, ν, ρ)", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: materialRows,
      },
      {
        title: "Boundary Conditions, Loads & Solver Steps",
        columns: [
          { key: "name", header: "Keyword", mono: true },
          { key: "category", header: "Category", badge: true },
          { key: "value", header: "Data Line", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: bcSolverRows,
      },
    ],
  };
}

// ── 6. Modelica / ModelScript / General Polyglot Inspector ──────────────────

function analyzeGeneralModel(dialect: string, _code: string, lines: string[]): DomainAnalysisResult {
  const componentRows: Record<string, any>[] = [];
  const equationRows: Record<string, any>[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const paramOrVar =
      /^(?:(parameter|constant|discrete|input|output)\s+)?(Real|Integer|Boolean|String|[A-Z][A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?(?:\s*=\s*([^;]+))?/.exec(
        trimmed,
      );
    if (
      paramOrVar &&
      ![
        "model",
        "class",
        "package",
        "block",
        "connector",
        "record",
        "function",
        "end",
        "equation",
        "algorithm",
        "connect",
      ].includes(paramOrVar[2]!)
    ) {
      componentRows.push({
        name: paramOrVar[3]!,
        variability: paramOrVar[1] || "component",
        typeName: paramOrVar[2]!,
        valueOrMod: paramOrVar[5]?.trim() || paramOrVar[4]?.trim() || "—",
        line: i + 1,
      });
      continue;
    }
    if (
      trimmed.startsWith("connect(") ||
      trimmed.startsWith("der(") ||
      (trimmed.includes("=") && !trimmed.startsWith("annotation"))
    ) {
      equationRows.push({
        kind: trimmed.startsWith("connect(") ? "connect" : trimmed.startsWith("der(") ? "ODE" : "Relation",
        expression: trimmed.replace(/;\s*$/, "").slice(0, 80),
        line: i + 1,
      });
    }
  }

  return {
    domainGroup: "general",
    domainLabel: `${dialect.toUpperCase()} Model Structure & Equation Inspector`,
    kpis: [
      {
        label: "Components / Vars",
        value: componentRows.length,
        sublabel: "Parameters, states & blocks",
        accent: "#58a6ff",
      },
      {
        label: "Equations / Links",
        value: equationRows.length,
        sublabel: "DAE relations & connections",
        accent: "#3fb950",
      },
      { label: "Source Lines", value: lines.length, sublabel: "Active document", accent: "#a371f7" },
    ],
    sections: [
      {
        title: "Declared Parameters, Variables & Sub-Components",
        columns: [
          { key: "name", header: "Identifier", mono: true },
          { key: "variability", header: "Qualifier", badge: true },
          { key: "typeName", header: "Type / Class", mono: true },
          { key: "valueOrMod", header: "Binding / Modification", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: componentRows,
      },
      {
        title: "Equations, Connections & Directives",
        columns: [
          { key: "kind", header: "Kind", badge: true },
          { key: "expression", header: "Statement / Equation", mono: true },
          { key: "line", header: "Line", mono: true },
        ],
        rows: equationRows,
      },
    ],
  };
}

export const PolyglotDomainPanel: React.FC<PolyglotDomainPanelProps> = ({ dialect, code, colorMode, onRevealLine }) => {
  const [filterText, setFilterText] = useState("");
  const isDark = colorMode === "dark";

  const analysis = useMemo<DomainAnalysisResult>(() => {
    const lines = code.split(/\r?\n/);
    const d = dialect.toLowerCase();

    if (d === "sysml2" || d === "reqif" || code.includes("<REQ-IF")) {
      return analyzeRequirementsAndSysml(d, code, lines);
    }
    if (["gensys", "simpack", "adams", "urdf", "sima", "jsbsim", "opendrive", "openscenario"].includes(d)) {
      return analyzeMultibody(d, code, lines);
    }
    if (["psse", "opendss", "pscad", "spice", "verilog-a", "touchstone", "ibis"].includes(d)) {
      return analyzePowerAndCircuits(d, code, lines);
    }
    if (
      [
        "olga",
        "lps",
        "gtsuite",
        "easy5",
        "rocets",
        "relap5",
        "aspen",
        "epanet",
        "swmm",
        "eclipse",
        "energyplus",
        "sbml",
      ].includes(d)
    ) {
      return analyzeThermoFluid(d, code, lines);
    }
    if (["fea", "cfd", "step", "scad"].includes(d) || code.trimStart().startsWith("ISO-10303-21;")) {
      return analyzeCae(d, code, lines);
    }
    return analyzeGeneralModel(d, code, lines);
  }, [dialect, code]);

  const borderCol = isDark ? "#30363d" : "#d0d7de";
  const cardBg = isDark ? "#161b22" : "#f6f8fa";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#656d76";

  const normalizedFilter = filterText.trim().toLowerCase();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflowY: "auto",
        padding: "72px 20px 28px 20px",
        gap: 18,
        backgroundColor: isDark ? "#0d1117" : "#ffffff",
        color: textPrimary,
        fontSize: 13,
      }}
    >
      {/* Header & Search */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 12,
          borderBottom: `1px solid ${borderCol}`,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{analysis.domainLabel}</div>
          <div style={{ fontSize: 12, color: textMuted }}>
            Live structural inspection synchronized with editor buffer — click any row to jump to source line
          </div>
        </div>
        <input
          type="search"
          placeholder="Filter entities, IDs, or parameters…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            color: textPrimary,
            fontSize: 12,
            minWidth: 230,
          }}
        />
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        {analysis.kpis.map((kpi, idx) => (
          <div
            key={idx}
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              borderLeft: `3px solid ${kpi.accent || "#58a6ff"}`,
            }}
          >
            <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", fontWeight: 600 }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontFamily: "monospace" }}>{kpi.value}</div>
            {kpi.sublabel && <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>{kpi.sublabel}</div>}
          </div>
        ))}
      </div>

      {/* Kinematic Chain Preview for Multibody */}
      {analysis.kinematicChain && analysis.kinematicChain.length > 0 && (
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            Kinematic Chain Topology Preview (Parent → Joint [DOF] → Child)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {analysis.kinematicChain.map((link, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onRevealLine?.(link.line, link.joint)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${borderCol}`,
                  backgroundColor: isDark ? "#0d1117" : "#ffffff",
                  color: textPrimary,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
              >
                <span style={{ color: "#58a6ff", fontWeight: 600 }}>{link.parent}</span>
                <span style={{ color: textMuted }}>─[</span>
                <span style={{ color: "#3fb950" }}>
                  {link.joint}:{link.type} ({link.dof}DOF)
                </span>
                <span style={{ color: textMuted }}>]→</span>
                <span style={{ color: "#d29922", fontWeight: 600 }}>{link.child}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Domain Tables */}
      {analysis.sections.map((section, sIdx) => {
        const filteredRows = normalizedFilter
          ? section.rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(normalizedFilter)))
          : section.rows;

        return (
          <div
            key={sIdx}
            style={{
              borderRadius: 8,
              border: `1px solid ${borderCol}`,
              overflow: "hidden",
              backgroundColor: cardBg,
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${borderCol}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{section.title}</div>
                {section.subtitle && <div style={{ fontSize: 11, color: textMuted }}>{section.subtitle}</div>}
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 10,
                  backgroundColor: isDark ? "rgba(88,166,255,0.15)" : "rgba(9,105,218,0.1)",
                  color: isDark ? "#58a6ff" : "#0969da",
                  fontWeight: 600,
                }}
              >
                {filteredRows.length} {filteredRows.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            {filteredRows.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: textMuted, textAlign: "center" }}>
                No matching entries in this section.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        textAlign: "left",
                        borderBottom: `1px solid ${borderCol}`,
                        backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                      }}
                    >
                      {section.columns.map((col) => (
                        <th
                          key={col.key}
                          style={{
                            padding: "8px 12px",
                            fontWeight: 600,
                            color: textMuted,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        onClick={() => {
                          if (typeof row["line"] === "number") {
                            onRevealLine?.(row["line"], String(row["name"] ?? row["id"] ?? ""));
                          }
                        }}
                        style={{
                          borderBottom: rIdx < filteredRows.length - 1 ? `1px solid ${borderCol}` : "none",
                          cursor: typeof row["line"] === "number" ? "pointer" : "default",
                          backgroundColor: isDark ? "#0d1117" : "#ffffff",
                        }}
                      >
                        {section.columns.map((col) => {
                          const val = row[col.key] ?? "—";
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: "7px 12px",
                                fontFamily: col.mono ? "monospace" : "inherit",
                                maxWidth: 360,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {col.badge ? (
                                <span
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                                  }}
                                >
                                  {String(val)}
                                </span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PolyglotDomainPanel;
