// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pypsa — Semantic & Topology Linter for PyPSA Networks.
 */

import type { PypsaDiagnostic, PypsaNetwork } from "../types.js";

export function lintPypsaNetwork(net: PypsaNetwork): PypsaDiagnostic[] {
  const diagnostics: PypsaDiagnostic[] = [];

  if (net.buses.length === 0) {
    diagnostics.push({
      code: "PYPSA1001",
      severity: "warning",
      message: "PyPSA network contains no buses.",
    });
    return diagnostics;
  }

  const seenBuses = new Set<string>();
  for (const bus of net.buses) {
    if (seenBuses.has(bus.name)) {
      diagnostics.push({
        code: "PYPSA2001",
        severity: "error",
        message: `Duplicate bus name '${bus.name}'.`,
        componentName: bus.name,
      });
    } else {
      seenBuses.add(bus.name);
    }

    if (bus.v_nom <= 0) {
      diagnostics.push({
        code: "PYPSA3001",
        severity: "error",
        message: `Bus '${bus.name}' has non-positive nominal voltage (${bus.v_nom} kV).`,
        componentName: bus.name,
      });
    }
  }

  for (const gen of net.generators) {
    if (!net.busByName.has(gen.bus)) {
      diagnostics.push({
        code: "PYPSA2002",
        severity: "error",
        message: `Generator '${gen.name}' references unresolved bus '${gen.bus}'.`,
        componentName: gen.name,
      });
    }
    if (gen.p_nom < 0) {
      diagnostics.push({
        code: "PYPSA3002",
        severity: "error",
        message: `Generator '${gen.name}' has negative p_nom (${gen.p_nom} MW).`,
        componentName: gen.name,
      });
    }
  }

  for (const load of net.loads) {
    if (!net.busByName.has(load.bus)) {
      diagnostics.push({
        code: "PYPSA2002",
        severity: "error",
        message: `Load '${load.name}' references unresolved bus '${load.bus}'.`,
        componentName: load.name,
      });
    }
  }

  for (const line of net.lines) {
    if (!net.busByName.has(line.bus0) || !net.busByName.has(line.bus1)) {
      diagnostics.push({
        code: "PYPSA2002",
        severity: "error",
        message: `Line '${line.name}' references unresolved bus0 ('${line.bus0}') or bus1 ('${line.bus1}').`,
        componentName: line.name,
      });
    }
    if (line.r === 0 && line.x === 0) {
      diagnostics.push({
        code: "PYPSA3003",
        severity: "warning",
        message: `Line '${line.name}' has zero impedance (r=0, x=0).`,
        componentName: line.name,
      });
    }
  }

  for (const link of net.links) {
    if (!net.busByName.has(link.bus0) || !net.busByName.has(link.bus1)) {
      diagnostics.push({
        code: "PYPSA2002",
        severity: "error",
        message: `Link '${link.name}' references unresolved bus0 ('${link.bus0}') or bus1 ('${link.bus1}').`,
        componentName: link.name,
      });
    }
  }

  for (const st of net.storageUnits) {
    if (!net.busByName.has(st.bus)) {
      diagnostics.push({
        code: "PYPSA2002",
        severity: "error",
        message: `StorageUnit '${st.name}' references unresolved bus '${st.bus}'.`,
        componentName: st.name,
      });
    }
    if (
      st.efficiency_store <= 0 ||
      st.efficiency_store > 1 ||
      st.efficiency_dispatch <= 0 ||
      st.efficiency_dispatch > 1
    ) {
      diagnostics.push({
        code: "PYPSA3004",
        severity: "error",
        message: `StorageUnit '${st.name}' efficiencies must be in (0, 1].`,
        componentName: st.name,
      });
    }
  }

  return diagnostics;
}
