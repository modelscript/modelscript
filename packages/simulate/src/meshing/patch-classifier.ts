// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ClassifiedPatches {
  nodeSets: Map<string, number[]>;
  surfaceTriangles: Map<string, [number, number, number][]>;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    dimensions: [number, number, number];
  };
}

export interface PatchClassificationRules {
  /** Tolerance threshold for identifying planar boundary faces (fraction of dimension). Default: 0.02. */
  toleranceFraction?: number;
  /** Custom name overrides for extremal planes. */
  tags?: {
    minX?: string; // e.g. "INLET"
    maxX?: string; // e.g. "OUTLET"
    minY?: string; // e.g. "SIDE_WALL_YMIN"
    maxY?: string; // e.g. "SIDE_WALL_YMAX"
    minZ?: string; // e.g. "FIXED_SUPPORT"
    maxZ?: string; // e.g. "LOAD_SURFACE"
  };
}

/**
 * Geometric Boundary Patch Classifier.
 * Automatically segments external surface triangles into physical boundary condition zones.
 */
export class PatchClassifier {
  public static classify(
    nodeCoords: Float32Array | number[],
    triangles: Uint32Array | number[],
    rules: PatchClassificationRules = {},
  ): ClassifiedPatches {
    const numNodes = nodeCoords.length / 3;
    const numTriangles = triangles.length / 3;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < numNodes; i++) {
      const x = nodeCoords[i * 3 + 0];
      const y = nodeCoords[i * 3 + 1];
      const z = nodeCoords[i * 3 + 2];

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const dz = Math.max(1e-6, maxZ - minZ);

    const tolFraction = rules.toleranceFraction ?? 0.02;
    const tolX = dx * tolFraction;
    const tolY = dy * tolFraction;
    const tolZ = dz * tolFraction;

    const tags = rules.tags ?? {
      minX: "INLET",
      maxX: "OUTLET",
      minZ: "FIXED_SUPPORT",
      maxZ: "LOAD_SURFACE",
      minY: "WALL_YMIN",
      maxY: "WALL_YMAX",
    };

    const nodeSets = new Map<string, Set<number>>();
    const surfaceTriangles = new Map<string, [number, number, number][]>();

    const getSet = (name: string): Set<number> => {
      let s = nodeSets.get(name);
      if (!s) {
        s = new Set();
        nodeSets.set(name, s);
      }
      return s;
    };

    const getTriList = (name: string): [number, number, number][] => {
      let list = surfaceTriangles.get(name);
      if (!list) {
        list = [];
        surfaceTriangles.set(name, list);
      }
      return list;
    };

    for (let t = 0; t < numTriangles; t++) {
      const n0 = triangles[t * 3 + 0];
      const n1 = triangles[t * 3 + 1];
      const n2 = triangles[t * 3 + 2];

      const xMid = (nodeCoords[n0 * 3] + nodeCoords[n1 * 3] + nodeCoords[n2 * 3]) / 3;
      const yMid = (nodeCoords[n0 * 3 + 1] + nodeCoords[n1 * 3 + 1] + nodeCoords[n2 * 3 + 1]) / 3;
      const zMid = (nodeCoords[n0 * 3 + 2] + nodeCoords[n1 * 3 + 2] + nodeCoords[n2 * 3 + 2]) / 3;

      let tagAssigned = "WALL_BODY";

      if (tags.minZ && Math.abs(zMid - minZ) <= tolZ) {
        tagAssigned = tags.minZ;
      } else if (tags.maxZ && Math.abs(zMid - maxZ) <= tolZ) {
        tagAssigned = tags.maxZ;
      } else if (tags.minX && Math.abs(xMid - minX) <= tolX) {
        tagAssigned = tags.minX;
      } else if (tags.maxX && Math.abs(xMid - maxX) <= tolX) {
        tagAssigned = tags.maxX;
      } else if (tags.minY && Math.abs(yMid - minY) <= tolY) {
        tagAssigned = tags.minY;
      } else if (tags.maxY && Math.abs(yMid - maxY) <= tolY) {
        tagAssigned = tags.maxY;
      }

      const s = getSet(tagAssigned);
      s.add(n0);
      s.add(n1);
      s.add(n2);

      getTriList(tagAssigned).push([n0, n1, n2]);
    }

    const finalNodeSets = new Map<string, number[]>();
    for (const [name, set] of nodeSets.entries()) {
      finalNodeSets.set(
        name,
        Array.from(set).sort((a, b) => a - b),
      );
    }

    return {
      nodeSets: finalNodeSets,
      surfaceTriangles,
      boundingBox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
        dimensions: [dx, dy, dz],
      },
    };
  }
}
