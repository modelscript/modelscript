// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeMeshMassProperties,
  tessellateStepSolid,
  type StepFacePatch,
  type StepMeshMassProperties,
  type StepSolidMesh,
  type Vec3,
} from "./occ.js";

export interface StepCaeMesherOptions {
  /** Circumferential/parametric subdivision count for curved B-Rep edges and surfaces (default: 12). */
  segments?: number | undefined;
  /** Number of concentric interior radial layers for tetrahedral volume subdivision (default: 2). */
  layers?: number | undefined;
  /** Explicit volume element type override ("C3D4" tetrahedral default for B-Rep, "C3D8" hexahedral fallback). */
  elementType?: "C3D4" | "C3D8" | undefined;
  /** Material density in kg/m³ (default: 2700.0 for structural aluminum alloy). */
  density?: number | undefined;
  /** Nominal structural tip load in Newtons for FEA study setup (default: 100.0). */
  nominalLoadN?: number | undefined;
  /** Material yield strength in Pascals (default: 250.0e6). */
  yieldLimitPa?: number | undefined;
  /** Freestream velocity in m/s for CFD setup (default: 10.0). */
  freestreamVelocity?: number | undefined;
  /** Source STEP filename for header comments. */
  filename?: string | undefined;
  /** Base model identifier for generated decks. */
  baseName?: string | undefined;
}

export interface StepBoundaryPatchMesh {
  /** Sanitized topological patch name from `ADVANCED_FACE` (e.g., `TopFaceWithHole`, `inlet`, `MountingFace`). */
  name: string;
  /** Original raw name from the STEP entity. */
  rawName: string;
  /** STEP entity ID (e.g., `#60`). */
  faceId: string;
  /** Underlying surface geometry type (`PLANE`, `CYLINDRICAL_SURFACE`, etc.). */
  surfaceType: string;
  /** 1-based global node IDs belonging to this face patch (for CalculiX `*NSET`). */
  nodeIds: number[];
  /** 1-based volume element IDs sharing a boundary facet with this patch (for CalculiX `*ELSET`). */
  elementIds: number[];
  /** 0-based surface triangle vertex indices `[n0, n1, n2]` (for SU2 `MARKER_TAG=` with `VTK_TRIANGLE = 5`). */
  triangles: [number, number, number][];
  /** True surface area of this topological patch [m²]. */
  area: number;
  /** Area-weighted outward unit normal vector. */
  normal: Vec3;
}

