// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ContingencyDefinition,
  MonitoredBranch,
  MonitoredVoltageRange,
  PsseConCase,
  PsseMonCase,
  PsseSubCase,
  SubsystemDefinition,
} from "../types.js";
import { extractFieldsFromCstTokens, parsePsseCstDocument } from "./cst-tokens.js";

/**
 * Checks whether a document string looks like a PSS/E `.con` Contingency Data file via WASM CST.
 */
export function isLikelyConContent(source: string): boolean {
  const doc = parsePsseCstDocument(source);
  for (const line of doc.lines) {
    if (line.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(line.tokens, source, "whitespace");
    if (fields[0]?.value.toUpperCase() === "CONTINGENCY") {
      return true;
    }
  }
  return false;
}

/**
 * Parses a PSS/E `.con` Contingency Specification file into structured definitions via WASM CST.
 */
export function parseCon(source: string): PsseConCase {
  const cstDoc = parsePsseCstDocument(source);
  const contingencies: ContingencyDefinition[] = [];
  const byName = new Map<string, ContingencyDefinition>();

  let currentDef: ContingencyDefinition | null = null;

  for (const entry of cstDoc.lines) {
    if (entry.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(entry.tokens, source, "whitespace");
    if (fields.length === 0) continue;

    const toks = fields.map((f) => f.value);
    const upper = toks.map((t) => t.toUpperCase());

    if (upper[0] === "CONTINGENCY") {
      if (currentDef) {
        contingencies.push(currentDef);
        byName.set(currentDef.id.toUpperCase(), currentDef);
      }
      const id = toks[1] ?? `CONT_${contingencies.length + 1}`;
      const label = toks[2];
      currentDef = {
        id,
        label,
        actions: [],
        span: {
          startOffset: entry.startOffset,
          endOffset: entry.endOffset,
          line: entry.lineNum,
          column: 1,
        },
      };
      continue;
    }

    if (upper[0] === "END") {
      if (currentDef) {
        contingencies.push(currentDef);
        byName.set(currentDef.id.toUpperCase(), currentDef);
        currentDef = null;
      }
      continue;
    }

    if (!currentDef) continue;

    // Helper: collect positional integers / keywords in order without regexes
    const parseFromToCkt = (startIdx: number) => {
      let idx = startIdx;
      if (upper[idx] === "FROM") idx++;
      if (upper[idx] === "BUS") idx++;
      const fromBus = Number.parseInt(toks[idx++] ?? "", 10);
      if (upper[idx] === "TO") idx++;
      if (upper[idx] === "BUS") idx++;
      const toBus = Number.parseInt(toks[idx++] ?? "", 10);
      let ckt = "1";
      let nextIdx = idx;
      if (upper[idx] === "CKT") {
        ckt = (toks[idx + 1] ?? "1").trim();
        nextIdx = idx + 2;
      } else if (toks[idx] && upper[idx] !== "RATE" && upper[idx] !== "RATEA") {
        ckt = toks[idx]!.trim();
        nextIdx = idx + 1;
      }
      return { fromBus, toBus, ckt, nextIdx };
    };

    if ((upper[0] === "OPEN" || upper[0] === "CLOSE") && upper[1] === "BRANCH") {
      const { fromBus, toBus, ckt } = parseFromToCkt(2);
      if (Number.isFinite(fromBus) && Number.isFinite(toBus)) {
        currentDef.actions.push({
          type: upper[0] === "OPEN" ? "open_branch" : "close_branch",
          fromBus,
          toBus,
          ckt,
        });
      }
      continue;
    }

    if ((upper[0] === "TRIP" || upper[0] === "DISCONNECT") && upper[1] === "GENERATOR") {
      let idx = 2;
      if (upper[idx] === "BUS") idx++;
      const bus = Number.parseInt(toks[idx++] ?? "", 10);
      if (upper[idx] === "ID") idx++;
      const id = (toks[idx] ?? "1").trim();
      if (Number.isFinite(bus)) {
        currentDef.actions.push({ type: "trip_generator", bus, id });
      }
      continue;
    }

    if ((upper[0] === "REMOVE" || upper[0] === "DISCONNECT") && upper[1] === "BUS") {
      const bus = Number.parseInt(toks[2] ?? "", 10);
      if (Number.isFinite(bus)) {
        currentDef.actions.push({ type: "disconnect_bus", bus });
      }
      continue;
    }

    if (upper[0] === "CHANGE" && (upper[1] === "RATING" || upper[1] === "BRANCH")) {
      let idx = 1;
      if (upper[idx] === "RATING") idx++;
      if (upper[idx] === "OF") idx++;
      if (upper[idx] === "BRANCH") idx++;
      const { fromBus, toBus, ckt, nextIdx } = parseFromToCkt(idx);
      let rIdx = nextIdx;
      if (upper[rIdx] === "RATE" || upper[rIdx] === "RATEA") rIdx++;
      const rateA = Number.parseFloat(toks[rIdx] ?? "");
      if (Number.isFinite(fromBus) && Number.isFinite(toBus) && Number.isFinite(rateA)) {
        currentDef.actions.push({ type: "change_rating", fromBus, toBus, ckt, rateA });
      }
      continue;
    }

    if (upper[0] === "CHANGE" && upper[1] === "GENERATOR") {
      let idx = 2;
      if (upper[idx] === "BUS") idx++;
      const bus = Number.parseInt(toks[idx++] ?? "", 10);
      let id = "1";
      if (upper[idx] === "ID") {
        id = (toks[idx + 1] ?? "1").trim();
        idx += 2;
      } else if (toks[idx] && upper[idx] !== "PMAX") {
        id = toks[idx++]!.trim();
      }
      if (upper[idx] === "PMAX") idx++;
      const pMax = Number.parseFloat(toks[idx] ?? "");
      if (Number.isFinite(bus) && Number.isFinite(pMax)) {
        currentDef.actions.push({ type: "change_generator_pmax", bus, id, pMax });
      }
      continue;
    }
  }

  if (currentDef) {
    contingencies.push(currentDef);
    byName.set(currentDef.id.toUpperCase(), currentDef);
  }

  return {
    contingencies,
    byName,
  };
}

/**
 * Serializes a `PsseConCase` back to canonical PSS/E `.con` text format.
 */
export function writeCon(conCase: PsseConCase): string {
  const lines: string[] = ["/ PSS/E CONTINGENCY DATA FILE"];
  for (const c of conCase.contingencies) {
    const labelStr = c.label ? ` '${c.label}'` : "";
    lines.push(`CONTINGENCY '${c.id}'${labelStr}`);
    for (const a of c.actions) {
      switch (a.type) {
        case "open_branch":
          lines.push(`  OPEN BRANCH FROM BUS ${a.fromBus} TO BUS ${a.toBus} CKT '${a.ckt}'`);
          break;
        case "close_branch":
          lines.push(`  CLOSE BRANCH FROM BUS ${a.fromBus} TO BUS ${a.toBus} CKT '${a.ckt}'`);
          break;
        case "trip_generator":
          lines.push(`  TRIP GENERATOR BUS ${a.bus} ID '${a.id}'`);
          break;
        case "disconnect_bus":
          lines.push(`  DISCONNECT BUS ${a.bus}`);
          break;
        case "change_rating":
          lines.push(`  CHANGE RATING BRANCH FROM BUS ${a.fromBus} TO BUS ${a.toBus} CKT '${a.ckt}' RATEA ${a.rateA}`);
          break;
        case "change_generator_pmax":
          lines.push(`  CHANGE GENERATOR BUS ${a.bus} ID '${a.id}' PMAX ${a.pMax}`);
          break;
      }
    }
    lines.push(`END`);
    lines.push(``);
  }
  lines.push(`END`);
  return lines.join("\n") + "\n";
}

/**
 * Parses a PSS/E `.mon` Monitored Elements file via WASM CST.
 */
export function parseMon(source: string): PsseMonCase {
  const voltageRanges: MonitoredVoltageRange[] = [];
  const monitoredBranches: MonitoredBranch[] = [];
  const monitoredSubsystems: string[] = [];
  let monitorTieLines = false;

  const cstDoc = parsePsseCstDocument(source);
  for (const entry of cstDoc.lines) {
    if (entry.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(entry.tokens, source, "whitespace");
    const toks = fields.map((f) => f.value);
    const upper = toks.map((t) => t.toUpperCase());
    if (upper[0] !== "MONITOR") continue;

    if (upper[1] === "VOLTAGE") {
      let idx = 2;
      if (upper[idx] === "RANGE") idx++;
      if (upper[idx] === "BUS" || upper[idx] === "BUSES") idx++;
      const busStart = Number.parseInt(toks[idx++] ?? "", 10);
      let busEnd = busStart;
      // Optional busEnd if 3 more numeric values remain
      if (idx + 2 < toks.length && Number.isInteger(Number(toks[idx]))) {
        busEnd = Number.parseInt(toks[idx++] ?? "", 10);
      }
      const vMin = Number.parseFloat(toks[idx++] ?? "");
      const vMax = Number.parseFloat(toks[idx++] ?? "");
      if (Number.isFinite(busStart) && Number.isFinite(vMin) && Number.isFinite(vMax)) {
        voltageRanges.push({ busStart, busEnd, vMin, vMax });
      }
      continue;
    }

    if (upper[1] === "BRANCH") {
      let idx = 2;
      if (upper[idx] === "FROM") idx++;
      if (upper[idx] === "BUS") idx++;
      const fromBus = Number.parseInt(toks[idx++] ?? "", 10);
      if (upper[idx] === "TO") idx++;
      if (upper[idx] === "BUS") idx++;
      const toBus = Number.parseInt(toks[idx++] ?? "", 10);
      if (upper[idx] === "CKT") idx++;
      const ckt = toks[idx];
      if (Number.isFinite(fromBus) && Number.isFinite(toBus)) {
        monitoredBranches.push({ fromBus, toBus, ckt });
      }
      continue;
    }

    if ((upper[1] === "BRANCH" || upper[1] === "BRANCHES") && upper[2] === "IN" && upper[3] === "SUBSYSTEM") {
      const subName = toks[4];
      if (subName) monitoredSubsystems.push(subName);
      continue;
    }

    if (upper[1] === "TIE" && upper[2] === "LINES") {
      monitorTieLines = true;
      continue;
    }
  }

  return {
    voltageRanges,
    monitoredBranches,
    monitoredSubsystems,
    monitorTieLines,
  };
}

/**
 * Parses a PSS/E `.sub` Subsystems file via WASM CST.
 */
export function parseSub(source: string): PsseSubCase {
  const subsystems = new Map<string, SubsystemDefinition>();
  const cstDoc = parsePsseCstDocument(source);
  let currentSub: SubsystemDefinition | null = null;

  for (const entry of cstDoc.lines) {
    if (entry.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(entry.tokens, source, "whitespace");
    const toks = fields.map((f) => f.value);
    const upper = toks.map((t) => t.toUpperCase());
    if (upper.length === 0) continue;

    if (upper[0] === "SUBSYSTEM" && toks[1]) {
      if (currentSub) {
        subsystems.set(currentSub.name.toUpperCase(), currentSub);
      }
      currentSub = {
        name: toks[1],
        kvRanges: [],
        buses: [],
        areas: [],
        zones: [],
      };
      continue;
    }

    if (upper[0] === "END") {
      if (currentSub) {
        subsystems.set(currentSub.name.toUpperCase(), currentSub);
        currentSub = null;
      }
      continue;
    }

    if (!currentSub) continue;

    if (upper[0] === "KV" && toks.length >= 3) {
      const kMin = Number.parseFloat(toks[1]!);
      const kMax = Number.parseFloat(toks[2]!);
      if (Number.isFinite(kMin) && Number.isFinite(kMax)) {
        currentSub.kvRanges.push([kMin, kMax]);
      }
      continue;
    }

    if (upper[0] === "BUS" || upper[0] === "BUSES") {
      for (let i = 1; i < toks.length; i++) {
        const n = Number.parseInt(toks[i]!, 10);
        if (Number.isFinite(n) && n > 0) currentSub.buses.push(n);
      }
      continue;
    }

    if (upper[0] === "AREA" || upper[0] === "AREAS") {
      for (let i = 1; i < toks.length; i++) {
        const n = Number.parseInt(toks[i]!, 10);
        if (Number.isFinite(n) && n > 0) currentSub.areas.push(n);
      }
      continue;
    }
  }

  if (currentSub) {
    subsystems.set(currentSub.name.toUpperCase(), currentSub);
  }

  return {
    subsystems,
  };
}
