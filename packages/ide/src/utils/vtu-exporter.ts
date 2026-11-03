// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VTK UnstructuredGrid (.vtu) Exporter & Exact-Surface Field Projector for IDE Studies.
 *
 * Serializes solved FEA and CFD meshes from the VS Code extension into valid
 * VTK XML `<VTKFile type="UnstructuredGrid">` documents ready for one-click
 * publishing to the ModelScript Hub (`SimulationResultViewer`).
 *
 * When a companion CAD surface mesh (`companionCad`) is available, nodal fields
 * solved on the volumetric mesh are projected onto the exact CAD surface vertices
 * via inverse-distance k-nearest interpolation so the published 3D result has the
 * exact same geometric shape as the input CAD artifact.
 */

export interface StressProbePoint {
  id: string;
  label: string;
  nodeIndex: number;
  position: [number, number, number];
  vonMisesStressPa?: number | undefined;
  displacementMagM?: number | undefined;
  safetyFactor?: number | undefined;
}

export interface FeaExportInput {
  title: string;
  nodes: number[]; // Flat [x0, y0, z0, ...]
  triangles: number[]; // Flat [i0, i1, i2, ...]
  nodalStress?: number[] | undefined; // Pa
  nodalDisplacement?: number[] | undefined; // Flat [dx0, dy0, dz0, ...] in m
  nodalStrain?: number[] | undefined;
  nodalSafetyFactor?: number[] | undefined;
  nodalTemperature?: number[] | undefined; // K
  maxDisplacement?: number | undefined;
  maxStress?: number | undefined;
  minSafetyFactor?: number | undefined;
  companionCad?:
    | {
        vertices: number[];
        indices: number[];
      }
    | null
    | undefined;
  stressProbes?: StressProbePoint[] | undefined;
}

export interface CfdExportInput {
  title: string;
  nodes: number[]; // Flat [x0, y0, z0, ...]
  triangles: number[]; // Flat [i0, i1, i2, ...]
  nodalVelocity?: number[] | undefined; // Flat [vx0, vy0, vz0, ...] in m/s
  nodalPressure?: number[] | undefined; // Pa
  nodalMach?: number[] | undefined;
  nodalTemperature?: number[] | undefined; // K
  cl?: number | undefined;
  cd?: number | undefined;
  cm?: number | undefined;
  companionCad?:
    | {
        vertices: number[];
        indices: number[];
      }
    | null
    | undefined;
}

export interface ExportedVtuBundle {
  fileName: string;
  title: string;
  vtuXml: string;
  primaryField: string;
  summaryMarkdown: string;
  evaluatedProbes: StressProbePoint[];
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1e-12) return "0";
  return Number(n.toPrecision(6)).toString();
}

/**
 * Projects nodal scalar and vector arrays from a volumetric solver mesh (`srcNodes`)
 * onto a target surface mesh (`dstVertices`) using 4-nearest inverse-distance weighting.
 */