export interface ConformingStepMeshResult {
  solidMesh: StepSolidMesh;
  massProperties: StepMeshMassProperties;
  /** 0-indexed 3D vertex coordinates `[x, y, z]` in meters. */
  nodes: Vec3[];
  /** 0-indexed 4-node tetrahedral volume elements `[n0, n1, n2, n3]` with positive Jacobian volume (`C3D4` / `VTK_TETRA = 10`). */
  tetrahedra: [number, number, number, number][];
  /** 0-indexed 8-node hexahedral volume elements (`C3D8` / `VTK_HEXAHEDRON = 12`). */
  hexahedra: [number, number, number, number, number, number, number, number][];
  /** Named B-Rep topological face patches mapped to surface nodes, boundary triangles, and adjacent volume elements. */
  boundaryPatches: StepBoundaryPatchMesh[];
  /** Primary volume element type emitted in `.inp` (`C3D4` for B-Rep solids, `C3D8` for point-cloud fallback). */
  elementType: "C3D4" | "C3D8";
  /** True polyhedral volume of the discretized solid [m³]. */
  totalVolume: number;
  /** Total wetted B-Rep surface area [m²]. */
  totalSurfaceArea: number;
  /** Projected frontal cross-sectional areas along principal axes [m²]. */
  crossSectionArea: { yz: number; xz: number; xy: number };
  /** Characteristic streamwise / structural span length [m]. */
  characteristicLength: number;
  /** True B-Rep elastic section modulus $Z = I / c$ [m³]. */
  sectionModulus: number;
  /** Estimated peak von Mises / bending stress under nominal load [Pa]. */
  estimatedStressPa: number;
  /** Estimated aerodynamic drag coefficient $C_d$ from B-Rep wetted area and fineness ratio. */
  estimatedDragCoeff: number;
  /** CalculiX / Abaqus `.inp` FEA mesh deck with `*NSET` and `*ELSET` per `ADVANCED_FACE`. */
  inpDeck: string;
  /** SU2 `.su2` 3D volume mesh with `MARKER_TAG=` boundary patches. */
  su2Mesh: string;
  /** SU2 `.cfg` solver configuration deck parameterized by B-Rep reference area and length. */
  su2Config: string;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function tetSignedVolume6(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  return dot3(sub3(p1, p0), cross3(sub3(p2, p0), sub3(p3, p0)));
}

function sanitizePatchName(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

function formatIdRows(ids: number[], perLine = 16): string {
  const lines: string[] = [];
  for (let i = 0; i < ids.length; i += perLine) {
    lines.push(ids.slice(i, i + perLine).join(", "));
  }
  return lines.join("\n");
}

/**
 * Generates a conforming 3D tetrahedral (`C3D4` / `VTK_TETRA`) and hexahedral (`C3D8`) volume mesh
 * from an ISO 10303-21 STEP B-Rep model, preserving named `ADVANCED_FACE` topological patches as
 * `.inp` `*NSET`/`*ELSET` sets and `.su2` `MARKER_TAG=` boundary markers.
 */
export function generateConformingStepMesh(
  stepTextOrMesh: string | StepSolidMesh,
  options?: StepCaeMesherOptions,
): ConformingStepMeshResult {
  const stepText = typeof stepTextOrMesh === "string" ? stepTextOrMesh : "";
  const lengthScale = stepText && /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(stepText) ? 1e-3 : 1.0;
  const segments = Math.max(8, options?.segments ?? 12);
  const layers = Math.max(1, Math.min(4, options?.layers ?? 2));
  const density = options?.density ?? 2700.0;
  const nominalLoadN = options?.nominalLoadN ?? 100.0;
  const yieldLimitPa = options?.yieldLimitPa ?? 250.0e6;
  const freestreamVelocity = options?.freestreamVelocity ?? 10.0;
  const filename = options?.filename ?? "part.step";
  const baseName = options?.baseName ?? (filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") || "part");

  const solidMesh =
    typeof stepTextOrMesh === "string" ? tessellateStepSolid(stepTextOrMesh, { segments }) : stepTextOrMesh;

  const hasBrepFaces = solidMesh.triangleCount > 0 && solidMesh.faces.length > 0;

  if (hasBrepFaces && options?.elementType !== "C3D8") {
    return buildBrepConformingTetMesh({
      solidMesh,
      lengthScale,
      layers,
      density,
      nominalLoadN,
      yieldLimitPa,
      freestreamVelocity,
      filename,
      baseName,
    });
  }

  return buildFallbackHexAndTetMesh({
    stepText,
    solidMesh,
    lengthScale,
    density,
    nominalLoadN,
    yieldLimitPa,
    freestreamVelocity,
    filename,
    baseName,
    preferElementType: options?.elementType ?? (hasBrepFaces ? "C3D4" : "C3D8"),
  });
}

function buildBrepConformingTetMesh(params: {
  solidMesh: StepSolidMesh;
  lengthScale: number;
  layers: number;
  density: number;
  nominalLoadN: number;
  yieldLimitPa: number;
  freestreamVelocity: number;
  filename: string;
  baseName: string;
}): ConformingStepMeshResult {
  const {
    solidMesh,
    lengthScale,
    layers,
    density,
    nominalLoadN,
    yieldLimitPa,
    freestreamVelocity,
    filename,
    baseName,
  } = params;

  const massProperties = computeMeshMassProperties(solidMesh, { lengthScale, density });

  const bMin: Vec3 = [
    solidMesh.boundingBox.min[0] * lengthScale,
    solidMesh.boundingBox.min[1] * lengthScale,
    solidMesh.boundingBox.min[2] * lengthScale,
  ];
  const bMax: Vec3 = [
    solidMesh.boundingBox.max[0] * lengthScale,
    solidMesh.boundingBox.max[1] * lengthScale,
    solidMesh.boundingBox.max[2] * lengthScale,
  ];
  const diag = Math.hypot(bMax[0] - bMin[0], bMax[1] - bMin[1], bMax[2] - bMin[2]) || 1.0;
  const weldTol = Math.max(1e-7, diag * 1e-5);
  const invTol = 1.0 / weldTol;

  const nodes: Vec3[] = [];
  const spatialHash = new Map<string, number>();

  const weldVertex = (p: Vec3): number => {
    const kx = Math.round(p[0] * invTol);
    const ky = Math.round(p[1] * invTol);
    const kz = Math.round(p[2] * invTol);
    const key = `${kx},${ky},${kz}`;
    const existing = spatialHash.get(key);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodes.push(p);
    spatialHash.set(key, idx);
    return idx;
  };

  interface FaceTriRecord {
    n0: number;
    n1: number;
    n2: number;
    patchIdx: number;
  }

  const boundaryPatches: StepBoundaryPatchMesh[] = [];
  const usedPatchNames = new Set<string>();
  const targetSolids = solidMesh.solids.length > 0 ? solidMesh.solids : [solidMesh];

  const tetrahedra: [number, number, number, number][] = [];
  const addOrientedTet = (a: number, b: number, c: number, d: number): number | null => {
    if (a === b || a === c || a === d || b === c || b === d || c === d) return null;
    const pa = nodes[a]!;
    const pb = nodes[b]!;
    const pc = nodes[c]!;
    const pd = nodes[d]!;
    const v6 = tetSignedVolume6(pa, pb, pc, pd);
    if (Math.abs(v6) <= 1e-16) return null;
    const tet: [number, number, number, number] = v6 > 0 ? [a, b, c, d] : [a, c, b, d];
    tetrahedra.push(tet);
    return tetrahedra.length; // 1-based element ID
  };

  for (let sIdx = 0; sIdx < targetSolids.length; sIdx++) {
    const subSolid = targetSolids[sIdx]!;
    const subProps = computeMeshMassProperties(subSolid, { lengthScale, density });
    let centerPt: Vec3 = [subProps.centerOfMass[0], subProps.centerOfMass[1], subProps.centerOfMass[2]];

    // Ensure solid interior apex is non-coplanar with planar faces (e.g. single-face or open shells)
    const subMin: Vec3 = [
      subSolid.boundingBox.min[0] * lengthScale,
      subSolid.boundingBox.min[1] * lengthScale,
      subSolid.boundingBox.min[2] * lengthScale,
    ];
    const subMax: Vec3 = [
      subSolid.boundingBox.max[0] * lengthScale,
      subSolid.boundingBox.max[1] * lengthScale,
      subSolid.boundingBox.max[2] * lengthScale,
    ];
    const sx = subMax[0] - subMin[0];
    const sy = subMax[1] - subMin[1];
    const sz = subMax[2] - subMin[2];
    const maxSpan = Math.max(sx, sy, sz, 1e-3);
    const minSpan = Math.min(sx, sy, sz);

    const solidSurfaceVerts = new Set<number>();
    const solidTris: FaceTriRecord[] = [];

    for (let fIdx = 0; fIdx < subSolid.faces.length; fIdx++) {
      const face: StepFacePatch = subSolid.faces[fIdx]!;
      const rawName = face.faceName || `face_${face.faceId.replace("#", "")}`;
      let basePatchName = sanitizePatchName(rawName, `face_${boundaryPatches.length + 1}`);
      if (usedPatchNames.has(basePatchName)) {
        basePatchName = `${basePatchName}_${face.faceId.replace("#", "")}`;
      }
      usedPatchNames.add(basePatchName);

      const patchNodeSet = new Set<number>();
      const patchTris: [number, number, number][] = [];
      let patchArea = 0;
      let nxSum = 0;
      let nySum = 0;
      let nzSum = 0;

      for (let i = 0; i + 2 < face.indices.length; i += 3) {
        const i0 = face.indices[i]! * 3;
        const i1 = face.indices[i + 1]! * 3;
        const i2 = face.indices[i + 2]! * 3;
        const p0: Vec3 = [
          face.vertices[i0]! * lengthScale,
          face.vertices[i0 + 1]! * lengthScale,
          face.vertices[i0 + 2]! * lengthScale,
        ];
        const p1: Vec3 = [
          face.vertices[i1]! * lengthScale,
          face.vertices[i1 + 1]! * lengthScale,
          face.vertices[i1 + 2]! * lengthScale,
        ];
        const p2: Vec3 = [
          face.vertices[i2]! * lengthScale,
          face.vertices[i2 + 1]! * lengthScale,
          face.vertices[i2 + 2]! * lengthScale,
        ];

        const g0 = weldVertex(p0);
        const g1 = weldVertex(p1);
        const g2 = weldVertex(p2);
        patchNodeSet.add(g0 + 1);
        patchNodeSet.add(g1 + 1);
        patchNodeSet.add(g2 + 1);
        solidSurfaceVerts.add(g0);
        solidSurfaceVerts.add(g1);
        solidSurfaceVerts.add(g2);

        if (g0 === g1 || g1 === g2 || g0 === g2) continue;
        const nVec = cross3(sub3(p1, p0), sub3(p2, p0));
        const area = 0.5 * Math.hypot(nVec[0], nVec[1], nVec[2]);
        if (area <= 1e-16) continue;

        patchArea += area;
        nxSum += nVec[0] * 0.5;
        nySum += nVec[1] * 0.5;
        nzSum += nVec[2] * 0.5;

        patchTris.push([g0, g1, g2]);
        solidTris.push({ n0: g0, n1: g1, n2: g2, patchIdx: boundaryPatches.length });
      }

      const nLen = Math.hypot(nxSum, nySum, nzSum);
      const avgNormal: Vec3 = nLen > 1e-12 ? [nxSum / nLen, nySum / nLen, nzSum / nLen] : [0, 0, 1];

      boundaryPatches.push({
        name: basePatchName,
        rawName,
        faceId: face.faceId,
        surfaceType: face.surfaceType,
        nodeIds: [...patchNodeSet].sort((a, b) => a - b),
        elementIds: [],
        triangles: patchTris,
        area: patchArea,
        normal: avgNormal,
      });
    }

    if (solidTris.length === 0) continue;

    // If the B-Rep shell is a planar sheet (minSpan ~ 0), offset centerPt along normal so interior tets have 3D thickness
    if (minSpan < 1e-5 * maxSpan) {
      const pNormal = boundaryPatches[boundaryPatches.length - 1]?.normal ?? [0, 0, 1];
      const offsetDepth = 0.1 * maxSpan;
      centerPt = [
        centerPt[0] - pNormal[0] * offsetDepth,
        centerPt[1] - pNormal[1] * offsetDepth,
        centerPt[2] - pNormal[2] * offsetDepth,
      ];
    }

    const centerNodeIdx = nodes.length;
    nodes.push(centerPt);

    // Create concentric interior vertex layers between centerPt (layer 0) and welded surface vertices (layer `layers`)
    // layerMap[layerIdx] maps surface vertex index -> global node index at radial fraction (layerIdx / layers)
    const layerMaps: Map<number, number>[] = [];
    for (let l = 1; l < layers; l++) {
      const alpha = l / layers;
      const lMap = new Map<number, number>();
      for (const surfV of solidSurfaceVerts) {
        const sp = nodes[surfV]!;
        const innerPt: Vec3 = [
          centerPt[0] + alpha * (sp[0] - centerPt[0]),
          centerPt[1] + alpha * (sp[1] - centerPt[1]),
          centerPt[2] + alpha * (sp[2] - centerPt[2]),
        ];
        const idx = nodes.length;
        nodes.push(innerPt);
        lMap.set(surfV, idx);
      }
      layerMaps.push(lMap);
    }

    const getLayerNode = (surfV: number, layerIdx: number): number => {
      if (layerIdx >= layers) return surfV;
      return layerMaps[layerIdx - 1]!.get(surfV)!;
    };

    // Subdivide each surface triangle into conforming prism layers (3 C3D4 tets per layer using Dompierre
    // canonical vertex-ID ordering) plus 1 inner core C3D4 tetrahedron connected to centerNodeIdx
    for (const tri of solidTris) {
      // Canonical ordering u < v < w guarantees matching diagonal splits across all shared inter-element quad faces
      const sorted = [tri.n0, tri.n1, tri.n2].sort((a, b) => a - b) as [number, number, number];
      const [u, v, w] = sorted;

      // Innermost core tetrahedron: (centerNodeIdx, u_1, v_1, w_1)
      const uInner = getLayerNode(u, 1);
      const vInner = getLayerNode(v, 1);
      const wInner = getLayerNode(w, 1);
      const coreId = addOrientedTet(centerNodeIdx, uInner, vInner, wInner);
      if (coreId !== null && layers === 1) {
        boundaryPatches[tri.patchIdx]!.elementIds.push(coreId);
      }

      // Concentric prism layers from l = 1 .. layers - 1
      for (let l = 1; l < layers; l++) {
        const a0 = getLayerNode(u, l);
        const b0 = getLayerNode(v, l);
        const c0 = getLayerNode(w, l);
        const a1 = getLayerNode(u, l + 1);
        const b1 = getLayerNode(v, l + 1);
        const c1 = getLayerNode(w, l + 1);

        const e1 = addOrientedTet(a0, b0, c0, c1);
        const e2 = addOrientedTet(a0, b0, c1, b1);
        const e3 = addOrientedTet(a0, a1, b1, c1);

        if (l === layers - 1) {
          // e3 has facet (a1, b1, c1) lying directly on the outer B-Rep ADVANCED_FACE patch
          if (e3 !== null) boundaryPatches[tri.patchIdx]!.elementIds.push(e3);
          else if (e2 !== null) boundaryPatches[tri.patchIdx]!.elementIds.push(e2);
          else if (e1 !== null) boundaryPatches[tri.patchIdx]!.elementIds.push(e1);
        }
      }
    }
  }

  for (const patch of boundaryPatches) {
    patch.elementIds = [...new Set(patch.elementIds)].sort((a, b) => a - b);
  }

  // Compute true volume from generated tetrahedra
  let tetVolumeSum = 0;
  for (const [n0, n1, n2, n3] of tetrahedra) {
    tetVolumeSum += Math.abs(tetSignedVolume6(nodes[n0]!, nodes[n1]!, nodes[n2]!, nodes[n3]!)) / 6.0;
  }
  const totalVolume = massProperties.volume > 0 ? massProperties.volume : tetVolumeSum;
  const totalSurfaceArea = massProperties.surfaceArea;

  // Dimensions & structural/aerodynamic parameters from true B-Rep geometry
  const dx = Math.max(bMax[0] - bMin[0], 1e-3);
  const dy = Math.max(bMax[1] - bMin[1], 1e-3);
  const dz = Math.max(bMax[2] - bMin[2], 1e-3);
  const sortedDims = [dx, dy, dz].sort((a, b) => b - a);
  const characteristicLength = sortedDims[0]!;
  const halfDepthC = Math.max(sortedDims[2]! * 0.5, 1e-4);

  // True B-Rep cross-section area and second moment of area from polyhedral covariance C
  const effectiveCrossArea = Math.max(totalVolume / characteristicLength, 1e-8);
  const covDiag = [
    massProperties.covarianceMatrix[0][0],
    massProperties.covarianceMatrix[1][1],
    massProperties.covarianceMatrix[2][2],
  ].sort((a, b) => a - b);
  // Second moment of cross-section I_cross = C_min / characteristicLength (or b*h³/12 equivalent from effectiveCrossArea)
  const iCrossFromCov = covDiag[0]! > 1e-16 ? covDiag[0]! / characteristicLength : 0;
  const iCrossFromArea = (effectiveCrossArea * Math.pow(halfDepthC * 2, 2)) / 12.0;
  const iCross = Math.max(iCrossFromCov, iCrossFromArea, 1e-12);
  const sectionModulus = Math.max(iCross / halfDepthC, 1e-9);
  const estimatedStressPa = Number(((nominalLoadN * characteristicLength) / sectionModulus).toFixed(1));

  const frontalArea = Math.max(
    massProperties.crossSectionArea.yz,
    Math.min(massProperties.crossSectionArea.xz, massProperties.crossSectionArea.xy),
    1e-6,
  );
  const finenessRatio = characteristicLength / Math.max(Math.sqrt((4 * frontalArea) / Math.PI), 1e-4);
  const wettedRatio = totalSurfaceArea / Math.max(frontalArea, 1e-6);
  const skinFrictionCf = 0.0045;
  const formDrag = 0.04 + 0.55 / Math.max(finenessRatio, 0.5);
  const estimatedDragCoeff = Number(Math.min(Math.max(skinFrictionCf * wettedRatio + formDrag, 0.06), 1.25).toFixed(4));

  // Select support (root) and load (tip) node sets from named B-Rep patches or coordinate extremes
  const rootPatch = boundaryPatches.find((p) =>
    /(?:root|fixed|support|mount|base|clamp|inlet|west|left)/i.test(p.name),
  );
  const tipPatch = boundaryPatches.find(
    (p) => p !== rootPatch && /(?:tip|load|force|outlet|east|right|top|free)/i.test(p.name),
  );

  let rootNodes = rootPatch && rootPatch.nodeIds.length > 0 ? rootPatch.nodeIds : [];
  let tipNodes = tipPatch && tipPatch.nodeIds.length > 0 ? tipPatch.nodeIds : [];

  if (rootNodes.length === 0 || tipNodes.length === 0) {
    const xTol = Math.max(dx * 0.08, 1e-5);
    const fallbackRoot: number[] = [];
    const fallbackTip: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const x = nodes[i]![0];
      if (Math.abs(x - bMin[0]) <= xTol) fallbackRoot.push(i + 1);
      if (Math.abs(x - bMax[0]) <= xTol) fallbackTip.push(i + 1);
    }
    if (rootNodes.length === 0) rootNodes = fallbackRoot.length > 0 ? fallbackRoot : [1];
    if (tipNodes.length === 0) tipNodes = fallbackTip.length > 0 ? fallbackTip : [nodes.length];
  }

  // Format CalculiX .inp deck
  const nodeLines = nodes.map((pt, i) => `${i + 1}, ${pt[0].toFixed(6)}, ${pt[1].toFixed(6)}, ${pt[2].toFixed(6)}`);
  const elemLines = tetrahedra.map((tet, i) => `${i + 1}, ${tet[0] + 1}, ${tet[1] + 1}, ${tet[2] + 1}, ${tet[3] + 1}`);

  const patchSetBlocks: string[] = [];
  for (const patch of boundaryPatches) {
    const safeUpper = patch.name.toUpperCase();
    if (patch.nodeIds.length > 0) {
      patchSetBlocks.push(`*NSET, NSET=${safeUpper}\n${formatIdRows(patch.nodeIds)}`);
    }
    if (patch.elementIds.length > 0) {
      patchSetBlocks.push(`*ELSET, ELSET=ELSET_${safeUpper}\n${formatIdRows(patch.elementIds)}`);
    }
  }
  patchSetBlocks.push(`*NSET, NSET=NROOT\n${formatIdRows(rootNodes)}`);
  patchSetBlocks.push(`*NSET, NSET=NTIP\n${formatIdRows(tipNodes)}`);

  const boundaryLines = rootNodes.map((nid) => `${nid}, 1, 3, 0.0`);
  const loadPerTipNode = Number((nominalLoadN / Math.max(tipNodes.length, 1)).toFixed(4));
  const cloadLines = tipNodes.map((nid) => `${nid}, 3, ${loadPerTipNode}`);

  const inpDeck = [
    `** CalculiX FEA Conforming Tetrahedral Mesh Deck generated from B-Rep CAD: ${filename}`,
    `*HEADING`,
    `Conforming 3D C3D4 Tetrahedral Mesh for ${baseName} (V=${totalVolume.toExponential(4)} m^3, A=${totalSurfaceArea.toExponential(4)} m^2)`,
    `*NODE, NSET=NALL`,
    nodeLines.join("\n"),
    `*ELEMENT, TYPE=C3D4, ELSET=ESOLID`,
    elemLines.join("\n"),
    ...patchSetBlocks,
    `*MATERIAL, NAME=STRUCTURAL_ALLOY`,
    `*ELASTIC`,
    `7.0e10, 0.33`,
    `*DENSITY`,
    `${density.toFixed(1)}`,
    `*PLASTIC`,
    `${yieldLimitPa.toExponential(2)}, 0.0`,
    `*SOLID SECTION, ELSET=ESOLID, MATERIAL=STRUCTURAL_ALLOY`,
    `*BOUNDARY`,
    boundaryLines.join("\n"),
    `*STEP`,
    `*STATIC`,
    `*CLOAD`,
    cloadLines.join("\n"),
    `*END STEP`,
    ``,
  ].join("\n");

  // Format SU2 .su2 volume mesh preserving named ADVANCED_FACE markers + standard wall/inlet/outlet markers
  const su2ElemLines = tetrahedra.map((tet, i) => `10 ${tet[0]} ${tet[1]} ${tet[2]} ${tet[3]} ${i}`);
  const su2PointLines = nodes.map((pt, i) => `${pt[0].toFixed(6)} ${pt[1].toFixed(6)} ${pt[2].toFixed(6)} ${i}`);

  const markerMap = new Map<string, [number, number, number][]>();
  for (const patch of boundaryPatches) {
    if (patch.triangles.length > 0) {
      markerMap.set(patch.name, patch.triangles);
    }
  }

  // Ensure standard CFD boundary tags (wall, inlet, outlet) are also populated if not explicitly named
  const allSurfTris = boundaryPatches.flatMap((p) => p.triangles);
  if (!markerMap.has("wall") && allSurfTris.length > 0) {
    markerMap.set("wall", allSurfTris);
  }
  if (!markerMap.has("inlet") && allSurfTris.length > 0) {
    const inletTris = rootPatch && rootPatch.triangles.length > 0 ? rootPatch.triangles : [allSurfTris[0]!];
    markerMap.set("inlet", inletTris);
  }
  if (!markerMap.has("outlet") && allSurfTris.length > 0) {
    const outletTris =
      tipPatch && tipPatch.triangles.length > 0 ? tipPatch.triangles : [allSurfTris[allSurfTris.length - 1]!];
    markerMap.set("outlet", outletTris);
  }

  const markerLines: string[] = [`NMARK= ${markerMap.size}`];
  for (const [tag, tris] of markerMap.entries()) {
    markerLines.push(`MARKER_TAG= ${tag}`);
    markerLines.push(`MARKER_ELEMS= ${tris.length}`);
    for (const [t0, t1, t2] of tris) {
      markerLines.push(`5 ${t0} ${t1} ${t2}`);
    }
  }

  const su2Mesh = [
    `% SU2 3D Conforming Tetrahedral Volume Mesh generated from STEP B-Rep: ${filename}`,
    `NDIME= 3`,
    `NELEM= ${su2ElemLines.length}`,
    ...su2ElemLines,
    `NPOIN= ${su2PointLines.length}`,
    ...su2PointLines,
    ...markerLines,
    ``,
  ].join("\n");

  const refArea = Number(frontalArea.toFixed(6));
  const refLength = Number(characteristicLength.toFixed(4));
  const su2Config = `% SU2 Aerodynamic Configuration generated from CAD: ${filename}\nSOLVER= INC_RANS\nKIND_TURB_MODEL= SST\nMATH_PROBLEM= DIRECT\nMESH_FILENAME= ${baseName}_mesh.su2\nINC_DENSITY_INIT= 1.225\nINC_VELOCITY_INIT= ( ${freestreamVelocity.toFixed(1)}, 0.0, 0.0 )\nREF_LENGTH= ${refLength}\nREF_AREA= ${refArea}\nMARKER_HEATFLUX= ( wall, 0.0 )\nMARKER_INLET= ( inlet, 288.15, ${freestreamVelocity.toFixed(1)}, 1.0, 0.0, 0.0 )\nMARKER_OUTLET= ( outlet, 101325.0 )\nITER= 250\n`;

  return {
    solidMesh,
    massProperties,
    nodes,
    tetrahedra,
    hexahedra: [],
    boundaryPatches,
    elementType: "C3D4",
    totalVolume,
    totalSurfaceArea,
    crossSectionArea: massProperties.crossSectionArea,
    characteristicLength,
    sectionModulus,
    estimatedStressPa,
    estimatedDragCoeff,
    inpDeck,
    su2Mesh,
    su2Config,
  };
}

function buildFallbackHexAndTetMesh(params: {
  stepText: string;
  solidMesh: StepSolidMesh;
  lengthScale: number;
  density: number;
  nominalLoadN: number;
  yieldLimitPa: number;
  freestreamVelocity: number;
  filename: string;
  baseName: string;
  preferElementType: "C3D4" | "C3D8";
}): ConformingStepMeshResult {
  const {
    stepText,
    solidMesh,
    lengthScale,
    density,
    nominalLoadN,
    freestreamVelocity,
    filename,
    baseName,
    preferElementType,
  } = params;

  const ptRegex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let ptCount = 0;
  let m: RegExpExecArray | null;
  while ((m = ptRegex.exec(stepText)) !== null) {
    const x = parseFloat(m[1]!) * lengthScale;
    const y = parseFloat(m[2]!) * lengthScale;
    const z = parseFloat(m[3]!) * lengthScale;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    ptCount++;
  }

  if (ptCount < 2 || !(maxX > minX || maxY > minY || maxZ > minZ)) {
    minX = 0.0;
    maxX = 0.2;
    minY = -0.02;
    maxY = 0.02;
    minZ = 0.0;
    maxZ = 0.01;
  } else {
    if (maxX - minX < 1e-4) {
      minX -= 0.005;
      maxX += 0.005;
    }
    if (maxY - minY < 1e-4) {
      minY -= 0.005;
      maxY += 0.005;
    }
    if (maxZ - minZ < 1e-4) {
      minZ -= 0.005;
      maxZ += 0.005;
    }
  }

  const nx = 3;
  const ny = 2;
  const nz = 2;
  const nodes: Vec3[] = [];
  const rootNodes: number[] = [];
  const tipNodes: number[] = [];
  const nodeIdxAt = (ix: number, iy: number, iz: number) => ix + iy * (nx + 1) + iz * (nx + 1) * (ny + 1);

  for (let iz = 0; iz <= nz; iz++) {
    const z = minZ + (iz / nz) * (maxZ - minZ);
    for (let iy = 0; iy <= ny; iy++) {
      const y = minY + (iy / ny) * (maxY - minY);
      for (let ix = 0; ix <= nx; ix++) {
        const x = minX + (ix / nx) * (maxX - minX);
        const idx = nodeIdxAt(ix, iy, iz);
        nodes.push([x, y, z]);
        if (ix === 0) rootNodes.push(idx + 1);
        if (ix === nx) tipNodes.push(idx + 1);
      }
    }
  }

  const hexahedra: [number, number, number, number, number, number, number, number][] = [];
  const tetrahedra: [number, number, number, number][] = [];
  const inletTris: [number, number, number][] = [];
  const outletTris: [number, number, number][] = [];
  const wallTris: [number, number, number][] = [];

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const n0 = nodeIdxAt(ix, iy, iz);
        const n1 = nodeIdxAt(ix + 1, iy, iz);
        const n2 = nodeIdxAt(ix + 1, iy + 1, iz);
        const n3 = nodeIdxAt(ix, iy + 1, iz);
        const n4 = nodeIdxAt(ix, iy, iz + 1);
        const n5 = nodeIdxAt(ix + 1, iy, iz + 1);
        const n6 = nodeIdxAt(ix + 1, iy + 1, iz + 1);
        const n7 = nodeIdxAt(ix, iy + 1, iz + 1);
        hexahedra.push([n0, n1, n2, n3, n4, n5, n6, n7]);

        // 6-tet Kuhn freudenthal decomposition of each hexahedron
        tetrahedra.push(
          [n0, n1, n2, n6],
          [n0, n1, n6, n5],
          [n0, n4, n5, n6],
          [n0, n2, n3, n6],
          [n0, n3, n7, n6],
          [n0, n4, n6, n7],
        );

        if (ix === 0) {
          inletTris.push([n0, n3, n7], [n0, n7, n4]);
        }
        if (ix === nx - 1) {
          outletTris.push([n1, n2, n6], [n1, n6, n5]);
        }
        if (iz === 0) {
          wallTris.push([n0, n1, n2], [n0, n2, n3]);
        }
      }
    }
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const totalVolume = dx * dy * dz;
  const totalSurfaceArea = 2 * (dx * dy + dy * dz + dx * dz);
  const mass = totalVolume * density;
  const com: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

