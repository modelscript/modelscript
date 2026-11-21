// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — PSS/E Subsystem (.sub) and Monitored Element (.mon) File Parsers
 *
 * Parses industry-standard PSS/E ACCC auxiliary files:
 * - `.sub`: SUBSYSTEM definitions with AREA, ZONE, OWNER, BUS, and KV range filters.
 * - `.mon`: MONITOR VOLTAGE RANGE, MONITOR BRANCHES IN AREA/SUBSYSTEM, and rating set selectors.
 */

import type { PsseCase } from "../types.js";

export interface PsseSubsystemSpec {
  name: string;
  areas: number[];
  zones: number[];
  owners: number[];
  buses: number[];
  kvMin?: number | undefined;
  kvMax?: number | undefined;
}

export interface PsseSubFile {
  subsystems: Map<string, PsseSubsystemSpec>;
}

export interface PsseMonVoltageSpec {
  subsystem?: string | undefined;
  area?: number | undefined;
  vMinPu: number;
  vMaxPu: number;
}

export interface PsseMonBranchSpec {
  subsystem?: string | undefined;
  area?: number | undefined;
  ratingSet: "RATEA" | "RATEB" | "RATEC";
  thresholdPercent: number;
}

export interface PsseMonFile {
  voltageLimits: PsseMonVoltageSpec[];
  branchLimits: PsseMonBranchSpec[];
  monitoredAreas: number[];
  monitoredSubsystems: string[];
}

/**
 * Parses a PSS/E `.sub` Subsystem definition file.
 */
export function parseSubFile(text: string): PsseSubFile {
  const subsystems = new Map<string, PsseSubsystemSpec>();
  let current: PsseSubsystemSpec | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/.*$/, "").trim();
    if (!line || line.startsWith("COM")) continue;
    const upper = line.toUpperCase();

    if (upper.startsWith("SUBSYSTEM")) {
      const m = /^SUBSYSTEM\s+['"]?([^'"]+)['"]?/i.exec(line);
      const name = (m?.[1] ?? "DEFAULT").trim();
      current = { name, areas: [], zones: [], owners: [], buses: [] };
      subsystems.set(name, current);
      continue;
    }

    if (upper === "END") {
      current = null;
      continue;
    }

    if (!current) continue;

    if (upper.startsWith("AREA")) {
      const nums = line.slice(4).match(/\d+/g);
      if (nums) current.areas.push(...nums.map((n) => Number.parseInt(n, 10)));
    } else if (upper.startsWith("ZONE")) {
      const nums = line.slice(4).match(/\d+/g);
      if (nums) current.zones.push(...nums.map((n) => Number.parseInt(n, 10)));
    } else if (upper.startsWith("OWNER")) {
      const nums = line.slice(5).match(/\d+/g);
      if (nums) current.owners.push(...nums.map((n) => Number.parseInt(n, 10)));
    } else if (upper.startsWith("BUS")) {
      const nums = line.slice(3).match(/\d+/g);
      if (nums) current.buses.push(...nums.map((n) => Number.parseInt(n, 10)));
    } else if (upper.startsWith("KVRANGE")) {
      const nums = line.slice(7).match(/\d+(?:\.\d+)?/g);
      if (nums && nums.length >= 2) {
        current.kvMin = Number.parseFloat(nums[0]!);
        current.kvMax = Number.parseFloat(nums[1]!);
      }
    }
  }

  return { subsystems };
}

/**
 * Resolves a parsed `.sub` subsystem specification to the set of matching bus numbers in a `PsseCase`.
 */
export function resolveSubsystemBuses(psseCase: PsseCase, spec: PsseSubsystemSpec): Set<number> {
  const result = new Set<number>();
  const areaSet = new Set(spec.areas);
  const zoneSet = new Set(spec.zones);
  const ownerSet = new Set(spec.owners);
  const busSet = new Set(spec.buses);
  const hasExplicitFilter = areaSet.size > 0 || zoneSet.size > 0 || ownerSet.size > 0 || busSet.size > 0;

  for (const b of psseCase.buses.values()) {
    if (b.ide === 4) continue;
    if (spec.kvMin !== undefined && b.baseKv < spec.kvMin) continue;
    if (spec.kvMax !== undefined && b.baseKv > spec.kvMax) continue;

    if (!hasExplicitFilter || busSet.has(b.i) || areaSet.has(b.area) || zoneSet.has(b.zone) || ownerSet.has(b.owner)) {
      result.add(b.i);
    }
  }
  return result;
}