export function projectFieldsToSurfaceMesh(
  srcNodes: number[],
  dstVertices: number[],
  scalars: Record<string, number[] | undefined>,
  vectors: Record<string, number[] | undefined>,
): {
  projectedScalars: Record<string, number[]>;
  projectedVectors: Record<string, number[]>;
} {
  const numSrc = Math.floor(srcNodes.length / 3);
  const numDst = Math.floor(dstVertices.length / 3);

  const projectedScalars: Record<string, number[]> = {};
  const projectedVectors: Record<string, number[]> = {};

  for (const [key, arr] of Object.entries(scalars)) {
    if (arr && arr.length >= numSrc) {
      projectedScalars[key] = new Array<number>(numDst).fill(0);
    }
  }
  for (const [key, arr] of Object.entries(vectors)) {
    if (arr && arr.length >= numSrc * 3) {
      projectedVectors[key] = new Array<number>(numDst * 3).fill(0);
    }
  }

  if (numSrc === 0 || numDst === 0) {
    return { projectedScalars, projectedVectors };
  }

  // Normalize bounding boxes if CAD and solver mesh differ in scale (e.g. mm vs m)
  let sMinX = Infinity,
    sMinY = Infinity,
    sMinZ = Infinity;
  let sMaxX = -Infinity,
    sMaxY = -Infinity,
    sMaxZ = -Infinity;
  for (let i = 0; i < numSrc; i++) {
    const x = srcNodes[i * 3]!;
    const y = srcNodes[i * 3 + 1]!;
    const z = srcNodes[i * 3 + 2]!;
    if (x < sMinX) sMinX = x;
    if (x > sMaxX) sMaxX = x;
    if (y < sMinY) sMinY = y;
    if (y > sMaxY) sMaxY = y;
    if (z < sMinZ) sMinZ = z;
    if (z > sMaxZ) sMaxZ = z;
  }

  let dMinX = Infinity,
    dMinY = Infinity,
    dMinZ = Infinity;
  let dMaxX = -Infinity,
    dMaxY = -Infinity,
    dMaxZ = -Infinity;
  for (let i = 0; i < numDst; i++) {
    const x = dstVertices[i * 3]!;
    const y = dstVertices[i * 3 + 1]!;
    const z = dstVertices[i * 3 + 2]!;
    if (x < dMinX) dMinX = x;
    if (x > dMaxX) dMaxX = x;
    if (y < dMinY) dMinY = y;
    if (y > dMaxY) dMaxY = y;
    if (z < dMinZ) dMinZ = z;
    if (z > dMaxZ) dMaxZ = z;
  }

  const sSpanX = Math.max(1e-9, sMaxX - sMinX);
  const sSpanY = Math.max(1e-9, sMaxY - sMinY);
  const sSpanZ = Math.max(1e-9, sMaxZ - sMinZ);
  const dSpanX = Math.max(1e-9, dMaxX - dMinX);
  const dSpanY = Math.max(1e-9, dMaxY - dMinY);
  const dSpanZ = Math.max(1e-9, dMaxZ - dMinZ);

  for (let d = 0; d < numDst; d++) {
    // Map destination vertex into source coordinate space
    const nx = sMinX + ((dstVertices[d * 3]! - dMinX) / dSpanX) * sSpanX;
    const ny = sMinY + ((dstVertices[d * 3 + 1]! - dMinY) / dSpanY) * sSpanY;
    const nz = sMinZ + ((dstVertices[d * 3 + 2]! - dMinZ) / dSpanZ) * sSpanZ;

    // Track 4 closest source nodes
    let i0 = 0,
      i1 = 0,
      i2 = 0,
      i3 = 0;
    let d0 = Infinity,
      d1 = Infinity,
      d2 = Infinity,
      d3 = Infinity;

    for (let s = 0; s < numSrc; s++) {
      const dx = srcNodes[s * 3]! - nx;
      const dy = srcNodes[s * 3 + 1]! - ny;
      const dz = srcNodes[s * 3 + 2]! - nz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < d0) {
        d3 = d2;
        i3 = i2;
        d2 = d1;
        i2 = i1;
        d1 = d0;
        i1 = i0;
        d0 = distSq;
        i0 = s;
      } else if (distSq < d1) {
        d3 = d2;
        i3 = i2;
        d2 = d1;
        i2 = i1;
        d1 = distSq;
        i1 = s;
      } else if (distSq < d2) {
        d3 = d2;
        i3 = i2;
        d2 = distSq;
        i2 = s;
      } else if (distSq < d3) {
        d3 = distSq;
        i3 = s;
      }
    }

    const eps = 1e-12;
    const w0 = 1.0 / (Math.sqrt(d0) + eps);
    const w1 = numSrc > 1 ? 1.0 / (Math.sqrt(d1) + eps) : 0;
    const w2 = numSrc > 2 ? 1.0 / (Math.sqrt(d2) + eps) : 0;
    const w3 = numSrc > 3 ? 1.0 / (Math.sqrt(d3) + eps) : 0;
    const wSum = w0 + w1 + w2 + w3;

    for (const [key, dstArr] of Object.entries(projectedScalars)) {
      const srcArr = scalars[key]!;
      dstArr[d] =
        (w0 * (srcArr[i0] ?? 0) + w1 * (srcArr[i1] ?? 0) + w2 * (srcArr[i2] ?? 0) + w3 * (srcArr[i3] ?? 0)) / wSum;
    }

    for (const [key, dstArr] of Object.entries(projectedVectors)) {
      const srcArr = vectors[key]!;
      for (let c = 0; c < 3; c++) {
        dstArr[d * 3 + c] =
          (w0 * (srcArr[i0 * 3 + c] ?? 0) +
            w1 * (srcArr[i1 * 3 + c] ?? 0) +
            w2 * (srcArr[i2 * 3 + c] ?? 0) +
            w3 * (srcArr[i3 * 3 + c] ?? 0)) /
          wSum;
      }
    }
  }

  return { projectedScalars, projectedVectors };
}

