// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pypsa — Parser for PyPSA Networks (JSON / declarative .pypsa text).
 */

import type {
  PypsaBus,
  PypsaGenerator,
  PypsaLine,
  PypsaLink,
  PypsaLoad,
  PypsaNetwork,
  PypsaStorageUnit,
} from "../types.js";

function parseKvArgs(tokens: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      rec[tok.slice(0, eq)] = tok.slice(eq + 1).replace(/^['"]|['"]$/g, "");
    }
  }
  return rec;
}

export function parsePypsa(source: string): PypsaNetwork {
  const trimmed = source.trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const buses: PypsaBus[] = ((raw["buses"] as Partial<PypsaBus>[]) ?? []).map((b) => ({
      name: String(b.name),
      v_nom: Number(b.v_nom ?? 110),
      carrier: String(b.carrier ?? "AC"),
      x: b.x,
      y: b.y,
    }));
    const busByName = new Map(buses.map((b) => [b.name, b]));
    return {
      name: String(raw["name"] ?? "PyPSA_Network"),
      baseMva: Number(raw["baseMva"] ?? 100),
      snapshots: (raw["snapshots"] as string[]) ?? ["2026-01-01T00:00:00Z"],
      buses,
      busByName,
      generators: ((raw["generators"] as Partial<PypsaGenerator>[]) ?? []).map((g) => ({
        name: String(g.name),
        bus: String(g.bus),
        carrier: String(g.carrier ?? "gas"),
        p_nom: Number(g.p_nom ?? 0),
        p_nom_extendable: Boolean(g.p_nom_extendable ?? false),
        capital_cost: Number(g.capital_cost ?? 0),
        marginal_cost: Number(g.marginal_cost ?? 0),
        p_max_pu: Number(g.p_max_pu ?? 1.0),
        p_min_pu: Number(g.p_min_pu ?? 0.0),
      })),
      loads: ((raw["loads"] as Partial<PypsaLoad>[]) ?? []).map((l) => ({
        name: String(l.name),
        bus: String(l.bus),
        p_set: Number(l.p_set ?? 0),
        q_set: Number(l.q_set ?? 0),
      })),
      lines: ((raw["lines"] as Partial<PypsaLine>[]) ?? []).map((ln) => ({
        name: String(ln.name),
        bus0: String(ln.bus0),
        bus1: String(ln.bus1),
        r: Number(ln.r ?? 0),
        x: Number(ln.x ?? 0.01),
        b: Number(ln.b ?? 0),
        s_nom: Number(ln.s_nom ?? 100),
        s_nom_extendable: Boolean(ln.s_nom_extendable ?? false),
        capital_cost: Number(ln.capital_cost ?? 0),
        length_km: Number(ln.length_km ?? 1),
      })),
      links: ((raw["links"] as Partial<PypsaLink>[]) ?? []).map((lk) => ({
        name: String(lk.name),
        bus0: String(lk.bus0),
        bus1: String(lk.bus1),
        p_nom: Number(lk.p_nom ?? 0),
        efficiency: Number(lk.efficiency ?? 1.0),
        capital_cost: Number(lk.capital_cost ?? 0),
        marginal_cost: Number(lk.marginal_cost ?? 0),
      })),
      storageUnits: ((raw["storage_units"] as Partial<PypsaStorageUnit>[]) ?? []).map((st) => ({
        name: String(st.name),
        bus: String(st.bus),
        p_nom: Number(st.p_nom ?? 0),
        max_hours: Number(st.max_hours ?? 4),
        efficiency_store: Number(st.efficiency_store ?? 0.9),
        efficiency_dispatch: Number(st.efficiency_dispatch ?? 0.9),
        standing_loss: Number(st.standing_loss ?? 0.0),
      })),
    };
  }

  let netName = "PyPSA_Network";
  let baseMva = 100;
  const buses: PypsaBus[] = [];
  const generators: PypsaGenerator[] = [];
  const loads: PypsaLoad[] = [];
  const lines: PypsaLine[] = [];
  const links: PypsaLink[] = [];
  const storageUnits: PypsaStorageUnit[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/#.*$/, "")
      .replace(/\/\/.*$/, "")
      .trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const kind = parts[0]?.toLowerCase();
    const name = parts[1] ?? "";
    const kv = parseKvArgs(parts.slice(2));

    if (kind === "network") {
      if (name) netName = name;
      if (kv["baseMva"]) baseMva = Number(kv["baseMva"]);
    } else if (kind === "bus") {
      buses.push({
        name,
        v_nom: Number(kv["v_nom"] ?? 110),
        carrier: kv["carrier"] ?? "AC",
        x: kv["x"] !== undefined ? Number(kv["x"]) : undefined,
        y: kv["y"] !== undefined ? Number(kv["y"]) : undefined,
      });
    } else if (kind === "generator") {
      generators.push({
        name,
        bus: kv["bus"] ?? "",
        carrier: kv["carrier"] ?? "gas",
        p_nom: Number(kv["p_nom"] ?? 0),
        p_nom_extendable: kv["p_nom_extendable"] === "true",
        capital_cost: Number(kv["capital_cost"] ?? 0),
        marginal_cost: Number(kv["marginal_cost"] ?? 0),
        p_max_pu: Number(kv["p_max_pu"] ?? 1.0),
        p_min_pu: Number(kv["p_min_pu"] ?? 0.0),
      });
    } else if (kind === "load") {
      loads.push({
        name,
        bus: kv["bus"] ?? "",
        p_set: Number(kv["p_set"] ?? 0),
        q_set: Number(kv["q_set"] ?? 0),
      });
    } else if (kind === "line") {
      lines.push({
        name,
        bus0: kv["bus0"] ?? "",
        bus1: kv["bus1"] ?? "",
        r: Number(kv["r"] ?? 0),
        x: Number(kv["x"] ?? 0.01),
        b: Number(kv["b"] ?? 0),
        s_nom: Number(kv["s_nom"] ?? 100),
        s_nom_extendable: kv["s_nom_extendable"] === "true",
        capital_cost: Number(kv["capital_cost"] ?? 0),
        length_km: Number(kv["length"] ?? kv["length_km"] ?? 1),
      });
    } else if (kind === "link") {
      links.push({
        name,
        bus0: kv["bus0"] ?? "",
        bus1: kv["bus1"] ?? "",
        p_nom: Number(kv["p_nom"] ?? 0),
        efficiency: Number(kv["efficiency"] ?? 1.0),
        capital_cost: Number(kv["capital_cost"] ?? 0),
        marginal_cost: Number(kv["marginal_cost"] ?? 0),
      });
    } else if (kind === "storage_unit") {
      storageUnits.push({
        name,
        bus: kv["bus"] ?? "",
        p_nom: Number(kv["p_nom"] ?? 0),
        max_hours: Number(kv["max_hours"] ?? 4),
        efficiency_store: Number(kv["efficiency_store"] ?? 0.9),
        efficiency_dispatch: Number(kv["efficiency_dispatch"] ?? 0.9),
        standing_loss: Number(kv["standing_loss"] ?? 0.0),
      });
    }
  }

  return {
    name: netName,
    baseMva,
    snapshots: ["2026-01-01T00:00:00Z"],
    buses,
    busByName: new Map(buses.map((b) => [b.name, b])),
    generators,
    loads,
    lines,
    links,
    storageUnits,
  };
}