  const massProperties: StepMeshMassProperties = {
    volume: totalVolume,
    surfaceArea: totalSurfaceArea,
    mass,
    density,
    centerOfMass: com,
    covarianceMatrix: [
      [(totalVolume * dx * dx) / 12, 0, 0],
      [0, (totalVolume * dy * dy) / 12, 0],
      [0, 0, (totalVolume * dz * dz) / 12],
    ],
    inertiaTensor: {
      I_11: (mass * (dy * dy + dz * dz)) / 12,
      I_22: (mass * (dx * dx + dz * dz)) / 12,
      I_33: (mass * (dx * dx + dy * dy)) / 12,
      I_21: 0,
      I_31: 0,
      I_32: 0,
    },
    inertiaMatrix: [
      [(mass * (dy * dy + dz * dz)) / 12, 0, 0],
      [0, (mass * (dx * dx + dz * dz)) / 12, 0],
      [0, 0, (mass * (dx * dx + dy * dy)) / 12],
    ],
    crossSectionArea: {
      yz: dy * dz,
      xz: dx * dz,
      xy: dx * dy,
    },
  };

  const dims = [dx, dy, dz].sort((a, b) => b - a);
  const spanL = dims[0]!;
  const widthB = dims[1]!;
  const heightH = dims[2]!;
  const sectionModulus = Math.max((widthB * heightH * heightH) / 6.0, 1e-9);
  const estimatedStressPa = Number(((nominalLoadN * spanL) / sectionModulus).toFixed(1));
  const refArea = Math.max(1e-6, Number((dy * dz).toFixed(6)));
  const finenessRatio = dx / Math.max(Math.sqrt(refArea), 1e-4);
  const estimatedDragCoeff = Number(
    Math.min(Math.max(0.05 + 0.65 / Math.max(finenessRatio, 0.5), 0.08), 1.15).toFixed(4),
  );