/**
 * Evaluates stress probe points against solved FEA nodal arrays.
 */
export function evaluateStressProbes(
  probes: StressProbePoint[],
  nodes: number[],
  nodalStress?: number[],
  nodalDisplacement?: number[],
  nodalSafetyFactor?: number[],
): StressProbePoint[] {
  const numNodes = Math.floor(nodes.length / 3);
  if (numNodes === 0) return probes;

  return probes.map((probe) => {
    let bestIdx = Math.max(0, Math.min(numNodes - 1, probe.nodeIndex));
    if (probe.position) {
      let bestDist = Infinity;
      for (let i = 0; i < numNodes; i++) {
        const dx = nodes[i * 3]! - probe.position[0];
        const dy = nodes[i * 3 + 1]! - probe.position[1];
        const dz = nodes[i * 3 + 2]! - probe.position[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
    const stressPa = nodalStress?.[bestIdx] ?? probe.vonMisesStressPa ?? 0;
    const dx = nodalDisplacement?.[bestIdx * 3] ?? 0;
    const dy = nodalDisplacement?.[bestIdx * 3 + 1] ?? 0;
    const dz = nodalDisplacement?.[bestIdx * 3 + 2] ?? 0;
    const dispMag = Math.hypot(dx, dy, dz);
    const fos = nodalSafetyFactor?.[bestIdx] ?? probe.safetyFactor ?? 15;

    return {
      ...probe,
      nodeIndex: bestIdx,
      position: [
        nodes[bestIdx * 3] ?? probe.position[0],
        nodes[bestIdx * 3 + 1] ?? probe.position[1],
        nodes[bestIdx * 3 + 2] ?? probe.position[2],
      ],
      vonMisesStressPa: stressPa,
      displacementMagM: dispMag,
      safetyFactor: fos,
    };
  });
}

/**
 * Exports a solved FEA study to a VTK `.vtu` XML string + KPI summary.
 * If `companionCad` is provided with valid surface triangles, projects the solved
 * nodal fields onto the exact CAD surface geometry so the published result preserves
 * the exact 3D shape of the input CAD model.
 */
export function exportFeaResultToVtu(input: FeaExportInput, stemName = "fea_study"): ExportedVtuBundle {
  const useExactCad =
    Boolean(input.companionCad) &&
    (input.companionCad!.vertices?.length ?? 0) >= 9 &&
    (input.companionCad!.indices?.length ?? 0) >= 3;

  let outVertices = input.nodes;
  let outTriangles = input.triangles;
  let stressArr = input.nodalStress;
  let dispArr = input.nodalDisplacement;
  let strainArr = input.nodalStrain;
  let fosArr = input.nodalSafetyFactor;
  let tempArr = input.nodalTemperature;

  if (useExactCad && input.companionCad) {
    outVertices = input.companionCad.vertices;
    outTriangles = input.companionCad.indices;
    const projected = projectFieldsToSurfaceMesh(
      input.nodes,
      outVertices,
      {
        stress: input.nodalStress,
        strain: input.nodalStrain,
        fos: input.nodalSafetyFactor,
        temp: input.nodalTemperature,
      },
      {
        disp: input.nodalDisplacement,
      },
    );
    stressArr = projected.projectedScalars["stress"];
    strainArr = projected.projectedScalars["strain"];
    fosArr = projected.projectedScalars["fos"];
    tempArr = projected.projectedScalars["temp"];
    dispArr = projected.projectedVectors["disp"];
  }

  const numPoints = Math.floor(outVertices.length / 3);
  const numCells = Math.floor(outTriangles.length / 3);

  const coordsText: string[] = [];
  for (let i = 0; i < numPoints * 3; i += 3) {
    coordsText.push(`${fmtNum(outVertices[i]!)} ${fmtNum(outVertices[i + 1]!)} ${fmtNum(outVertices[i + 2]!)}`);
  }

  const connText: string[] = [];
  const offsetsText: string[] = [];
  const typesText: string[] = [];
  for (let c = 0; c < numCells; c++) {
    const i0 = outTriangles[c * 3]!;
    const i1 = outTriangles[c * 3 + 1]!;
    const i2 = outTriangles[c * 3 + 2]!;
    connText.push(`${i0} ${i1} ${i2}`);
    offsetsText.push(String((c + 1) * 3));
    typesText.push("5"); // VTK_TRIANGLE = 5
  }

  const dataArraysXml: string[] = [];
  if (stressArr && stressArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="VonMisesStress" NumberOfComponents="1" format="ascii">\n          ${stressArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }
  if (dispArr && dispArr.length >= numPoints * 3) {
    const vecStr: string[] = [];
    for (let i = 0; i < numPoints * 3; i += 3) {
      vecStr.push(`${fmtNum(dispArr[i]!)} ${fmtNum(dispArr[i + 1]!)} ${fmtNum(dispArr[i + 2]!)}`);
    }
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="Displacement" NumberOfComponents="3" format="ascii">\n          ${vecStr.join(
        " ",
      )}\n        </DataArray>`,
    );
  }
  if (fosArr && fosArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="SafetyFactor" NumberOfComponents="1" format="ascii">\n          ${fosArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }
  if (strainArr && strainArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="EquivalentStrain" NumberOfComponents="1" format="ascii">\n          ${strainArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }
  if (tempArr && tempArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="Temperature" NumberOfComponents="1" format="ascii">\n          ${tempArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }

  const primaryField = stressArr ? "VonMisesStress" : tempArr ? "Temperature" : "Displacement";
  const vtuXml = [
    `<?xml version="1.0"?>`,
    `<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">`,
    `  <UnstructuredGrid>`,
    `    <Piece NumberOfPoints="${numPoints}" NumberOfCells="${numCells}">`,
    `      <PointData Scalars="${primaryField}" Vectors="Displacement">`,
    ...dataArraysXml,
    `      </PointData>`,
    `      <Points>`,
    `        <DataArray type="Float32" NumberOfComponents="3" format="ascii">`,
    `          ${coordsText.join(" ")}`,
    `        </DataArray>`,
    `      </Points>`,
    `      <Cells>`,
    `        <DataArray type="Int32" Name="connectivity" format="ascii">`,
    `          ${connText.join(" ")}`,
    `        </DataArray>`,
    `        <DataArray type="Int32" Name="offsets" format="ascii">`,
    `          ${offsetsText.join(" ")}`,
    `        </DataArray>`,
    `        <DataArray type="UInt8" Name="types" format="ascii">`,
    `          ${typesText.join(" ")}`,
    `        </DataArray>`,
    `      </Cells>`,
    `    </Piece>`,
    `  </UnstructuredGrid>`,
    `</VTKFile>`,
  ].join("\n");

  const evaluatedProbes = evaluateStressProbes(
    input.stressProbes ?? [],
    input.nodes,
    input.nodalStress,
    input.nodalDisplacement,
    input.nodalSafetyFactor,
  );

  const maxStressMPa = ((input.maxStress ?? 0) / 1e6).toFixed(2);
  const maxDispMm = ((input.maxDisplacement ?? 0) * 1e3).toFixed(4);
  const minFos = (input.minSafetyFactor ?? 15).toFixed(2);

  const mdLines = [
    `### ${input.title}`,
    ``,
    `| Metric | Value |`,
    `| :--- | :--- |`,
    `| **Peak Von Mises Stress** | \`${maxStressMPa} MPa\` |`,
    `| **Max Total Deflection** | \`${maxDispMm} mm\` |`,
    `| **Minimum Safety Factor** | \`${minFos}x\` |`,
    `| **Surface Vertices / Elements** | \`${numPoints.toLocaleString()} pts / ${numCells.toLocaleString()} tris\` |`,
  ];

  if (evaluatedProbes.length > 0) {
    mdLines.push(
      ``,
      `#### Stress Probe Points`,
      `| Probe | Coordinates $(x, y, z)$ | Von Mises (MPa) | Deflection (mm) | Safety Factor |`,
      `| :--- | :--- | :--- | :--- | :--- |`,
    );
    for (const p of evaluatedProbes) {
      const coords = `(${p.position[0].toFixed(3)}, ${p.position[1].toFixed(3)}, ${p.position[2].toFixed(3)})`;
      const sMPa = ((p.vonMisesStressPa ?? 0) / 1e6).toFixed(2);
      const dMm = ((p.displacementMagM ?? 0) * 1e3).toFixed(4);
      const fos = (p.safetyFactor ?? 15).toFixed(2);
      mdLines.push(`| **${p.label}** | \`${coords}\` | \`${sMPa} MPa\` | \`${dMm} mm\` | \`${fos}x\` |`);
    }
  }

  const safeStem = stemName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    fileName: `${safeStem}_result.vtu`,
    title: input.title,
    vtuXml,
    primaryField,
    summaryMarkdown: mdLines.join("\n"),
    evaluatedProbes,
  };
}

/**
 * Exports a solved CFD study to a VTK `.vtu` XML string + aerodynamic KPI summary.
 */
export function exportCfdResultToVtu(input: CfdExportInput, stemName = "cfd_study"): ExportedVtuBundle {
  const useExactCad =
    Boolean(input.companionCad) &&
    (input.companionCad!.vertices?.length ?? 0) >= 9 &&
    (input.companionCad!.indices?.length ?? 0) >= 3;

  let outVertices = input.nodes;
  let outTriangles = input.triangles;
  let velArr = input.nodalVelocity;
  let pressArr = input.nodalPressure;
  let machArr = input.nodalMach;
  let tempArr = input.nodalTemperature;

  if (useExactCad && input.companionCad) {
    outVertices = input.companionCad.vertices;
    outTriangles = input.companionCad.indices;
    const projected = projectFieldsToSurfaceMesh(
      input.nodes,
      outVertices,
      {
        pressure: input.nodalPressure,
        mach: input.nodalMach,
        temp: input.nodalTemperature,
      },
      {
        vel: input.nodalVelocity,
      },
    );
    pressArr = projected.projectedScalars["pressure"];
    machArr = projected.projectedScalars["mach"];
    tempArr = projected.projectedScalars["temp"];
    velArr = projected.projectedVectors["vel"];
  }

  const numPoints = Math.floor(outVertices.length / 3);
  const numCells = Math.floor(outTriangles.length / 3);

  const coordsText: string[] = [];
  for (let i = 0; i < numPoints * 3; i += 3) {
    coordsText.push(`${fmtNum(outVertices[i]!)} ${fmtNum(outVertices[i + 1]!)} ${fmtNum(outVertices[i + 2]!)}`);
  }

  const connText: string[] = [];
  const offsetsText: string[] = [];
  const typesText: string[] = [];
  for (let c = 0; c < numCells; c++) {
    const i0 = outTriangles[c * 3]!;
    const i1 = outTriangles[c * 3 + 1]!;
    const i2 = outTriangles[c * 3 + 2]!;
    connText.push(`${i0} ${i1} ${i2}`);
    offsetsText.push(String((c + 1) * 3));
    typesText.push("5");
  }

  const dataArraysXml: string[] = [];
  if (velArr && velArr.length >= numPoints * 3) {
    const vecStr: string[] = [];
    for (let i = 0; i < numPoints * 3; i += 3) {
      vecStr.push(`${fmtNum(velArr[i]!)} ${fmtNum(velArr[i + 1]!)} ${fmtNum(velArr[i + 2]!)}`);
    }
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="Velocity" NumberOfComponents="3" format="ascii">\n          ${vecStr.join(
        " ",
      )}\n        </DataArray>`,
    );
  }
  if (pressArr && pressArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="Pressure" NumberOfComponents="1" format="ascii">\n          ${pressArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }
  if (machArr && machArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="MachNumber" NumberOfComponents="1" format="ascii">\n          ${machArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }
  if (tempArr && tempArr.length >= numPoints) {
    dataArraysXml.push(
      `        <DataArray type="Float32" Name="Temperature" NumberOfComponents="1" format="ascii">\n          ${tempArr
        .slice(0, numPoints)
        .map(fmtNum)
        .join(" ")}\n        </DataArray>`,
    );
  }

  const primaryField = pressArr ? "Pressure" : "Velocity";
  const vtuXml = [
    `<?xml version="1.0"?>`,
    `<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">`,
    `  <UnstructuredGrid>`,
    `    <Piece NumberOfPoints="${numPoints}" NumberOfCells="${numCells}">`,
    `      <PointData Scalars="${primaryField}" Vectors="Velocity">`,
    ...dataArraysXml,
    `      </PointData>`,
    `      <Points>`,
    `        <DataArray type="Float32" NumberOfComponents="3" format="ascii">`,
    `          ${coordsText.join(" ")}`,
    `        </DataArray>`,
    `      </Points>`,
    `      <Cells>`,
    `        <DataArray type="Int32" Name="connectivity" format="ascii">`,
    `          ${connText.join(" ")}`,
    `        </DataArray>`,
    `        <DataArray type="Int32" Name="offsets" format="ascii">`,
    `          ${offsetsText.join(" ")}`,
    `        </DataArray>`,
    `        <DataArray type="UInt8" Name="types" format="ascii">`,
    `          ${typesText.join(" ")}`,
    `        </DataArray>`,
    `      </Cells>`,
    `    </Piece>`,
    `  </UnstructuredGrid>`,
    `</VTKFile>`,
  ].join("\n");

  const clStr = (input.cl ?? 0).toFixed(4);
  const cdStr = (input.cd ?? 0).toFixed(4);
  const ldStr = input.cd && Math.abs(input.cd) > 1e-6 ? ((input.cl ?? 0) / input.cd).toFixed(2) : "0.00";

  const mdLines = [
    `### ${input.title}`,
    ``,
    `| Aerodynamic Metric | Value |`,
    `| :--- | :--- |`,
    `| **Lift Coefficient ($C_L$)** | \`${clStr}\` |`,
    `| **Drag Coefficient ($C_D$)** | \`${cdStr}\` |`,
    `| **Lift-to-Drag Ratio ($L/D$)** | \`${ldStr}\` |`,
    `| **Surface Mesh Elements** | \`${numPoints.toLocaleString()} pts / ${numCells.toLocaleString()} tris\` |`,
  ];

  const safeStem = stemName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    fileName: `${safeStem}_cfd_result.vtu`,
    title: input.title,
    vtuXml,
    primaryField,
    summaryMarkdown: mdLines.join("\n"),
    evaluatedProbes: [],
  };
}
