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

/**
 * Checks whether a document string looks like a PSS/E `.con` Contingency Data file.
 */
export function isLikelyConContent(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("/") || line.startsWith("@!") || line.startsWith("//")) continue;
    if (/^CONTINGENCY\b/i.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Parses a PSS/E `.con` Contingency Specification file into structured definitions.
 */
export function parseCon(source: string): PsseConCase {
  const contingencies: ContingencyDefinition[] = [];
  const byName = new Map<string, ContingencyDefinition>();

  const lines = source.split(/\r?\n/);
  let currentDef: ContingencyDefinition | null = null;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const startOffset = charOffset;
    const endOffset = startOffset + rawLine.length;
    charOffset = endOffset + 1;

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("@!")) {
      continue;
    }

    // Strip inline comments starting with /
    let cleanLine = trimmed;
    const slashIdx = cleanLine.indexOf("/");
    if (slashIdx >= 0) {
      cleanLine = cleanLine.slice(0, slashIdx).trim();
    }
    if (!cleanLine) continue;

    // Check CONTINGENCY start
    const contMatch = cleanLine.match(
      /^CONTINGENCY\s+(?:'([^']+)'|"([^"]+)"|(\S+))(?:\s+(?:'([^']+)'|"([^"]+)"|(\S+)))?/i,
    );
    if (contMatch) {
      if (currentDef) {
        contingencies.push(currentDef);
        byName.set(currentDef.id.toUpperCase(), currentDef);
      }
      const id = contMatch[1] ?? contMatch[2] ?? contMatch[3] ?? `CONT_${contingencies.length + 1}`;
      const label = contMatch[4] ?? contMatch[5] ?? contMatch[6];
      currentDef = {
        id,
        label,
        actions: [],
        span: {
          startOffset,
          endOffset,
          line: lineNum,
          column: 1,
        },
      };
      continue;
    }

    // Check END
    if (/^END\b/i.test(cleanLine)) {
      if (currentDef) {
        contingencies.push(currentDef);
        byName.set(currentDef.id.toUpperCase(), currentDef);
        currentDef = null;
      }
      continue;
    }

    if (!currentDef) continue;

    // Parse Actions within Contingency block:
    // 1. OPEN BRANCH FROM [BUS] <from> TO [BUS] <to> [CKT <ckt>]
    const openBrMatch = cleanLine.match(
      /^OPEN\s+BRANCH\s+(?:FROM\s+)?(?:BUS\s+)?(\d+)\s+(?:TO\s+)?(?:BUS\s+)?(\d+)(?:\s+(?:CKT\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?/i,
    );
    if (openBrMatch) {
      const fromBus = Number.parseInt(openBrMatch[1]!, 10);
      const toBus = Number.parseInt(openBrMatch[2]!, 10);
      const ckt = (openBrMatch[3] ?? openBrMatch[4] ?? openBrMatch[5] ?? "1").trim();
      currentDef.actions.push({
        type: "open_branch",
        fromBus,
        toBus,
        ckt,
      });
      continue;
    }

    // 2. CLOSE BRANCH FROM [BUS] <from> TO [BUS] <to> [CKT <ckt>]
    const closeBrMatch = cleanLine.match(
      /^CLOSE\s+BRANCH\s+(?:FROM\s+)?(?:BUS\s+)?(\d+)\s+(?:TO\s+)?(?:BUS\s+)?(\d+)(?:\s+(?:CKT\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?/i,
    );
    if (closeBrMatch) {
      const fromBus = Number.parseInt(closeBrMatch[1]!, 10);
      const toBus = Number.parseInt(closeBrMatch[2]!, 10);
      const ckt = (closeBrMatch[3] ?? closeBrMatch[4] ?? closeBrMatch[5] ?? "1").trim();
      currentDef.actions.push({
        type: "close_branch",
        fromBus,
        toBus,
        ckt,
      });
      continue;
    }

    // 3. TRIP / DISCONNECT GENERATOR [BUS] <bus> [ID <id>]
    const tripGenMatch = cleanLine.match(
      /^(?:TRIP|DISCONNECT)\s+GENERATOR\s+(?:BUS\s+)?(\d+)(?:\s+(?:ID\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?/i,
    );
    if (tripGenMatch) {
      const bus = Number.parseInt(tripGenMatch[1]!, 10);
      const id = (tripGenMatch[2] ?? tripGenMatch[3] ?? tripGenMatch[4] ?? "1").trim();
      currentDef.actions.push({
        type: "trip_generator",
        bus,
        id,
      });
      continue;
    }

    // 4. REMOVE / DISCONNECT BUS <bus>
    const disBusMatch = cleanLine.match(/^(?:REMOVE|DISCONNECT)\s+BUS\s+(\d+)/i);
    if (disBusMatch) {
      const bus = Number.parseInt(disBusMatch[1]!, 10);
      currentDef.actions.push({
        type: "disconnect_bus",
        bus,
      });
      continue;
    }

    // 5. CHANGE RATING OF BRANCH FROM [BUS] <from> TO [BUS] <to> [CKT <ckt>] RATEA <rate>
    const chgRateMatch = cleanLine.match(
      /^CHANGE\s+(?:RATING\s+(?:OF\s+)?)?BRANCH\s+(?:FROM\s+)?(?:BUS\s+)?(\d+)\s+(?:TO\s+)?(?:BUS\s+)?(\d+)(?:\s+(?:CKT\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?\s+RATE(?:A)?\s+([0-9.]+)/i,
    );
    if (chgRateMatch) {
      const fromBus = Number.parseInt(chgRateMatch[1]!, 10);
      const toBus = Number.parseInt(chgRateMatch[2]!, 10);
      const ckt = (chgRateMatch[3] ?? chgRateMatch[4] ?? chgRateMatch[5] ?? "1").trim();
      const rateA = Number.parseFloat(chgRateMatch[6]!);
      currentDef.actions.push({
        type: "change_rating",
        fromBus,
        toBus,
        ckt,
        rateA,
      });
      continue;
    }

    // 6. CHANGE GENERATOR [BUS] <bus> [ID <id>] PMAX <val>
    const chgGenMatch = cleanLine.match(
      /^CHANGE\s+GENERATOR\s+(?:BUS\s+)?(\d+)(?:\s+(?:ID\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?\s+PMAX\s+([0-9.]+)/i,
    );
    if (chgGenMatch) {
      const bus = Number.parseInt(chgGenMatch[1]!, 10);
      const id = (chgGenMatch[2] ?? chgGenMatch[3] ?? chgGenMatch[4] ?? "1").trim();
      const pMax = Number.parseFloat(chgGenMatch[5]!);
      currentDef.actions.push({
        type: "change_generator_pmax",
        bus,
        id,
        pMax,
      });
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
 * Parses a PSS/E `.mon` Monitored Elements file.
 */
export function parseMon(source: string): PsseMonCase {
  const voltageRanges: MonitoredVoltageRange[] = [];
  const monitoredBranches: MonitoredBranch[] = [];
  const monitoredSubsystems: string[] = [];
  let monitorTieLines = false;

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("@!")) continue;

    // 1. MONITOR VOLTAGE RANGE BUSES <start> <end> <vmin> <vmax>
    const vMatch = trimmed.match(
      /^MONITOR\s+VOLTAGE\s+(?:RANGE\s+)?(?:BUSES?\s+)?(\d+)(?:\s+(\d+))?\s+([0-9.]+)\s+([0-9.]+)/i,
    );
    if (vMatch) {
      const busStart = Number.parseInt(vMatch[1]!, 10);
      const busEnd = vMatch[2] ? Number.parseInt(vMatch[2], 10) : busStart;
      const vMin = Number.parseFloat(vMatch[3]!);
      const vMax = Number.parseFloat(vMatch[4]!);
      voltageRanges.push({ busStart, busEnd, vMin, vMax });
      continue;
    }

    // 2. MONITOR BRANCH FROM [BUS] <from> TO [BUS] <to> [CKT <ckt>]
    const brMatch = trimmed.match(
      /^MONITOR\s+BRANCH\s+(?:FROM\s+)?(?:BUS\s+)?(\d+)\s+(?:TO\s+)?(?:BUS\s+)?(\d+)(?:\s+(?:CKT\s+)?(?:'([^']+)'|"([^"]+)"|(\S+)))?/i,
    );
    if (brMatch) {
      const fromBus = Number.parseInt(brMatch[1]!, 10);
      const toBus = Number.parseInt(brMatch[2]!, 10);
      const ckt = brMatch[3] ?? brMatch[4] ?? brMatch[5];
      monitoredBranches.push({ fromBus, toBus, ckt });
      continue;
    }

    // 3. MONITOR BRANCHES IN SUBSYSTEM '<name>'
    const subMatch = trimmed.match(/^MONITOR\s+BRANCHES?\s+IN\s+SUBSYSTEM\s+(?:'([^']+)'|"([^"]+)"|(\S+))/i);
    if (subMatch) {
      const subName = subMatch[1] ?? subMatch[2] ?? subMatch[3]!;
      monitoredSubsystems.push(subName);
      continue;
    }

    // 4. MONITOR TIE LINES
    if (/^MONITOR\s+TIE\s+LINES/i.test(trimmed)) {
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
 * Parses a PSS/E `.sub` Subsystems file.
 */
export function parseSub(source: string): PsseSubCase {
  const subsystems = new Map<string, SubsystemDefinition>();
  const lines = source.split(/\r?\n/);
  let currentSub: SubsystemDefinition | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("@!")) continue;

    // SUBSYSTEM '<NAME>'
    const subStartMatch = trimmed.match(/^SUBSYSTEM\s+(?:'([^']+)'|"([^"]+)"|(\S+))/i);
    if (subStartMatch) {
      if (currentSub) {
        subsystems.set(currentSub.name.toUpperCase(), currentSub);
      }
      const name = subStartMatch[1] ?? subStartMatch[2] ?? subStartMatch[3]!;
      currentSub = {
        name,
        kvRanges: [],
        buses: [],
        areas: [],
        zones: [],
      };
      continue;
    }

    if (/^END\b/i.test(trimmed)) {
      if (currentSub) {
        subsystems.set(currentSub.name.toUpperCase(), currentSub);
        currentSub = null;
      }
      continue;
    }

    if (!currentSub) continue;

    // KV <min> <max>
    const kvMatch = trimmed.match(/^KV\s+([0-9.]+)\s+([0-9.]+)/i);
    if (kvMatch) {
      currentSub.kvRanges.push([Number.parseFloat(kvMatch[1]!), Number.parseFloat(kvMatch[2]!)]);
      continue;
    }

    // BUSES / BUS <bus1> <bus2> ...
    const busMatch = trimmed.match(/^(?:BUSES?)\s+(.*)/i);
    if (busMatch) {
      const nums = busMatch[1]!
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      currentSub.buses.push(...nums);
      continue;
    }

    // AREAS / AREA <area1> ...
    const areaMatch = trimmed.match(/^(?:AREAS?)\s+(.*)/i);
    if (areaMatch) {
      const nums = areaMatch[1]!
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      currentSub.areas.push(...nums);
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
