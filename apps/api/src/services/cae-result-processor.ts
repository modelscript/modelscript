// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";

export interface CaeScalarSummary {
  solver: string;
  converged: boolean;
  computeTimeSeconds?: number | undefined;
  maxVonMisesStressPa?: number | undefined;
  maxDisplacementMeters?: number | undefined;
  liftCoefficient?: number | undefined;
  dragCoefficient?: number | undefined;
  liftToDragRatio?: number | undefined;
  customMetrics?: Record<string, number> | undefined;
}

export interface FrdParsedData {
  nodeCoords: Float32Array;
  elements: Uint32Array;
  numNodes: number;
  numElements: number;
  displacements?: Float32Array | undefined; // 3 per node
  vonMisesStress?: Float32Array | undefined; // 1 per node
}

export interface FeaMeshPayload {
  type: "fea-mesh";
  participantId?: string;
  time: number;
  geometry: {
    positions: number[];
    indices: number[];
    normals?: number[];
  };
  fields: {
    vonMisesStress: number[];
    displacements: number[];
  };
  stats: {
    maxStress: number;
    maxDisplacement: number;
    safetyFactor?: number;
  };
}

/**
 * High-performance CAE Post-Processor.
 * Converts raw solver outputs (CalculiX .frd, SU2 .dat/.vtk) into Unstructured Grid (.vtu) for 3D visualization.
 */
