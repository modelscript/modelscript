// SPDX-License-Identifier: AGPL-3.0-or-later

import { hdf4DataTypeByteWidth, type Hdf4Document, type Hdf4Sds } from "../types.js";

export interface Hdf4HierarchyNode {
  name: string;
  kind: "FILE" | "VGROUP" | "SDS" | "VDATA" | "RASTER8" | "PALETTE" | "TAGREF";
  ref?: number | undefined;
  vgroupClass?: string | undefined;
  depth: number;
  path: string;
  cyclic?: boolean | undefined;
  children: Hdf4HierarchyNode[];
}

export interface Hdf4HierarchyResult {
  root: Hdf4HierarchyNode;
  visitedVgroups: string[];
  cycles: string[];
  orphanSds: string[];
}

export interface Hdf4SdsStatistics {
  count: number;
  validCount: number;
  min: number;
  max: number;
  sum: number;
  mean: number;
  variance: number;
  std: number;
  sampleStd: number;
  rms: number;
  l2Norm: number;
  rmse?: number | undefined;
}

export type Hdf4SliceAxis = number | [start: number, end: number] | "all";

export interface Hdf4SliceResult {
  shape: number[];
  data: number[];
}

export interface Hdf4AnalysisReport {
  documentName: string;
  hierarchy: Hdf4HierarchyResult;
  sdsStats: Record<string, Hdf4SdsStatistics>;
  totalSdsElements: number;
  estimatedPayloadBytes: number;
}

/**
 * Traverses the Vgroup/SDS hierarchy tree with cycle protection and orphan detection.
 */
export function traverseVgroupHierarchy(doc: Hdf4Document): Hdf4HierarchyResult {
  const vgByName = new Map(doc.vgroups.map((v) => [v.name, v]));
  const sdsByName = new Map(doc.sdsList.map((s) => [s.name, s]));
  const vdByName = new Map(doc.vdatas.map((v) => [v.name, v]));
  const r8ByName = new Map(doc.rasters.map((r) => [r.name, r]));
  const palByName = new Map(doc.palettes.map((p) => [p.name, p]));

  const referencedVgroups = new Set<string>();
  const referencedSds = new Set<string>();
  for (const vg of doc.vgroups) {
    for (const m of vg.members) {
      if (m.kind === "VGROUP") referencedVgroups.add(m.name);
      if (m.kind === "SDS") referencedSds.add(m.name);
    }
  }

  const visitedVgroups = new Set<string>();
  const cycles: string[] = [];

  const buildVgroupNode = (
    name: string,
    depth: number,
    parentPath: string,
    ancestors: Set<string>,
  ): Hdf4HierarchyNode => {
    const vg = vgByName.get(name);
    const nodePath = `${parentPath}/${name}`;
    if (ancestors.has(name)) {
      cycles.push(`${nodePath} (cycle)`);
      return {
        name,
        kind: "VGROUP",
        ref: vg?.ref,
        vgroupClass: vg?.vgroupClass,
        depth,
        path: nodePath,
        cyclic: true,
        children: [],
      };
    }
    visitedVgroups.add(name);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(name);

    const children: Hdf4HierarchyNode[] = [];
    if (vg) {
      for (const m of vg.members) {
        if (m.kind === "VGROUP") {
          children.push(buildVgroupNode(m.name, depth + 1, nodePath, nextAncestors));
        } else if (m.kind === "SDS") {
          const sds = sdsByName.get(m.name);
          children.push({
            name: m.name,
            kind: "SDS",
            ref: sds?.ref ?? m.ref,
            depth: depth + 1,
            path: `${nodePath}/${m.name}`,
            children: [],
          });
        } else if (m.kind === "VDATA") {
          const vd = vdByName.get(m.name);
          children.push({
            name: m.name,
            kind: "VDATA",
            ref: vd?.ref ?? m.ref,
            depth: depth + 1,
            path: `${nodePath}/${m.name}`,
            children: [],
          });
        } else if (m.kind === "RASTER8") {
          const r8 = r8ByName.get(m.name);
          children.push({
            name: m.name,
            kind: "RASTER8",
            ref: r8?.ref ?? m.ref,
            depth: depth + 1,
            path: `${nodePath}/${m.name}`,
            children: [],
          });
        } else if (m.kind === "PALETTE") {
          const pal = palByName.get(m.name);
          children.push({
            name: m.name,
            kind: "PALETTE",
            ref: pal?.ref ?? m.ref,
            depth: depth + 1,
            path: `${nodePath}/${m.name}`,
            children: [],
          });
        } else {
          children.push({
            name: m.name,
            kind: "TAGREF",
            ref: m.ref,
            depth: depth + 1,
            path: `${nodePath}/${m.name}`,
            children: [],
          });
        }
      }
    }

    return {
      name,
      kind: "VGROUP",
      ref: vg?.ref,
      vgroupClass: vg?.vgroupClass,
      depth,
      path: nodePath,
      children,
    };
  };

  const rootChildren: Hdf4HierarchyNode[] = [];

  // Top-level Vgroups (not referenced as children of another Vgroup)
  const topVgroups = doc.vgroups.filter((v) => !referencedVgroups.has(v.name));
  const seedVgroups = topVgroups.length > 0 ? topVgroups : doc.vgroups;
  for (const vg of seedVgroups) {
    if (!visitedVgroups.has(vg.name)) {
      rootChildren.push(buildVgroupNode(vg.name, 1, "", new Set<string>()));
    }
  }
  // Any disconnected cyclic Vgroups
  for (const vg of doc.vgroups) {
    if (!visitedVgroups.has(vg.name)) {
      rootChildren.push(buildVgroupNode(vg.name, 1, "", new Set<string>()));
    }
  }

  // Orphan SDS not in any Vgroup
  const orphanSds: string[] = [];
  for (const sds of doc.sdsList) {
    if (!referencedSds.has(sds.name)) {
      orphanSds.push(sds.name);
      rootChildren.push({
        name: sds.name,
        kind: "SDS",
        ref: sds.ref,
        depth: 1,
        path: `/${sds.name}`,
        children: [],
      });
    }
  }

  return {
    root: {
      name: doc.name,
      kind: "FILE",
      depth: 0,
      path: "/",
      children: rootChildren,
    },
    visitedVgroups: Array.from(visitedVgroups),
    cycles,
    orphanSds,
  };
}