  const boundaryPatches: StepBoundaryPatchMesh[] = [
    {
      name: "inlet",
      rawName: "inlet",
      faceId: "#inlet",
      surfaceType: "PLANE",
      nodeIds: rootNodes,
      elementIds: [1, 4, 7, 10],
      triangles: inletTris,
      area: dy * dz,
      normal: [-1, 0, 0],
    },
    {
      name: "outlet",
      rawName: "outlet",
      faceId: "#outlet",
      surfaceType: "PLANE",
      nodeIds: tipNodes,
      elementIds: [3, 6, 9, 12],
      triangles: outletTris,
      area: dy * dz,
      normal: [1, 0, 0],
    },
    {
      name: "wall",
      rawName: "wall",
      faceId: "#wall",
      surfaceType: "PLANE",
      nodeIds: Array.from({ length: (nx + 1) * (ny + 1) }, (_, k) => k + 1),
      elementIds: [1, 2, 3, 4, 5, 6],
      triangles: wallTris,
      area: dx * dy,
      normal: [0, 0, -1],
    },
  ];

  const nodeLines = nodes.map((pt, i) => `${i + 1}, ${pt[0].toFixed(6)}, ${pt[1].toFixed(6)}, ${pt[2].toFixed(6)}`);
  const elemLines =
    preferElementType === "C3D4"
      ? tetrahedra.map((t, i) => `${i + 1}, ${t[0] + 1}, ${t[1] + 1}, ${t[2] + 1}, ${t[3] + 1}`)
      : hexahedra.map(
          (h, i) =>
            `${i + 1}, ${h[0] + 1}, ${h[1] + 1}, ${h[2] + 1}, ${h[3] + 1}, ${h[4] + 1}, ${h[5] + 1}, ${h[6] + 1}, ${h[7] + 1}`,
        );