export const CaeResultProcessor = {
  /**
   * Parses a CalculiX ASCII result file (.frd) and extracts nodes, elements, and field results.
   */
  parseCalculixFrd(frdText: string): FrdParsedData {
    const lines = frdText.split("\n");
    let inNodes = false;
    let inElements = false;
    let inDisp = false;
    let inStress = false;

    const coords: number[] = [];
    const nodeIdToIdx = new Map<number, number>();
    const elementIndices: number[] = [];

    let displacements: Float32Array | null = null;
    let vonMisesStress: Float32Array | null = null;

    for (const line of lines) {
      // Node coordinates block: starts with 1C, ends with -3
      if (line.startsWith("    1C")) {
        inNodes = true;
        continue;
      }
      if (inNodes) {
        if (line.startsWith("    -3")) {
          inNodes = false;
          const nodeCount = coords.length / 3;
          displacements = new Float32Array(nodeCount * 3);
          vonMisesStress = new Float32Array(nodeCount);
          continue;
        }
        if (line.startsWith(" -1")) {
          // Node line format:  -1<nodeId> <x> <y> <z>
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const p1 = parts[1];
            const p2 = parts[2];
            const p3 = parts[3];
            const p4 = parts[4];
            if (p1 && p2 && p3 && p4) {
              const nid = parseInt(p1, 10);
              const x = parseFloat(p2);
              const y = parseFloat(p3);
              const z = parseFloat(p4);
              nodeIdToIdx.set(nid, coords.length / 3);
              coords.push(x, y, z);
            }
          }
        }
      }

      // Element connectivity block: starts with 3C, ends with -3
      if (line.startsWith("    3C")) {
        inElements = true;
        continue;
      }
      if (inElements) {
        if (line.startsWith("    -3")) {
          inElements = false;
          continue;
        }
        if (line.startsWith(" -1")) {
          // Element line: -1 <elemId> <type> <group> <n1> <n2> <n3> <n4>
          const parts = line.trim().split(/\s+/);
          // Standard linear tetrahedron: 4 nodes
          if (parts.length >= 8) {
            const p4 = parts[4];
            const p5 = parts[5];
            const p6 = parts[6];
            const p7 = parts[7];
            if (p4 && p5 && p6 && p7) {
              const n1 = nodeIdToIdx.get(parseInt(p4, 10));
              const n2 = nodeIdToIdx.get(parseInt(p5, 10));
              const n3 = nodeIdToIdx.get(parseInt(p6, 10));
              const n4 = nodeIdToIdx.get(parseInt(p7, 10));
              if (n1 !== undefined && n2 !== undefined && n3 !== undefined && n4 !== undefined) {
                elementIndices.push(n1, n2, n3, n4);
              }
            }
          }
        }
      }

      // Displacement field block (100CL DISP)
      if (line.includes("DISP") && line.startsWith(" -4")) {
        inDisp = true;
        continue;
      }
      if (inDisp) {
        if (line.startsWith("    -3")) {
          inDisp = false;
          continue;
        }
        if (line.startsWith(" -1") && displacements) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const p1 = parts[1];
            const p2 = parts[2];
            const p3 = parts[3];
            const p4 = parts[4];
            if (p1 && p2 && p3 && p4) {
              const nid = parseInt(p1, 10);
              const idx = nodeIdToIdx.get(nid);
              if (idx !== undefined) {
                displacements[idx * 3 + 0] = parseFloat(p2);
                displacements[idx * 3 + 1] = parseFloat(p3);
                displacements[idx * 3 + 2] = parseFloat(p4);
              }
            }
          }
        }
      }

      // Stress field block (100CL STRESS)
      if (line.includes("STRESS") && line.startsWith(" -4")) {
        inStress = true;
        continue;
      }
      if (inStress) {
        if (line.startsWith("    -3")) {
          inStress = false;
          continue;
        }
        if (line.startsWith(" -1") && vonMisesStress) {
          // -1 <nid> SXX SYY SZZ SXY SYZ SZX
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 8) {
            const p1 = parts[1];
            const p2 = parts[2];
            const p3 = parts[3];
            const p4 = parts[4];
            const p5 = parts[5];
            const p6 = parts[6];
            const p7 = parts[7];
            if (p1 && p2 && p3 && p4 && p5 && p6 && p7) {
              const nid = parseInt(p1, 10);
              const idx = nodeIdToIdx.get(nid);
              if (idx !== undefined) {
                const sxx = parseFloat(p2);
                const syy = parseFloat(p3);
                const szz = parseFloat(p4);
                const sxy = parseFloat(p5);
                const syz = parseFloat(p6);
                const szx = parseFloat(p7);

                // Von Mises stress formula for 3D tensor:
                // sqrt(0.5 * ((sxx-syy)^2 + (syy-szz)^2 + (szz-sxx)^2 + 6*(sxy^2 + syz^2 + szx^2)))
                const vm = Math.sqrt(
                  0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2 + 6 * (sxy ** 2 + syz ** 2 + szx ** 2)),
                );
                vonMisesStress[idx] = vm;
              }
            }
          }
        }
      }
    }

    const numElems = Math.floor(elementIndices.length / 4);

    return {
      nodeCoords: new Float32Array(coords),
      elements: new Uint32Array(elementIndices),
      numNodes: coords.length / 3,
      numElements: numElems,
      displacements: displacements || undefined,
      vonMisesStress: vonMisesStress || undefined,
    };
  },

  /**
   * Converts parsed FRD data to VTK XML UnstructuredGrid (.vtu) format.
   */
  convertFrdToVtu(frdData: FrdParsedData): string {
    const { nodeCoords, elements, numNodes, numElements, displacements, vonMisesStress } = frdData;

    // Points text
    const pointStr: string[] = [];
    for (let i = 0; i < numNodes; i++) {
      pointStr.push(`${nodeCoords[i * 3 + 0]} ${nodeCoords[i * 3 + 1]} ${nodeCoords[i * 3 + 2]}`);
    }

    // Cells connectivity (4 nodes per tet)
    const connStr: string[] = [];
    const offsetStr: string[] = [];
    const typeStr: string[] = [];

    for (let e = 0; e < numElements; e++) {
      const base = e * 4;
      connStr.push(`${elements[base]} ${elements[base + 1]} ${elements[base + 2]} ${elements[base + 3]}`);
      offsetStr.push(`${(e + 1) * 4}`);
      typeStr.push("10"); // VTK_TETRA = 10
    }

    // PointData: Displacement and Stress
    let pointDataXml = "";
    if (displacements || vonMisesStress) {
      pointDataXml = "<PointData>\n";
      if (displacements) {
        const dispStr: string[] = [];
        for (let i = 0; i < numNodes; i++) {
          dispStr.push(`${displacements[i * 3 + 0]} ${displacements[i * 3 + 1]} ${displacements[i * 3 + 2]}`);
        }
        pointDataXml += `  <DataArray type="Float32" Name="Displacement" NumberOfComponents="3" format="ascii">\n    ${dispStr.join(" ")}\n  </DataArray>\n`;
      }
      if (vonMisesStress) {
        pointDataXml += `  <DataArray type="Float32" Name="Stress_VonMises" NumberOfComponents="1" format="ascii">\n    ${Array.from(vonMisesStress).join(" ")}\n  </DataArray>\n`;
      }
      pointDataXml += "</PointData>\n";
    }

    return `<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">
  <UnstructuredGrid>
    <Piece NumberOfPoints="${numNodes}" NumberOfCells="${numElements}">
      ${pointDataXml}
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${pointStr.join(" ")}
        </DataArray>
      </Points>
      <Cells>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${connStr.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsetStr.join(" ")}
        </DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">
          ${typeStr.join(" ")}
        </DataArray>
      </Cells>
    </Piece>
  </UnstructuredGrid>
</VTKFile>
`;
  },

  /**
   * Synthesizes or converts SU2 native VTK/CSV results into a clean .vtu string.
   */
  convertSu2VtkToVtu(
    nodeCoords: Float32Array | number[],
    elements: Uint32Array | number[],
    pressure: Float32Array | number[],
    velocity: Float32Array | number[],
  ): string {
    const numNodes = nodeCoords.length / 3;
    const numElements = elements.length / 4;

    const pointStr: string[] = [];
    for (let i = 0; i < numNodes; i++) {
      pointStr.push(`${nodeCoords[i * 3 + 0]} ${nodeCoords[i * 3 + 1]} ${nodeCoords[i * 3 + 2]}`);
    }

    const connStr: string[] = [];
    const offsetStr: string[] = [];
    const typeStr: string[] = [];
    for (let e = 0; e < numElements; e++) {
      const base = e * 4;
      connStr.push(`${elements[base]} ${elements[base + 1]} ${elements[base + 2]} ${elements[base + 3]}`);
      offsetStr.push(`${(e + 1) * 4}`);
      typeStr.push("10"); // VTK_TETRA
    }

    const velStr: string[] = [];
    for (let i = 0; i < numNodes; i++) {
      velStr.push(`${velocity[i * 3 + 0]} ${velocity[i * 3 + 1]} ${velocity[i * 3 + 2]}`);
    }

    return `<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">
  <UnstructuredGrid>
    <Piece NumberOfPoints="${numNodes}" NumberOfCells="${numElements}">
      <PointData>
        <DataArray type="Float32" Name="Pressure" NumberOfComponents="1" format="ascii">
          ${Array.from(pressure).join(" ")}
        </DataArray>
        <DataArray type="Float32" Name="Velocity" NumberOfComponents="3" format="ascii">
          ${velStr.join(" ")}
        </DataArray>
      </PointData>
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${pointStr.join(" ")}
        </DataArray>
      </Points>
      <Cells>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${connStr.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsetStr.join(" ")}
        </DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">
          ${typeStr.join(" ")}
        </DataArray>
      </Cells>
    </Piece>
  </UnstructuredGrid>
</VTKFile>
`;
  },

  /**
   * Extracts scalar engineering summary (KPIs) from a VTU file or field arrays.
   */
  extractScalarSummary(vtuContentOrPath: string, solver: string): CaeScalarSummary {
    let xml = vtuContentOrPath;
    if (fs.existsSync(vtuContentOrPath)) {
      xml = fs.readFileSync(vtuContentOrPath, "utf8");
    }

    let maxVonMises = 0;
    let maxDisp = 0;

    // Extract Stress_VonMises
    const stressMatch = xml.match(/<DataArray[^>]*Name="Stress_VonMises"[^>]*>([\s\S]*?)<\/DataArray>/);
    if (stressMatch && stressMatch[1]) {
      const vals = stressMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) {
        if (!Number.isNaN(v)) maxVonMises = Math.max(maxVonMises, v);
      }
    }

    // Extract Displacement
    const dispMatch = xml.match(/<DataArray[^>]*Name="Displacement"[^>]*>([\s\S]*?)<\/DataArray>/);
    if (dispMatch && dispMatch[1]) {
      const vals = dispMatch[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i < vals.length; i += 3) {
        const mag = Math.hypot(vals[i] || 0, vals[i + 1] || 0, vals[i + 2] || 0);
        maxDisp = Math.max(maxDisp, mag);
      }
    }

    return {
      solver,
      converged: true,
      maxVonMisesStressPa: maxVonMises > 0 ? maxVonMises : undefined,
      maxDisplacementMeters: maxDisp > 0 ? maxDisp : undefined,
    };
  },

  /**
   * Converts parsed FRD data directly into a 3D FeaMeshPayload for real-time webview rendering.
   */
  extractFeaMeshPayload(frdData: FrdParsedData, yieldStrengthPa = 250e6): FeaMeshPayload {
    const surfaceIndices: number[] = [];
    const numElems = frdData.numElements;
    const elements = frdData.elements;

    if (numElems > 0 && elements.length >= numElems * 4) {
      const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
      for (let e = 0; e < numElems; e++) {
        const base = e * 4;
        const n0 = elements[base + 0];
        const n1 = elements[base + 1];
        const n2 = elements[base + 2];
        const n3 = elements[base + 3];
        if (n0 === undefined || n1 === undefined || n2 === undefined || n3 === undefined) continue;

        const faces: [number, number, number][] = [
          [n0, n2, n1],
          [n0, n1, n3],
          [n1, n2, n3],
          [n0, n3, n2],
        ];
        for (const f of faces) {
          const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
          const entry = faceMap.get(key);
          if (entry) entry.count++;
          else faceMap.set(key, { count: 1, face: f });
        }
      }
      for (const { count, face } of faceMap.values()) {
        if (count === 1) surfaceIndices.push(face[0], face[1], face[2]);
      }
    }

    // Fallback if all faces canceled (single tet or open mesh)
    if (surfaceIndices.length === 0 && numElems > 0 && elements.length >= numElems * 4) {
      for (let e = 0; e < numElems; e++) {
        const base = e * 4;
        const n0 = elements[base + 0];
        const n1 = elements[base + 1];
        const n2 = elements[base + 2];
        const n3 = elements[base + 3];
        if (n0 === undefined || n1 === undefined || n2 === undefined || n3 === undefined) continue;
        surfaceIndices.push(n0, n2, n1, n0, n1, n3, n1, n2, n3, n0, n3, n2);
      }
    }

    let maxStress = 0;
    if (frdData.vonMisesStress) {
      for (const s of frdData.vonMisesStress) {
        if (s > maxStress) maxStress = s;
      }
    }

    let maxDisp = 0;
    if (frdData.displacements) {
      for (let i = 0; i < frdData.displacements.length; i += 3) {
        const dx = frdData.displacements[i] || 0;
        const dy = frdData.displacements[i + 1] || 0;
        const dz = frdData.displacements[i + 2] || 0;
        const mag = Math.hypot(dx, dy, dz);
        if (mag > maxDisp) maxDisp = mag;
      }
    }

    const safetyFactor = maxStress > 0 ? Number((yieldStrengthPa / maxStress).toFixed(2)) : 2.5;

    return {
      type: "fea-mesh",
      time: 0,
      geometry: {
        positions: Array.from(frdData.nodeCoords),
        indices: surfaceIndices.length > 0 ? surfaceIndices : Array.from({ length: frdData.numNodes }, (_, i) => i),
      },
      fields: {
        vonMisesStress: frdData.vonMisesStress ? Array.from(frdData.vonMisesStress) : [],
        displacements: frdData.displacements ? Array.from(frdData.displacements) : [],
      },
      stats: {
        maxStress,
        maxDisplacement: maxDisp,
        safetyFactor,
      },
    };
  },

  /**
   * Parses a VTU XML document and synthesizes a FeaMeshPayload for webview visualization.
   */
  parseVtuToMeshPayload(vtuXml: string, yieldStrengthPa = 250e6): FeaMeshPayload {
    // 1. Extract Points
    const pointsMatch = vtuXml.match(/<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/);
    const positions: number[] = [];
    if (pointsMatch && pointsMatch[1]) {
      const vals = pointsMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) {
        if (!Number.isNaN(v)) positions.push(v);
      }
    }

    // 2. Extract Cells Connectivity
    const connMatch = vtuXml.match(/<DataArray[^>]*Name="connectivity"[^>]*>([\s\S]*?)<\/DataArray>/);
    const elements: number[] = [];
    if (connMatch && connMatch[1]) {
      const vals = connMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) {
        if (!Number.isNaN(v)) elements.push(v);
      }
    }

    // 3. Extract Stress_VonMises or Pressure
    const stressMatch = vtuXml.match(/<DataArray[^>]*Name="(?:Stress_VonMises|Pressure)"[^>]*>([\s\S]*?)<\/DataArray>/);
    const vonMisesStress: number[] = [];
    let maxStress = 0;
    if (stressMatch && stressMatch[1]) {
      const vals = stressMatch[1].trim().split(/\s+/).map(Number);
      for (const v of vals) {
        if (!Number.isNaN(v)) {
          vonMisesStress.push(v);
          if (v > maxStress) maxStress = v;
        }
      }
    }

    // 4. Extract Displacement or Velocity
    const dispMatch = vtuXml.match(/<DataArray[^>]*Name="(?:Displacement|Velocity)"[^>]*>([\s\S]*?)<\/DataArray>/);
    const displacements: number[] = [];
    let maxDisp = 0;
    if (dispMatch && dispMatch[1]) {
      const vals = dispMatch[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i < vals.length; i += 3) {
        const dx = vals[i] || 0;
        const dy = vals[i + 1] || 0;
        const dz = vals[i + 2] || 0;
        displacements.push(dx, dy, dz);
        const mag = Math.hypot(dx, dy, dz);
        if (mag > maxDisp) maxDisp = mag;
      }
    }

    const numNodes = positions.length / 3;
    const numElems = Math.floor(elements.length / 4);

    // Extract surface boundary faces from tets
    const surfaceIndices: number[] = [];
    if (numElems > 0) {
      const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
      for (let e = 0; e < numElems; e++) {
        const base = e * 4;
        const n0 = elements[base + 0];
        const n1 = elements[base + 1];
        const n2 = elements[base + 2];
        const n3 = elements[base + 3];
        if (n0 === undefined || n1 === undefined || n2 === undefined || n3 === undefined) continue;

        const faces: [number, number, number][] = [
          [n0, n2, n1],
          [n0, n1, n3],
          [n1, n2, n3],
          [n0, n3, n2],
        ];
        for (const f of faces) {
          const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
          const entry = faceMap.get(key);
          if (entry) entry.count++;
          else faceMap.set(key, { count: 1, face: f });
        }
      }
      for (const { count, face } of faceMap.values()) {
        if (count === 1) surfaceIndices.push(face[0], face[1], face[2]);
      }
    }

    if (surfaceIndices.length === 0 && numElems > 0) {
      for (let e = 0; e < numElems; e++) {
        const base = e * 4;
        const n0 = elements[base + 0];
        const n1 = elements[base + 1];
        const n2 = elements[base + 2];
        const n3 = elements[base + 3];
        if (n0 === undefined || n1 === undefined || n2 === undefined || n3 === undefined) continue;
        surfaceIndices.push(n0, n2, n1, n0, n1, n3, n1, n2, n3, n0, n3, n2);
      }
    }

    const safetyFactor = maxStress > 0 ? Number((yieldStrengthPa / maxStress).toFixed(2)) : 2.5;

    return {
      type: "fea-mesh",
      time: 0,
      geometry: {
        positions,
        indices: surfaceIndices.length > 0 ? surfaceIndices : Array.from({ length: numNodes }, (_, i) => i),
      },
      fields: {
        vonMisesStress,
        displacements,
      },
      stats: {
        maxStress,
        maxDisplacement: maxDisp,
        safetyFactor,
      },
    };
  },
};

export type CaeResultProcessor = typeof CaeResultProcessor;
