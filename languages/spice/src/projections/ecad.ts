// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — SPICE to ECAD NetlistGraph Projection.
 *
 * Converts a SPICE circuit into a @modelscript/cad NetlistGraph, enabling
 * seamless integration with the ModelScript ECAD PCB viewer, ratsnest computation,
 * and design rule checks.
 */

import type { Net, NetlistComponent, NetlistGraph, NetlistPin } from "@modelscript/cad/ecad";
import { flattenSpiceCircuit } from "../solvers/mna.js";
import type { SpiceCircuit } from "../types.js";

export function spiceToNetlistGraph(circuit: SpiceCircuit): NetlistGraph {
  const components = flattenSpiceCircuit(circuit);

  const netMap = new Map<string, NetlistPin[]>();
  const ecadComponents: NetlistComponent[] = [];
  let totalPins = 0;
  let totalConnections = 0;

  for (const comp of components) {
    const pinNames: string[] = [];

    // Assign standard pin names based on component kind
    for (let i = 0; i < comp.nodes.length; i++) {
      const node = comp.nodes[i];
      if (node === undefined) continue;

      let localName = `pin${i + 1}`;
      if (comp.nodes.length === 2) {
        localName = i === 0 ? "p" : "n";
      } else if (comp.kind === "Q") {
        const qPins = ["c", "b", "e", "s"];
        localName = qPins[i] ?? `pin${i + 1}`;
      } else if (comp.kind === "M") {
        const mPins = ["d", "g", "s", "b"];
        localName = mPins[i] ?? `pin${i + 1}`;
      }

      const fullName = `${comp.name}.${localName}`;
      pinNames.push(fullName);
      totalPins++;

      const pinObj: NetlistPin = {
        name: fullName,
        component: comp.name,
        localName,
      };

      const normNode = node.toUpperCase();
      const list = netMap.get(normNode) ?? [];
      list.push(pinObj);
      netMap.set(normNode, list);
    }

    ecadComponents.push({
      name: comp.name,
      pins: pinNames,
      placement: null,
    });
  }

  const nets: Net[] = [];
  for (const [nodeId, pins] of netMap) {
    nets.push({
      id: nodeId === "0" || nodeId === "GND" ? "GND" : `NET_${nodeId}`,
      pins,
    });
    if (pins.length > 1) {
      totalConnections += pins.length - 1;
    }
  }

  return {
    nets,
    components: ecadComponents,
    totalPins,
    totalConnections,
  };
}