  const boundaryLines = rootNodes.map((nid) => `${nid}, 1, 3, 0.0`);
  const loadPerTipNode = Number((nominalLoadN / Math.max(tipNodes.length, 1)).toFixed(4));
  const cloadLines = tipNodes.map((nid) => `${nid}, 3, ${loadPerTipNode}`);

  const inpDeck = `** CalculiX FEA Mesh Deck generated from CAD: ${filename}\n*HEADING\nDiscretized 3D ${preferElementType} Mesh for ${baseName}\n*NODE, NSET=NALL\n${nodeLines.join("\n")}\n*ELEMENT, TYPE=${preferElementType}, ELSET=ESOLID\n${elemLines.join("\n")}\n*NSET, NSET=NROOT\n${formatIdRows(rootNodes)}\n*NSET, NSET=NTIP\n${formatIdRows(tipNodes)}\n*MATERIAL, NAME=STRUCTURAL_ALLOY\n*ELASTIC\n7.0e10, 0.33\n*DENSITY\n${density.toFixed(1)}\n*PLASTIC\n250.0e6, 0.0\n*SOLID SECTION, ELSET=ESOLID, MATERIAL=STRUCTURAL_ALLOY\n*BOUNDARY\n${boundaryLines.join("\n")}\n*STEP\n*STATIC\n*CLOAD\n${cloadLines.join("\n")}\n*END STEP\n`;