/**
 * Slices an N-dimensional SDS array in row-major (C) order.
 * Each axis in `slices` may be an integer index (drops that axis), a `[start, end)` pair, or `"all"`.
 */
export function sliceSds(sds: Hdf4Sds, slices: Hdf4SliceAxis[]): Hdf4SliceResult {
  const shape = sds.dims.map((d) => d.size);
  const rank = shape.length;
  if (rank === 0) {
    return { shape: [], data: [...sds.data] };
  }

  const strides = new Array<number>(rank).fill(1);
  for (let i = rank - 2; i >= 0; i--) {
    strides[i] = (strides[i + 1] ?? 1) * (shape[i + 1] ?? 1);
  }

  const ranges: Array<{ indices: number[]; keepAxis: boolean }> = [];
  for (let axis = 0; axis < rank; axis++) {
    const dimSize = shape[axis] ?? 0;
    const spec = axis < slices.length ? slices[axis] : "all";
    if (typeof spec === "number") {
      const idx = spec < 0 ? dimSize + spec : spec;
      const clamped = Math.max(0, Math.min(dimSize - 1, idx));
      ranges.push({ indices: dimSize > 0 ? [clamped] : [], keepAxis: false });
    } else if (Array.isArray(spec)) {
      const start = Math.max(0, Math.min(dimSize, spec[0]));
      const end = Math.max(start, Math.min(dimSize, spec[1]));
      const indices: number[] = [];
      for (let k = start; k < end; k++) indices.push(k);
      ranges.push({ indices, keepAxis: true });
    } else {
      const indices: number[] = [];
      for (let k = 0; k < dimSize; k++) indices.push(k);
      ranges.push({ indices, keepAxis: true });
    }
  }

  const outShape: number[] = [];
  for (const r of ranges) {
    if (r.keepAxis) outShape.push(r.indices.length);
  }

  const outData: number[] = [];
  const walk = (axis: number, flatOffset: number): void => {
    if (axis === rank) {
      outData.push(sds.data[flatOffset] ?? 0);
      return;
    }
    const r = ranges[axis];
    const stride = strides[axis] ?? 1;
    if (!r) return;
    for (const idx of r.indices) {
      walk(axis + 1, flatOffset + idx * stride);
    }
  };
  walk(0, 0);

  return { shape: outShape, data: outData };
}

/**
 * Computes exact scientific array statistics (min, max, mean, variance, std, RMS, L2 norm, and optional RMSE).
 */
export function computeSdsStatistics(values: number[], reference?: number[]): Hdf4SdsStatistics {
  const count = values.length;
  let validCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < count; i++) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) continue;
    validCount++;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
  }

  if (validCount === 0) {
    return {
      count,
      validCount: 0,
      min: 0,
      max: 0,
      sum: 0,
      mean: 0,
      variance: 0,
      std: 0,
      sampleStd: 0,
      rms: 0,
      l2Norm: 0,
      rmse: reference ? 0 : undefined,
    };
  }

  const mean = sum / validCount;
  let varAcc = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) continue;
    const diff = v - mean;
    varAcc += diff * diff;
  }

  const variance = varAcc / validCount;
  const std = Math.sqrt(variance);
  const sampleStd = validCount > 1 ? Math.sqrt(varAcc / (validCount - 1)) : 0;
  const rms = Math.sqrt(sumSq / validCount);
  const l2Norm = Math.sqrt(sumSq);

  let rmse: number | undefined;
  if (reference) {
    const n = Math.min(values.length, reference.length);
    if (n > 0) {
      let sqErr = 0;
      let validPairs = 0;
      for (let i = 0; i < n; i++) {
        const a = values[i] ?? Number.NaN;
        const b = reference[i] ?? Number.NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const d = a - b;
        sqErr += d * d;
        validPairs++;
      }
      rmse = validPairs > 0 ? Math.sqrt(sqErr / validPairs) : 0;
    } else {
      rmse = 0;
    }
  }

  return {
    count,
    validCount,
    min,
    max,
    sum,
    mean,
    variance,
    std,
    sampleStd,
    rms,
    l2Norm,
    rmse,
  };
}

/**
 * Runs complete structural and statistical analysis over an `Hdf4Document`.
 */
export function analyzeHdf4Document(doc: Hdf4Document): Hdf4AnalysisReport {
  const hierarchy = traverseVgroupHierarchy(doc);
  const sdsStats: Record<string, Hdf4SdsStatistics> = {};
  let totalSdsElements = 0;
  let estimatedPayloadBytes = 0;

  for (const sds of doc.sdsList) {
    sdsStats[sds.name] = computeSdsStatistics(sds.data);
    totalSdsElements += sds.data.length;
    estimatedPayloadBytes += sds.data.length * (hdf4DataTypeByteWidth(sds.dataType) || 4);
  }
  for (const r of doc.rasters) {
    estimatedPayloadBytes += r.pixels.length;
  }
  for (const p of doc.palettes) {
    estimatedPayloadBytes += p.entries.length;
  }

  return {
    documentName: doc.name,
    hierarchy,
    sdsStats,
    totalSdsElements,
    estimatedPayloadBytes,
  };
}
