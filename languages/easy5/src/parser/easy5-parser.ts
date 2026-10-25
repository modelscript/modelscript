// SPDX-License-Identifier: AGPL-3.0-or-later

import { getBlockDescriptor } from "../catalog/gp-library.js";
import type { Easy5Component, Easy5Connection, Easy5Model, Easy5Port, Easy5Table } from "../types.js";

/**
 * Parses EASY5 model source text (.ez5, .ezm, .ezd, .eas).
 */
export function parseEasy5(sourceText: string): Easy5Model {
  const lines = sourceText.split(/\r?\n/);
  const components = new Map<string, Easy5Component>();
  const connections: Easy5Connection[] = [];
  const tables = new Map<string, Easy5Table>();

  let modelName = "Easy5Model";
  let modelTitle = "";
  let currentComponent: Easy5Component | null = null;
  let inFortranBlock = false;
  let fortranLines: string[] = [];

  let currentSection = "";

  const lineStarts: number[] = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === "\n") lineStarts.push(i + 1);
  }

  function getOffset(lineIdx: number, colIdx: number): number {
    const start = lineStarts[lineIdx] ?? 0;
    return start + colIdx;
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const trimmed = line.trim();

    // Check Fortran block accumulation first
    if (inFortranBlock) {
      if (/^\s*(ENDFORTRAN|END_USER_CODE|END\s+USER_CODE|END\s+CODE)\b/i.test(trimmed)) {
        if (currentComponent) {
          currentComponent.userCode = fortranLines.join("\n");
        }
        inFortranBlock = false;
        fortranLines = [];
        continue;
      }
      fortranLines.push(line);
      continue;
    }

    // Skip empty lines or pure comment lines (! or C at col 1 or # or --)
    if (
      trimmed === "" ||
      trimmed.startsWith("!") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("--") ||
      (line.startsWith("C ") && !line.startsWith("COMPONENTS"))
    ) {
      continue;
    }

    // Model Header
    const modelMatch = /^MODEL\s*:\s*([A-Za-z0-9_]+)/i.exec(trimmed);
    if (modelMatch) {
      modelName = modelMatch[1]!;
      continue;
    }

    const titleMatch = /^TITLE\s*:\s*(.+)$/i.exec(trimmed);
    if (titleMatch) {
      modelTitle = titleMatch[1]!.replace(/^["']|["']$/g, "").trim();
      continue;
    }

    // Major Section Headers
    const secMatch = /^(COMPONENTS|CONNECTIONS|SIMULATION|LINEAR|ANALYSIS|TABLES)\s*:/i.exec(trimmed);
    if (secMatch) {
      currentSection = secMatch[1]!.toUpperCase();
      currentComponent = null;
      continue;
    }

    // Handle COMPONENTS section
    if (currentSection === "COMPONENTS" || currentSection === "") {
      // Component definition line, e.g.:
      // LA01 TYPE=GP/LA TITLE="Lead Lag" X=100 Y=200
      // or COMPONENT LA01 GP/LA
      const cmpMatch = /^([A-Za-z0-9_]{2,8})\s+(?:TYPE\s*=\s*)?([A-Za-z0-9_/]+)(.*)$/i.exec(trimmed);
      if (cmpMatch && !trimmed.startsWith("XP:") && !trimmed.startsWith("S0:") && !trimmed.startsWith("PORTS:")) {
        const id = cmpMatch[1]!.toUpperCase();
        const type = cmpMatch[2]!;
        const rest = cmpMatch[3] || "";

        let title: string | undefined;
        const titleAttr = /TITLE\s*=\s*("[^"]*"|'[^']*'|\S+)/i.exec(rest);
        if (titleAttr) {
          title = titleAttr[1]!.replace(/^["']|["']$/g, "");
        }

        let locX = 0;
        let locY = 0;
        const xAttr = /\bX\s*=\s*([0-9.-]+)/i.exec(rest);
        const yAttr = /\bY\s*=\s*([0-9.-]+)/i.exec(rest);
        if (xAttr) locX = parseFloat(xAttr[1]!);
        if (yAttr) locY = parseFloat(yAttr[1]!);

        const colIdx = line.indexOf(id);
        const startOffset = getOffset(lineIdx, colIdx);
        const endOffset = startOffset + id.length;

        // Default ports from catalog
        const desc = getBlockDescriptor(type);
        const ports: Record<string, Easy5Port> = {};
        if (desc) {
          for (const p of desc.ports) {
            ports[p.name] = { ...p };
          }
        }

        const comp: Easy5Component = {
          id,
          type,
          title,
          parameters: desc ? { ...desc.defaultParameters } : {},
          initialStates: {},
          ports,
          location: { x: locX, y: locY },
          line: lineIdx + 1,
          column: colIdx + 1,
          startOffset,
          endOffset,
        };

        components.set(id, comp);
        currentComponent = comp;
        continue;
      }

      // Parameter declarations XP: K=10.0, NUM=[1.0, 2.0]
      if (currentComponent && /^\s*XP\s*:\s*(.+)$/i.test(trimmed)) {
        const paramsStr = trimmed.replace(/^\s*XP\s*:\s*/i, "");
        parseParameterList(paramsStr, currentComponent.parameters);
        continue;
      }

      // Initial state declarations S0: S1=1.0, S2=0.0
      if (currentComponent && /^\s*S0\s*:\s*(.+)$/i.test(trimmed)) {
        const statesStr = trimmed.replace(/^\s*S0\s*:\s*/i, "");
        parseInitialStates(statesStr, currentComponent.initialStates);
        continue;
      }

      // Custom ports declaration PORTS: IN1=input, OUT1=output
      if (currentComponent && /^\s*PORTS\s*:\s*(.+)$/i.test(trimmed)) {
        const portsStr = trimmed.replace(/^\s*PORTS\s*:\s*/i, "");
        parseCustomPorts(portsStr, currentComponent.ports);
        continue;
      }

      // Start of Fortran block inside component
      if (currentComponent && /^\s*(FORTRAN|USER_CODE|CODE)\s*:/i.test(trimmed)) {
        inFortranBlock = true;
        fortranLines = [];
        continue;
      }
    }

    // Handle CONNECTIONS section or inline connections
    // Format 1: SJ01.OUT -> LA01.IN
    // Format 2: CONNECT SJ01 OUT TO LA01 IN
    // Format 3: LA01.IN = SJ01.OUT
    const arrowConn = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(?:->|-->|=>)\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i.exec(
      trimmed,
    );
    if (arrowConn) {
      const fromComp = arrowConn[1]!.toUpperCase();
      const fromPort = arrowConn[2]!.toUpperCase();
      const toComp = arrowConn[3]!.toUpperCase();
      const toPort = arrowConn[4]!.toUpperCase();

      const colIdx = line.indexOf(trimmed);
      connections.push({
        fromComponent: fromComp,
        fromPort,
        toComponent: toComp,
        toPort,
        line: lineIdx + 1,
        column: colIdx + 1,
        startOffset: getOffset(lineIdx, colIdx),
        endOffset: getOffset(lineIdx, colIdx + trimmed.length),
      });
      continue;
    }

    const eqConn = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i.exec(trimmed);
    if (eqConn) {
      const toComp = eqConn[1]!.toUpperCase();
      const toPort = eqConn[2]!.toUpperCase();
      const fromComp = eqConn[3]!.toUpperCase();
      const fromPort = eqConn[4]!.toUpperCase();

      const colIdx = line.indexOf(trimmed);
      connections.push({
        fromComponent: fromComp,
        fromPort,
        toComponent: toComp,
        toPort,
        line: lineIdx + 1,
        column: colIdx + 1,
        startOffset: getOffset(lineIdx, colIdx),
        endOffset: getOffset(lineIdx, colIdx + trimmed.length),
      });
      continue;
    }

    const connectKeyword =
      /^CONNECT\s+([A-Za-z0-9_]+)(?:\.|\s+)([A-Za-z0-9_]+)\s+TO\s+([A-Za-z0-9_]+)(?:\.|\s+)([A-Za-z0-9_]+)/i.exec(
        trimmed,
      );
    if (connectKeyword) {
      const fromComp = connectKeyword[1]!.toUpperCase();
      const fromPort = connectKeyword[2]!.toUpperCase();
      const toComp = connectKeyword[3]!.toUpperCase();
      const toPort = connectKeyword[4]!.toUpperCase();

      const colIdx = line.indexOf(trimmed);
      connections.push({
        fromComponent: fromComp,
        fromPort,
        toComponent: toComp,
        toPort,
        line: lineIdx + 1,
        column: colIdx + 1,
        startOffset: getOffset(lineIdx, colIdx),
        endOffset: getOffset(lineIdx, colIdx + trimmed.length),
      });
      continue;
    }
  }

  return {
    name: modelName,
    title: modelTitle,
    components,
    connections,
    tables,
    sourceText,
  };
}

/**
 * Parses comma-separated parameter assignments: e.g. K=10.0, NUM=[1.0, 2.0], TABLE="aero.tab"
 */
function parseParameterList(str: string, target: Record<string, number | number[] | string>): void {
  // Regex splitting by comma outside brackets
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i]!;
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim().toUpperCase();
    const valRaw = part.slice(eqIdx + 1).trim();

    if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
      const arrayElems = valRaw
        .slice(1, -1)
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
      target[key] = arrayElems;
    } else if (valRaw.startsWith('"') || valRaw.startsWith("'")) {
      target[key] = valRaw.slice(1, -1);
    } else {
      const num = parseFloat(valRaw);
      target[key] = !isNaN(num) ? num : valRaw;
    }
  }
}

/**
 * Parses initial states: e.g. S1=1.0, S2=0.5
 */
function parseInitialStates(str: string, target: Record<string, number>): void {
  const parts = str.split(",");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim().toUpperCase();
    const val = parseFloat(part.slice(eqIdx + 1).trim());
    if (!isNaN(val)) {
      target[key] = val;
    }
  }
}

/**
 * Parses custom port definitions: e.g. IN1=input, OUT1=output
 */
function parseCustomPorts(str: string, target: Record<string, Easy5Port>): void {
  const parts = str.split(",");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim().toUpperCase();
    const kindStr = part
      .slice(eqIdx + 1)
      .trim()
      .toLowerCase();
    const kind = kindStr === "output" ? "output" : kindStr === "bidirectional" ? "bidirectional" : "input";
    target[name] = { name, kind };
  }
}