  const su2ElemLines = tetrahedra.map((t, i) => `10 ${t[0]} ${t[1]} ${t[2]} ${t[3]} ${i}`);
  const su2PointLines = nodes.map((pt, i) => `${pt[0].toFixed(6)} ${pt[1].toFixed(6)} ${pt[2].toFixed(6)} ${i}`);
  const su2Mesh = [
    `% SU2 3D Volume Mesh generated from STEP CAD: ${filename}`,
    `NDIME= 3`,
    `NELEM= ${su2ElemLines.length}`,
    ...su2ElemLines,
    `NPOIN= ${su2PointLines.length}`,
    ...su2PointLines,
    `NMARK= 3`,
    `MARKER_TAG= wall`,
    `MARKER_ELEMS= ${wallTris.length}`,
    ...wallTris.map(([a, b, c]) => `5 ${a} ${b} ${c}`),
    `MARKER_TAG= inlet`,
    `MARKER_ELEMS= ${inletTris.length}`,
    ...inletTris.map(([a, b, c]) => `5 ${a} ${b} ${c}`),
    `MARKER_TAG= outlet`,
    `MARKER_ELEMS= ${outletTris.length}`,
    ...outletTris.map(([a, b, c]) => `5 ${a} ${b} ${c}`),
    ``,
  ].join("\n");

