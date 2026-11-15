// SPDX-License-Identifier: AGPL-3.0-or-later

import type { P3743Bus, P3743Corridor } from "@modelscript/exchange";
import type { OverheadConductorSpec } from "@modelscript/simulate/solvers";
import type { DssDeck, DssLine } from "../types.js";

export interface OpendssToP3743Result {
  buses: P3743Bus[];
  corridors: P3743Corridor[];
  conductorsByCorridor: Record<string, OverheadConductorSpec[]>;
}

function lengthToKm(length: number, units?: string): number {
  const u = (units ?? "km").toLowerCase();
  if (u === "m") return length / 1000;
  if (u === "mi" || u === "miles") return length * 1.609344;
  if (u === "ft" || u === "feet") return length * 0.0003048;
  if (u === "kft") return length * 0.3048;
  return length; // default km
}

function coordToMeters(val: number, units?: string): number {
  const u = (units ?? "m").toLowerCase();
  if (u === "ft" || u === "feet") return val * 0.3048;
  return val;
}

function diamToRadiusMeters(diam: number, units?: string): number {
  const u = (units ?? "cm").toLowerCase();
  if (u === "in" || u === "inch") return (diam * 0.0254) / 2;
  if (u === "mm") return (diam * 0.001) / 2;
  if (u === "cm") return (diam * 0.01) / 2;
  return diam / 2;
}

function normalizeBusId(busSpec: string): string {
  const dot = busSpec.indexOf(".");
  return dot >= 0 ? busSpec.slice(0, dot) : busSpec;
}

/**
 * Exports OpenDSS physical line geometry (`WireData`, `LineSpacing`, `LineGeometry`)
 * into IEEE P3743 buses, corridors, and `OverheadConductorSpec` arrays for wideband EMT compilation.
 */
export function opendssToP3743Corridors(
  deck: DssDeck,
  options: { soilRhoOhmM?: number; baseKvLL?: number } = {},
): OpendssToP3743Result {
  const rho = options.soilRhoOhmM ?? 100.0;
  const defaultKv = options.baseKvLL ?? deck.voltageBases[0] ?? 115;

  const busMap = new Map<string, P3743Bus>();
  const ensureBus = (rawId: string): string => {
    const id = normalizeBusId(rawId);
    if (!busMap.has(id)) {
      busMap.set(id, {
        id,
        name: id,
        baseKvLL: defaultKv,
        phases: ["A", "B", "C"],
      });
    }
    return id;
  };

  const corridors: P3743Corridor[] = [];
  const conductorsByCorridor: Record<string, OverheadConductorSpec[]> = {};

  for (const [, line] of deck.lines as Map<string, DssLine>) {
    const fromBusId = ensureBus(line.bus1);
    const toBusId = ensureBus(line.bus2);
    const lengthKm = Math.max(0.001, lengthToKm(line.length, line.units));

    corridors.push({
      id: line.name,
      fromBusId,
      toBusId,
      lengthKm,
      soilModel: { kind: "homogeneous", rhoOhmM: rho },
    });

    if (line.geometry) {
      const geom = deck.lineGeometries.get(line.geometry);
      const spacing = geom ? deck.lineSpacings.get(geom.spacing) : undefined;
      if (geom && spacing) {
        const specs: OverheadConductorSpec[] = [];
        for (let i = 0; i < Math.min(geom.nconds, spacing.x.length, spacing.y.length); i++) {
          const sx = spacing.x[i];
          const sy = spacing.y[i];
          if (sx === undefined || sy === undefined) continue;
          const wireName = geom.wires[i];
          const wire = wireName ? deck.wireData.get(wireName) : undefined;
          const phase = (i < geom.nphases ? i + 1 : 0) as 0 | 1 | 2 | 3;
          specs.push({
            id: wireName ?? `COND_${i + 1}`,
            phase,
            xM: coordToMeters(sx, spacing.units),
            yTowerM: Math.max(1.0, coordToMeters(sy, spacing.units)),
            radiusM: wire ? diamToRadiusMeters(wire.diam, wire.units) : 0.015,
            dcResistanceOhmPerKm: wire ? wire.rdac : 0.05,
          });
        }
        if (specs.length > 0) {
          conductorsByCorridor[line.name] = specs;
        }
      }
    }
  }

  return {
    buses: [...busMap.values()],
    corridors,
    conductorsByCorridor,
  };
}