/**
 * Parses a PSS/E `.mon` Monitored Element file.
 */
export function parseMonFile(text: string): PsseMonFile {
  const voltageLimits: PsseMonVoltageSpec[] = [];
  const branchLimits: PsseMonBranchSpec[] = [];
  const monitoredAreas: number[] = [];
  const monitoredSubsystems: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/.*$/, "").trim();
    if (!line || line.startsWith("COM") || line.toUpperCase() === "END") continue;
    const upper = line.toUpperCase();

    // MONITOR VOLTAGE RANGE SUBSYSTEM 'SYS' 0.95 1.05
    const vSub = /^MONITOR\s+VOLTAGE\s+RANGE\s+SUBSYSTEM\s+['"]?([^'"\s]+)['"]?\s+([\d.]+)\s+([\d.]+)/i.exec(line);
    if (vSub) {
      voltageLimits.push({
        subsystem: vSub[1]!,
        vMinPu: Number.parseFloat(vSub[2]!),
        vMaxPu: Number.parseFloat(vSub[3]!),
      });
      if (!monitoredSubsystems.includes(vSub[1]!)) monitoredSubsystems.push(vSub[1]!);
      continue;
    }

    // MONITOR VOLTAGE RANGE AREA 1 0.95 1.05
    const vArea = /^MONITOR\s+VOLTAGE\s+RANGE\s+AREA\s+(\d+)\s+([\d.]+)\s+([\d.]+)/i.exec(line);
    if (vArea) {
      const area = Number.parseInt(vArea[1]!, 10);
      voltageLimits.push({
        area,
        vMinPu: Number.parseFloat(vArea[2]!),
        vMaxPu: Number.parseFloat(vArea[3]!),
      });
      if (!monitoredAreas.includes(area)) monitoredAreas.push(area);
      continue;
    }

    // MONITOR BRANCHES IN SUBSYSTEM 'SYS' [RATEA|RATEB|RATEC] [100]
    const bSub = /^MONITOR\s+BRANCHES\s+IN\s+SUBSYSTEM\s+['"]?([^'"\s]+)['"]?(?:\s+(RATE[ABC]))?(?:\s+([\d.]+))?/i.exec(
      line,
    );
    if (bSub) {
      branchLimits.push({
        subsystem: bSub[1]!,
        ratingSet: (bSub[2]?.toUpperCase() as "RATEA" | "RATEB" | "RATEC") ?? "RATEB",
        thresholdPercent: bSub[3] ? Number.parseFloat(bSub[3]) : 100.0,
      });
      if (!monitoredSubsystems.includes(bSub[1]!)) monitoredSubsystems.push(bSub[1]!);
      continue;
    }

    // MONITOR BRANCHES IN AREA 1 [RATEA|RATEB|RATEC] [100]
    const bArea = /^MONITOR\s+BRANCHES\s+IN\s+AREA\s+(\d+)(?:\s+(RATE[ABC]))?(?:\s+([\d.]+))?/i.exec(line);
    if (bArea) {
      const area = Number.parseInt(bArea[1]!, 10);
      branchLimits.push({
        area,
        ratingSet: (bArea[2]?.toUpperCase() as "RATEA" | "RATEB" | "RATEC") ?? "RATEB",
        thresholdPercent: bArea[3] ? Number.parseFloat(bArea[3]) : 100.0,
      });
      if (!monitoredAreas.includes(area)) monitoredAreas.push(area);
      continue;
    }

    if (upper.startsWith("MONITOR VOLTAGE RANGE")) {
      const nums = line.match(/[\d.]+/g);
      if (nums && nums.length >= 2) {
        voltageLimits.push({
          vMinPu: Number.parseFloat(nums[0]!),
          vMaxPu: Number.parseFloat(nums[1]!),
        });
      }
    }
  }

  return { voltageLimits, branchLimits, monitoredAreas, monitoredSubsystems };
}