  const refLength = Math.max(0.001, Number(dx.toFixed(4)));
  const su2Config = `% SU2 Aerodynamic Configuration generated from CAD: ${filename}\nSOLVER= INC_RANS\nKIND_TURB_MODEL= SST\nMATH_PROBLEM= DIRECT\nMESH_FILENAME= ${baseName}_mesh.su2\nINC_DENSITY_INIT= 1.225\nINC_VELOCITY_INIT= ( ${freestreamVelocity.toFixed(1)}, 0.0, 0.0 )\nREF_LENGTH= ${refLength}\nREF_AREA= ${refArea}\nMARKER_HEATFLUX= ( wall, 0.0 )\nMARKER_INLET= ( inlet, 288.15, ${freestreamVelocity.toFixed(1)}, 1.0, 0.0, 0.0 )\nMARKER_OUTLET= ( outlet, 101325.0 )\nITER= 250\n`;

  return {
    solidMesh,
    massProperties,
    nodes,
    tetrahedra,
    hexahedra,
    boundaryPatches,
    elementType: preferElementType,
    totalVolume,
    totalSurfaceArea,
    crossSectionArea: massProperties.crossSectionArea,
    characteristicLength: spanL,
    sectionModulus,
    estimatedStressPa,
    estimatedDragCoeff,
    inpDeck,
    su2Mesh,
    su2Config,
  };
}
