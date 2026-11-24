// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Assembly builder.
 *
 * An assembly is a named collection of {@link PartEntry} records, each
 * wrapping a {@link Solid} with optional material and color metadata.
 */

import { computeSolidAABB } from "./clearance.js";
import type {
  Assembly,
  AssemblyGraph,
  AssemblyGraphNode,
  AssemblyJointDefinition,
  PartEntry,
  Solid,
  SubsystemDefinition,
  Vec3,
} from "./types.js";

/**
 * Wrap a solid as a named assembly part with optional metadata and precomputed bounding box.
 *
 * @example
 * ```ts
 * part(motor, { material: "Aluminum", color: [0.7, 0.7, 0.8], subsystemId: "drivetrain" })
 * ```
 */
export function part(
  solid: Solid,
  opts?: {
    material?: string | undefined;
    color?: Vec3 | undefined;
    boundingBox?: { min: [number, number, number]; max: [number, number, number] } | undefined;
    subsystemId?: string | undefined;
    parentName?: string | undefined;
    joint?: AssemblyJointDefinition | undefined;
    explodeDirection?: Vec3 | undefined;
  },
): PartEntry {
  return Object.freeze({
    solid,
    material: opts?.material,
    color: opts?.color,
    boundingBox: opts?.boundingBox ?? computeSolidAABB(solid),
    subsystemId: opts?.subsystemId,
    parentName: opts?.parentName,
    joint: opts?.joint,
    explodeDirection: opts?.explodeDirection,
  });
}

/**
 * Create a named assembly from a list of parts and optional subsystem metadata.
 *
 * @example
 * ```ts
 * export default assembly("DroneChassisV2", [
 *   part(frame, { material: "CarbonFiber", subsystemId: "airframe" }),
 *   part(motorFR, { material: "Aluminum", parentName: frame.name, subsystemId: "propulsion" }),
 * ]);
 * ```
 */
export function assembly(
  name: string,
  parts: PartEntry[],
  opts?: { subsystems?: readonly SubsystemDefinition[] | undefined },
): Assembly {
  return Object.freeze({
    name,
    parts: Object.freeze([...parts]),
    subsystems: opts?.subsystems ? Object.freeze([...opts.subsystems]) : undefined,
  });
}

function normalizeVec3(v: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return fallback;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Builds a topological parent-before-child {@link AssemblyGraph} with subsystem part counts
 * and hierarchy-aware explode vectors from any {@link Assembly} (flat or hierarchical).
 */
export function buildAssemblyGraph(asm: Assembly): AssemblyGraph {
  const n = asm.parts.length;
  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = asm.parts[i]!;
    if (!nameToIndex.has(p.solid.name)) {
      nameToIndex.set(p.solid.name, i);
    }
  }

  // Compute assembly centroid for fallback radial explode directions
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const centroids: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const bb = asm.parts[i]!.boundingBox;
    const c: Vec3 = bb
      ? [0.5 * (bb.min[0] + bb.max[0]), 0.5 * (bb.min[1] + bb.max[1]), 0.5 * (bb.min[2] + bb.max[2])]
      : [0, 0, 0];
    centroids.push(c);
    cx += c[0];
    cy += c[1];
    cz += c[2];
  }
  const invN = n > 0 ? 1 / n : 1;
  const asmCenter: Vec3 = [cx * invN, cy * invN, cz * invN];

  // Resolve subsystem lookup table
  const explicitSubsystems = new Map<string, SubsystemDefinition>();
  if (asm.subsystems) {
    for (const sub of asm.subsystems) {
      explicitSubsystems.set(sub.id, sub);
    }
  }

  const parentIndices = new Int32Array(n).fill(-1);
  const childrenBuckets: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const p = asm.parts[i]!;
    if (p.parentName) {
      const pIdx = nameToIndex.get(p.parentName);
      if (pIdx !== undefined && pIdx !== i) {
        parentIndices[i] = pIdx;
        childrenBuckets[pIdx]!.push(i);
      }
    }
  }

  // Topological BFS from roots with cycle guard
  const topologicalOrder: number[] = [];
  const depths = new Int32Array(n).fill(0);
  const visited = new Uint8Array(n);
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (parentIndices[i] === -1) {
      queue.push(i);
      visited[i] = 1;
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++]!;
    topologicalOrder.push(curr);
    const kids = childrenBuckets[curr]!;
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k]!;
      if (!visited[child]) {
        visited[child] = 1;
        depths[child] = depths[curr]! + 1;
        queue.push(child);
      }
    }
  }

  // Append any cyclic/disconnected nodes deterministically as depth-0 roots
  for (let i = 0; i < n; i++) {
    if (!visited[i]) {
      parentIndices[i] = -1;
      depths[i] = 0;
      topologicalOrder.push(i);
    }
  }

  const subsystemCounts = new Map<string, number>();
  const nodes: AssemblyGraphNode[] = [];

  for (let i = 0; i < n; i++) {
    const p = asm.parts[i]!;
    const subId = p.subsystemId ?? "default";
    subsystemCounts.set(subId, (subsystemCounts.get(subId) ?? 0) + 1);
    const subMeta = explicitSubsystems.get(subId);

    const c = centroids[i]!;
    let explodeDir: Vec3;
    if (p.explodeDirection) {
      explodeDir = normalizeVec3(p.explodeDirection);
    } else if (p.joint?.axis) {
      explodeDir = normalizeVec3(p.joint.axis);
    } else if (subMeta?.explodeAxis) {
      explodeDir = normalizeVec3(subMeta.explodeAxis);
    } else {
      explodeDir = normalizeVec3([c[0] - asmCenter[0], c[1] - asmCenter[1], c[2] - asmCenter[2]], [0, 1, 0]);
    }

    nodes.push(
      Object.freeze({
        partIndex: i,
        name: p.solid.name,
        subsystemId: subId,
        parentIndex: parentIndices[i]!,
        childIndices: Object.freeze([...childrenBuckets[i]!]),
        depth: depths[i]!,
        joint: p.joint,
        explodeDirection: explodeDir,
      }),
    );
  }

  const subsystems: (SubsystemDefinition & { readonly partCount: number })[] = [];
  const emitted = new Set<string>();
  if (asm.subsystems) {
    for (const sub of asm.subsystems) {
      emitted.add(sub.id);
      subsystems.push(
        Object.freeze({
          ...sub,
          partCount: subsystemCounts.get(sub.id) ?? 0,
        }),
      );
    }
  }

  let autoIdx = subsystems.length + 1;
  for (const [subId, count] of subsystemCounts) {
    if (emitted.has(subId)) continue;
    subsystems.push(
      Object.freeze({
        id: subId,
        code: String(autoIdx++).padStart(2, "0"),
        label: subId.replace(/[-_]+/g, " ").toUpperCase(),
        partCount: count,
      }),
    );
  }

  return Object.freeze({
    assemblyName: asm.name,
    nodes: Object.freeze(nodes),
    topologicalOrder: Object.freeze(topologicalOrder),
    nameToNodeIndex: nameToIndex,
    subsystems: Object.freeze(subsystems),
  });
}
