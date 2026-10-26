// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for NASA ROCETS (.roc, .rct, .inp) rocket engine simulation decks.
 */

import { getModuleDescriptor } from "../catalog/modules.js";
import type {
  ComponentKind,
  PropellantKind,
  RocetsComponent,
  RocetsConnection,
  RocetsEngineConfig,
  RocetsEngineModel,
  RocetsPort,
} from "../types.js";

export function parseRocets(sourceText: string): RocetsEngineModel {
  const lines = sourceText.split(/\r?\n/);
  let modelName = "ROCETS_ENGINE";
  let modelTitle: string | undefined;

  const components = new Map<string, RocetsComponent>();
  const connections: RocetsConnection[] = [];
  const config: RocetsEngineConfig = {};

  let currentSection = "";
  let currentComp: RocetsComponent | null = null;
  let capturingUserCode = false;
  let userCodeLines: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const trimmed = rawLine.trim();

    // Skip empty lines and full-line comments
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("//")) {
      continue;
    }

    // Check user routine block
    if (capturingUserCode) {
      if (/^(END\s*SUBROUTINE|END_USER_CODE|END)/i.test(trimmed)) {
        capturingUserCode = false;
        if (currentComp) {
          currentComp.userCode = userCodeLines.join("\n");
        }
        userCodeLines = [];
      } else {
        userCodeLines.push(rawLine);
      }
      continue;
    }

    if (/^(SUBROUTINE|USER_CODE)\b/i.test(trimmed)) {
      capturingUserCode = true;
      userCodeLines = [rawLine];
      continue;
    }

    // Section headers
    const secMatch =
      /^(DECK|MODEL|TITLE|ENGINE|COMPONENTS|MODULES|CONNECTIONS|STREAMS|PROPELLANTS|PROPS|BALANCE|DESIGN):?(?:\s+(\S.*))?$/i.exec(
        trimmed,
      );
    if (secMatch) {
      const secName = secMatch[1]!.toUpperCase();
      const secArg = secMatch[2]?.trim() || "";

      if (secName === "DECK" || secName === "MODEL" || secName === "ENGINE") {
        if (secArg) modelName = secArg.replace(/[^A-Za-z0-9_]/g, "_");
        continue;
      }
      if (secName === "TITLE") {
        if (secArg) modelTitle = secArg.replace(/^["']|["']$/g, "");
        continue;
      }

      currentSection = secName;
      currentComp = null;
      continue;
    }

    // Handle COMPONENTS / MODULES section
    if (currentSection === "COMPONENTS" || currentSection === "MODULES" || currentSection === "") {
      const cmpMatch = /^([A-Za-z0-9_]{2,12})\s+(?:TYPE\s*=\s*|MODULE\s*=\s*)?([A-Za-z0-9_/]+)(?:\s+(.*))?$/i.exec(
        trimmed,
      );
      if (
        cmpMatch &&
        !trimmed.startsWith("PARAMS:") &&
        !trimmed.startsWith("XP:") &&
        !trimmed.startsWith("S0:") &&
        !trimmed.startsWith("PORTS:") &&
        !trimmed.includes("->") &&
        !trimmed.includes(" TO ")
      ) {
        const id = cmpMatch[1]!.toUpperCase();
        const typeRaw = cmpMatch[2]!.toUpperCase().replace(/^GP\//, "");
        const rest = cmpMatch[3] || "";

        let title: string | undefined;
        const titleMatch = /TITLE\s*=\s*("[^"]*"|'[^']*'|\S+)/i.exec(rest);
        if (titleMatch) title = titleMatch[1]!.replace(/^["']|["']$/g, "");

        let fluid: PropellantKind | undefined;
        const fluidMatch = /FLUID\s*=\s*([A-Za-z0-9_]+)/i.exec(rest);
        if (fluidMatch) fluid = fluidMatch[1]!.toUpperCase();

        const desc = getModuleDescriptor(typeRaw);
        const defaultPorts: Record<string, RocetsPort> = {};
        if (desc) {
          desc.inputs.forEach((p) => {
            defaultPorts[p] = { name: p, direction: "in", fluid };
          });
          desc.outputs.forEach((p) => {
            defaultPorts[p] = { name: p, direction: "out", fluid };
          });
        }

        const comp: RocetsComponent = {
          id,
          type: (desc ? desc.type : typeRaw) as ComponentKind,
          title,
          parameters: desc ? { ...desc.parameters } : {},
          initialStates: {},
          ports: defaultPorts,
          line: lineIdx + 1,
          column: 1,
          startOffset: sourceText.indexOf(trimmed),
          endOffset: sourceText.indexOf(trimmed) + trimmed.length,
        };

        components.set(id, comp);
        currentComp = comp;
        continue;
      }

      if (currentComp) {
        // Parse parameters (PARAMS: or XP:)
        if (trimmed.startsWith("PARAMS:") || trimmed.startsWith("XP:")) {
          const body = trimmed.replace(/^(PARAMS|XP):\s*/i, "");
          parseKeyValuePairs(body, currentComp.parameters);
          continue;
        }

        // Parse initial states (S0:)
        if (trimmed.startsWith("S0:")) {
          const body = trimmed.replace(/^S0:\s*/i, "");
          const pairs: Record<string, number | string | number[]> = {};
          parseKeyValuePairs(body, pairs);
          for (const [k, v] of Object.entries(pairs)) {
            if (typeof v === "number") currentComp.initialStates[k] = v;
          }
          continue;
        }

        // Parse ports (PORTS:)
        if (trimmed.startsWith("PORTS:")) {
          const body = trimmed.replace(/^PORTS:\s*/i, "");
          const pairs: Record<string, string | number | number[]> = {};
          parseKeyValuePairs(body, pairs);
          const fluid = typeof pairs["FLUID"] === "string" ? String(pairs["FLUID"]).toUpperCase() : undefined;
          let dir: "in" | "out" | "bidirectional" = "bidirectional";
          if (pairs["DIR"] === "in" || pairs["DIR"] === "out") {
            dir = pairs["DIR"] as "in" | "out";
          }

          for (const [k, v] of Object.entries(pairs)) {
            if (k === "FLUID" || k === "DIR") continue;
            const pName = k.toUpperCase();
            if (typeof v === "number") currentComp.parameters[pName] = v;
            const portDir =
              pName.includes("OUT") || pName.includes("DISCHARGE") ? "out" : pName.includes("IN") ? "in" : dir;
            currentComp.ports[pName] = {
              name: pName,
              direction: dir !== "bidirectional" ? dir : portDir,
              fluid,
            };
          }

          const portItems = body.split(/[,;\s]+/);
          for (const item of portItems) {
            const m = /^([A-Za-z0-9_]+)(?:\((IN|OUT|BI)(?:,\s*([A-Za-z0-9_]+))?\))?$/i.exec(item);
            if (m && !item.includes("=")) {
              const pName = m[1]!.toUpperCase();
              const d =
                (m[2]?.toLowerCase() as "in" | "out" | "bidirectional") || (pName.includes("OUT") ? "out" : "in");
              const fl = m[3]?.toUpperCase() || fluid;
              currentComp.ports[pName] = { name: pName, direction: d, fluid: fl };
            }
          }
          continue;
        }
      }
    }

    // Handle CONNECTIONS / STREAMS section
    if (
      currentSection === "CONNECTIONS" ||
      currentSection === "STREAMS" ||
      trimmed.includes("->") ||
      trimmed.includes(" TO ") ||
      trimmed.includes("=>")
    ) {
      const connMatch =
        /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s*(?:->|=>)\s*|\s+TO\s+)([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+(.*))?$/i.exec(
          trimmed,
        );
      if (connMatch) {
        const fromComp = connMatch[1]!.toUpperCase();
        const fromPort = connMatch[2]!.toUpperCase();
        const toComp = connMatch[3]!.toUpperCase();
        const toPort = connMatch[4]!.toUpperCase();
        const rest = connMatch[5] || "";

        let fluid: PropellantKind | undefined;
        const flMatch = /FLUID\s*=\s*([A-Za-z0-9_]+)/i.exec(rest);
        if (flMatch) fluid = flMatch[1]!.toUpperCase();

        connections.push({
          fromComponent: fromComp,
          fromPort,
          toComponent: toComp,
          toPort,
          fluid,
          line: lineIdx + 1,
          column: 1,
        });
        continue;
      }
    }

    // Handle BALANCE / DESIGN section
    if (currentSection === "BALANCE" || currentSection === "DESIGN") {
      const pairs: Record<string, number | string | number[]> = {};
      parseKeyValuePairs(trimmed, pairs);
      if (typeof pairs["PC"] === "number") config.designPcPa = pairs["PC"];
      if (typeof pairs["THRUST"] === "number") config.designThrustN = pairs["THRUST"];
      if (typeof pairs["MR"] === "number") config.designMr = pairs["MR"];
      if (typeof pairs["CYCLE"] === "string") config.cycle = pairs["CYCLE"];
    }
  }

  return {
    name: modelName,
    title: modelTitle,
    components,
    connections,
    maps: new Map(),
    config,
    sourceText,
  };
}

function parseKeyValuePairs(text: string, target: Record<string, number | string | number[]>): void {
  const regex = /\b([A-Za-z_]\w*)\s*=\s*("[^"]*"|'[^']*'|\[[^\]]*\]|[^\s,;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const key = match[1]!.toUpperCase();
    const rawVal = match[2]!.trim();

    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      const items = rawVal
        .slice(1, -1)
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((v) => parseFloat(v))
        .filter((v) => !isNaN(v));
      target[key] = items;
    } else if (!isNaN(Number(rawVal)) && rawVal !== "") {
      target[key] = Number(rawVal);
    } else {
      target[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  }
}

export const parseRocetsDeck = parseRocets;
