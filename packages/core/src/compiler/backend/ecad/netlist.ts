// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ECAD Netlist Extraction.
 *
 * Walks the flattened DAE's connect pairs to build a structural graph of
 * electrical nets. Each Net aggregates all pins connected together via
 * `connect(a, b)` statements, and components are grouped with their
 * PCB annotation metadata (footprint, placement, pads).
 *
 * The output is a JSON-serializable `NetlistGraph` that serves as the
 * data contract between the compiler and the ECAD canvas frontend.
 */

import type { ModelicaDAE } from "../../modelica/dae.js";

// ── Public types ──

/** A single pin on a component. */
export interface NetlistPin {
  /** Full flattened name (e.g., "R1.p"). */
  name: string;
  /** Parent component name (e.g., "R1"). */
  component: string;
  /** Local pin name within the component (e.g., "p"). */
  localName: string;
}

/** A net — a set of electrically connected pins. */
export interface Net {
  /** Auto-generated net identifier. */
  id: string;
  /** All pins belonging to this net. */
  pins: NetlistPin[];
}

/** PCB placement metadata extracted from annotations. */
export interface ComponentPlacement {
  footprint: string | null;
  layer: string;
  x: number;
  y: number;
  angle: number;
}

/** A component in the netlist graph. */
export interface NetlistComponent {
  /** Flattened component name (e.g., "R1"). */
  name: string;
  /** Pin names belonging to this component. */
  pins: string[];
  /** PCB placement info (from annotation(PCB(...))). */
  placement: ComponentPlacement | null;
}

/** Complete netlist graph for ECAD frontend consumption. */
export interface NetlistGraph {
  /** All nets (connected pin groups). */
  nets: Net[];
  /** All components with their pins and placement. */
  components: NetlistComponent[];
  /** Total number of unique pins. */
  totalPins: number;
  /** Total number of connect pairs processed. */
  totalConnections: number;
}

// ── Extraction algorithm ──

/**
 * Extract a structural netlist graph from the flattened DAE.
 *
 * Uses Union-Find to efficiently merge connect pairs into nets.
 *
 * @param dae The flattened DAE containing connectPairs
 * @returns A JSON-serializable NetlistGraph
 */
export function extractNetlist(dae: ModelicaDAE): NetlistGraph {
  if (dae.connectPairs.length === 0) {
    return { nets: [], components: [], totalPins: 0, totalConnections: 0 };
  }

  // Union-Find for merging connected pins into nets
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr) ?? curr;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) ?? 0;
    const rankB = rank.get(rb) ?? 0;
    if (rankA < rankB) {
      parent.set(ra, rb);
    } else if (rankA > rankB) {
      parent.set(rb, ra);
    } else {
      parent.set(rb, ra);
      rank.set(ra, rankA + 1);
    }
  };

  // Process all connect pairs
  const allPins = new Set<string>();
  const pinToComponent = new Map<string, string>();

  for (const pair of dae.connectPairs) {
    // Initialize Union-Find entries
    if (!parent.has(pair.a)) {
      parent.set(pair.a, pair.a);
      rank.set(pair.a, 0);
    }
    if (!parent.has(pair.b)) {
      parent.set(pair.b, pair.b);
      rank.set(pair.b, 0);
    }
    union(pair.a, pair.b);
    allPins.add(pair.a);
    allPins.add(pair.b);
    pinToComponent.set(pair.a, pair.aComponent);
    pinToComponent.set(pair.b, pair.bComponent);
  }

  // Group pins by net root
  const netGroups = new Map<string, NetlistPin[]>();
  for (const pin of allPins) {
    const root = find(pin);
    let group = netGroups.get(root);
    if (!group) {
      group = [];
      netGroups.set(root, group);
    }
    const comp = pinToComponent.get(pin) ?? "";
    const dotIdx = pin.lastIndexOf(".");
    const localName = dotIdx >= 0 ? pin.substring(dotIdx + 1) : pin;
    group.push({ name: pin, component: comp, localName });
  }

  // Build nets
  const nets: Net[] = [];
  let netCounter = 0;
  for (const pins of netGroups.values()) {
    nets.push({
      id: `Net${netCounter++}`,
      pins,
    });
  }

  // Build components
  const componentPins = new Map<string, Set<string>>();
  for (const pin of allPins) {
    const comp = pinToComponent.get(pin) ?? "";
    let pins = componentPins.get(comp);
    if (!pins) {
      pins = new Set();
      componentPins.set(comp, pins);
    }
    const dotIdx = pin.lastIndexOf(".");
    pins.add(dotIdx >= 0 ? pin.substring(dotIdx + 1) : pin);
  }

  const components: NetlistComponent[] = [];
  for (const [name, pins] of componentPins) {
    // Try to extract PCB annotation from DAE variables
    const placement = extractPlacement(dae, name);
    components.push({
      name,
      pins: Array.from(pins),
      placement,
    });
  }

  return {
    nets,
    components,
    totalPins: allPins.size,
    totalConnections: dae.connectPairs.length,
  };
}

/**
 * Extract PCB placement info from a component's annotation attributes.
 */
function extractPlacement(dae: ModelicaDAE, componentName: string): ComponentPlacement | null {
  // Look for annotation attributes on the component variable
  const v = dae.variables.get(componentName);
  if (!v) return null;

  const pcbAnnotation = v.attributes.get("PCB");
  if (!pcbAnnotation) return null;

  // Extract fields from the annotation record
  // The annotation is typically stored as a nested structure
  if (typeof pcbAnnotation === "object" && pcbAnnotation !== null) {
    const ann = pcbAnnotation as unknown as Record<string, unknown>;
    return {
      footprint: typeof ann["footprint"] === "string" ? ann["footprint"] : null,
      layer: typeof ann["layer"] === "string" ? ann["layer"] : "TopCopper",
      x: typeof ann["x"] === "number" ? ann["x"] : 0,
      y: typeof ann["y"] === "number" ? ann["y"] : 0,
      angle: typeof ann["angle"] === "number" ? ann["angle"] : 0,
    };
  }

  return null;
}

/**
 * Serialize a NetlistGraph to a compact JSON string.
 */
export function netlistToJSON(graph: NetlistGraph): string {
  return JSON.stringify(graph, null, 2);
}
