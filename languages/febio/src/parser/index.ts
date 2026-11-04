// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Parser for FEBio 3.x/4.x (.feb) XML, SOFA Framework (.scn) XML,
 * and line-oriented Biomechanics DSL.
 */

import type {
  FebioBoundaryCondition,
  FebioContact,
  FebioControl,
  FebioDocument,
  FebioElement,
  FebioElementType,
  FebioFormat,
  FebioLoad,
  FebioMaterial,
  FebioNode,
  FebioNodeSet,
  FebioSolidDomain,
  FebioSourceRange,
  FebioSurface,
  FebioSurfaceFacet,
  SofaForceField,
  SofaSceneNode,
} from "../types.js";

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(lineOffsets: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midVal = lineOffsets[mid] ?? 0;
    if (midVal <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  const lineStart = lineOffsets[lineIndex] ?? 0;
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
  };
}

function makeRange(lineOffsets: number[], startOffset: number, endOffset: number): FebioSourceRange {
  const s = offsetToLineCol(lineOffsets, startOffset);
  const e = offsetToLineCol(lineOffsets, Math.max(startOffset, endOffset));
  return {
    startOffset,
    endOffset: Math.max(startOffset, endOffset),
    startLine: s.line,
    startColumn: s.column,
    endLine: e.line,
    endColumn: e.column,
  };
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (key) {
      attrs[key] = val.trim();
    }
  }
  return attrs;
}

function extractTagValue(block: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = re.exec(block);
  return m?.[1]?.trim();
}

function extractTagNumber(block: string, tagName: string): number | undefined {
  const raw = extractTagValue(block, tagName);
  if (raw === undefined || raw === "") return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

export function parseFebio(content: string, sourceUri?: string): FebioDocument {
  const lineOffsets = buildLineOffsets(content);
  const trimmed = content.trim();

  if (/<febio_spec\b/i.test(trimmed)) {
    return parseFebioXml(content, lineOffsets, sourceUri);
  }
  if (/<Node\b/i.test(trimmed)) {
    return parseSofaScnXml(content, lineOffsets, sourceUri);
  }
  return parseFebioDsl(content, lineOffsets, sourceUri);
}

function parseFebioXml(content: string, lineOffsets: number[], sourceUri?: string): FebioDocument {
  const specMatch = /<febio_spec\b([^>]*)>/i.exec(content);
  const specAttrs = specMatch ? parseAttributes(specMatch[1] ?? "") : {};
  const version = specAttrs["version"] ?? "4.0";

  const moduleMatch = /<Module\b([^>]*)\/?>/i.exec(content);
  const moduleAttrs = moduleMatch ? parseAttributes(moduleMatch[1] ?? "") : {};
  const moduleType = moduleAttrs["type"] ?? "solid";

  const title = extractTagValue(content, "title") ?? "FEBioBiomechanicsModel";

  // 1. Parse <Control>
  let control: FebioControl | undefined;
  const controlMatch = /<Control\b[^>]*>([\s\S]*?)<\/Control>/i.exec(content);
  if (controlMatch) {
    const body = controlMatch[1] ?? "";
    const analysisRaw = (extractTagValue(body, "analysis") ?? "STATIC").toUpperCase();
    const analysis =
      analysisRaw === "DYNAMIC" || analysisRaw === "BIPHASIC" || analysisRaw === "STEADY-STATE"
        ? analysisRaw
        : "STATIC";
    const timeSteps = extractTagNumber(body, "time_steps") ?? 10;
    const stepSize = extractTagNumber(body, "step_size") ?? 0.1;
    const maxRefs = extractTagNumber(body, "max_refs");
    const dtol = extractTagNumber(body, "dtol");
    control = {
      analysis,
      timeSteps,
      stepSize,
      range: makeRange(lineOffsets, controlMatch.index, controlMatch.index + controlMatch[0].length),
    };
    if (maxRefs !== undefined) control.maxRefs = maxRefs;
    if (dtol !== undefined) control.dtol = dtol;
  }

  // 2. Parse <Material>
  const materials: FebioMaterial[] = [];
  const matRegex = /<material\b(\s+[^>]*)>([\s\S]*?)<\/material>/gi;
  let matMatch: RegExpExecArray | null;
  while ((matMatch = matRegex.exec(content)) !== null) {
    const attrs = parseAttributes(matMatch[1] ?? "");
    const body = matMatch[2] ?? "";
    const id = attrs["id"] ?? String(materials.length + 1);
    const name = attrs["name"] ?? `Mat_${id}`;
    const type = attrs["type"] ?? "neo-Hookean";

    const E = extractTagNumber(body, "E");
    const v = extractTagNumber(body, "v");
    const density = extractTagNumber(body, "density");
    const c1 = extractTagNumber(body, "c1");
    const c2 = extractTagNumber(body, "c2");
    const k = extractTagNumber(body, "k");
    const perm = extractTagNumber(body, "perm") ?? extractTagNumber(body, "permeability");
    const phi0 = extractTagNumber(body, "phi0");

    const mat: FebioMaterial = {
      id,
      name,
      type,
      range: makeRange(lineOffsets, matMatch.index, matMatch.index + matMatch[0].length),
    };
    if (E !== undefined) mat.E = E;
    if (v !== undefined) mat.v = v;
    if (density !== undefined) mat.density = density;
    if (c1 !== undefined) mat.c1 = c1;
    if (c2 !== undefined) mat.c2 = c2;
    if (k !== undefined) mat.k = k;
    if (perm !== undefined) mat.perm = perm;
    if (phi0 !== undefined) mat.phi0 = phi0;
    materials.push(mat);
  }

  // 3. Parse <Nodes>
  const nodes: FebioNode[] = [];
  const nodeRegex = /<node\b([^>]*)>([^<]+)<\/node>/gi;
  let nodeMatch: RegExpExecArray | null;
  while ((nodeMatch = nodeRegex.exec(content)) !== null) {
    const attrs = parseAttributes(nodeMatch[1] ?? "");
    const id = attrs["id"] ?? String(nodes.length + 1);
    const coords = (nodeMatch[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    nodes.push({
      id,
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      z: coords[2] ?? 0,
      range: makeRange(lineOffsets, nodeMatch.index, nodeMatch.index + nodeMatch[0].length),
    });
  }

  // 4. Parse <Elements>
  const elements: FebioElement[] = [];
  const elemsBlockRegex = /<Elements\b([^>]*)>([\s\S]*?)<\/Elements>/gi;
  let elemsBlock: RegExpExecArray | null;
  while ((elemsBlock = elemsBlockRegex.exec(content)) !== null) {
    const blockAttrs = parseAttributes(elemsBlock[1] ?? "");
    const blockStart = elemsBlock.index;
    const rawType = (blockAttrs["type"] ?? "tet4").toLowerCase();
    const elemType: FebioElementType =
      rawType === "hex8" || rawType === "tri3" || rawType === "quad4" ? rawType : "tet4";
    const domainName = blockAttrs["name"];
    const matId = blockAttrs["mat"];
    const body = elemsBlock[2] ?? "";

    const elemRegex = /<(?:elem|tet4|hex8|tri3|quad4)\b([^>]*)>([^<]+)<\/(?:elem|tet4|hex8|tri3|quad4)>/gi;
    let elemMatch: RegExpExecArray | null;
    while ((elemMatch = elemRegex.exec(body)) !== null) {
      const eAttrs = parseAttributes(elemMatch[1] ?? "");
      const id = eAttrs["id"] ?? String(elements.length + 1);
      const nodeIds = (elemMatch[2] ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      const absStart = blockStart + elemMatch.index;
      const elem: FebioElement = {
        id,
        type: elemType,
        nodeIds,
        range: makeRange(lineOffsets, absStart, absStart + elemMatch[0].length),
      };
      if (domainName !== undefined) elem.domainName = domainName;
      if (matId !== undefined) elem.materialId = matId;
      elements.push(elem);
    }
  }

  // 5. Parse <NodeSet>
  const nodeSets: FebioNodeSet[] = [];
  const nodeSetRegex = /<NodeSet\b([^>]*)>([\s\S]*?)<\/NodeSet>/gi;
  let nsMatch: RegExpExecArray | null;
  while ((nsMatch = nodeSetRegex.exec(content)) !== null) {
    const attrs = parseAttributes(nsMatch[1] ?? "");
    const name = attrs["name"] ?? `NodeSet_${nodeSets.length + 1}`;
    const body = nsMatch[2] ?? "";
    const nodeIds: string[] = [];

    const childNodeRegex = /<(?:node|n)\b([^>]*)\/?>/gi;
    let cnMatch: RegExpExecArray | null;
    while ((cnMatch = childNodeRegex.exec(body)) !== null) {
      const cAttrs = parseAttributes(cnMatch[1] ?? "");
      if (cAttrs["id"]) {
        nodeIds.push(cAttrs["id"]);
      }
    }
    if (nodeIds.length === 0) {
      const stripped = body.replace(/<[^>]+>/g, " ").trim();
      if (stripped) {
        for (const tok of stripped.split(/[\s,]+/)) {
          if (tok) nodeIds.push(tok);
        }
      }
    }
    nodeSets.push({
      name,
      nodeIds,
      range: makeRange(lineOffsets, nsMatch.index, nsMatch.index + nsMatch[0].length),
    });
  }

  // 6. Parse <Surface>
  const surfaces: FebioSurface[] = [];
  const surfaceRegex = /<Surface\b([^>]*)>([\s\S]*?)<\/Surface>/gi;
  let surfMatch: RegExpExecArray | null;
  while ((surfMatch = surfaceRegex.exec(content)) !== null) {
    const attrs = parseAttributes(surfMatch[1] ?? "");
    const name = attrs["name"] ?? `Surface_${surfaces.length + 1}`;
    const body = surfMatch[2] ?? "";
    const surfStart = surfMatch.index;
    const facets: FebioSurfaceFacet[] = [];

    const facetRegex = /<(tri3|quad4)\b([^>]*)>([^<]+)<\/\1>/gi;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = facetRegex.exec(body)) !== null) {
      const fType = (fMatch[1] ?? "tri3").toLowerCase() === "quad4" ? "quad4" : "tri3";
      const fAttrs = parseAttributes(fMatch[2] ?? "");
      const fId = fAttrs["id"] ?? String(facets.length + 1);
      const nodeIds = (fMatch[3] ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      const absStart = surfStart + fMatch.index;
      facets.push({
        id: fId,
        type: fType,
        nodeIds,
        range: makeRange(lineOffsets, absStart, absStart + fMatch[0].length),
      });
    }

    surfaces.push({
      name,
      facets,
      range: makeRange(lineOffsets, surfStart, surfStart + surfMatch[0].length),
    });
  }

  // 7. Parse <MeshDomains> / <SolidDomain>
  const solidDomains: FebioSolidDomain[] = [];
  const sdRegex = /<SolidDomain\b([^>]*)\/?>/gi;
  let sdMatch: RegExpExecArray | null;
  while ((sdMatch = sdRegex.exec(content)) !== null) {
    const attrs = parseAttributes(sdMatch[1] ?? "");
    const name = attrs["name"] ?? `Domain_${solidDomains.length + 1}`;
    const materialId = attrs["mat"] ?? "";
    solidDomains.push({
      name,
      materialId,
      range: makeRange(lineOffsets, sdMatch.index, sdMatch.index + sdMatch[0].length),
    });

    // Propagate domain materialId to matching elements if not already set on <Elements>
    for (const el of elements) {
      if (el.domainName === name && el.materialId === undefined && materialId) {
        el.materialId = materialId;
      }
    }
  }

  // 8. Parse <Boundary>
  const boundaryConditions: FebioBoundaryCondition[] = [];
  const bcBlockRegex = /<bc\b([^>]*)>([\s\S]*?)<\/bc>|<bc\b([^>]*)\/>/gi;
  let bcMatch: RegExpExecArray | null;
  while ((bcMatch = bcBlockRegex.exec(content)) !== null) {
    const attrs = parseAttributes(bcMatch[1] ?? bcMatch[3] ?? "");
    const body = bcMatch[2] ?? "";
    const id = attrs["id"] ?? `BC_${boundaryConditions.length + 1}`;
    const name = attrs["name"] ?? id;
    const rawType = (attrs["type"] ?? "zero displacement").toLowerCase();
    const type: FebioBoundaryCondition["type"] = rawType.includes("prescribe")
      ? "prescribed displacement"
      : rawType.includes("rigid")
        ? "rigid"
        : rawType === "fix"
          ? "fix"
          : "zero displacement";
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? extractTagValue(body, "node_set") ?? "";

    const dofs: string[] = [];
    if (extractTagNumber(body, "x_dof") === 1) dofs.push("x");
    if (extractTagNumber(body, "y_dof") === 1) dofs.push("y");
    if (extractTagNumber(body, "z_dof") === 1) dofs.push("z");
    const dofTag = extractTagValue(body, "dof") ?? attrs["bc"] ?? attrs["dof"];
    if (dofTag) {
      for (const d of dofTag.split(/[\s,]+/)) {
        if (d && !dofs.includes(d)) dofs.push(d);
      }
    }
    if (dofs.length === 0) dofs.push("x", "y", "z");

    const value = extractTagNumber(body, "value") ?? extractTagNumber(body, "scale");
    const bcEntry: FebioBoundaryCondition = {
      id,
      name,
      type,
      nodeSet,
      dofs,
      range: makeRange(lineOffsets, bcMatch.index, bcMatch.index + bcMatch[0].length),
    };
    if (value !== undefined) bcEntry.value = value;
    boundaryConditions.push(bcEntry);
  }

  // FEBio 3.x <fix> and <prescribe> tags
  const fixRegex = /<fix\b([^>]*)\/?>/gi;
  let fixMatch: RegExpExecArray | null;
  while ((fixMatch = fixRegex.exec(content)) !== null) {
    const attrs = parseAttributes(fixMatch[1] ?? "");
    const id = `BC_${boundaryConditions.length + 1}`;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? "";
    const dofs = (attrs["bc"] ?? "x,y,z").split(/[\s,]+/).filter(Boolean);
    boundaryConditions.push({
      id,
      name: attrs["name"] ?? id,
      type: "fix",
      nodeSet,
      dofs,
      range: makeRange(lineOffsets, fixMatch.index, fixMatch.index + fixMatch[0].length),
    });
  }

  const prescRegex = /<prescribe\b([^>]*)>([\s\S]*?)<\/prescribe>/gi;
  let prescMatch: RegExpExecArray | null;
  while ((prescMatch = prescRegex.exec(content)) !== null) {
    const attrs = parseAttributes(prescMatch[1] ?? "");
    const body = prescMatch[2] ?? "";
    const id = `BC_${boundaryConditions.length + 1}`;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? "";
    const dofs = (attrs["bc"] ?? attrs["dof"] ?? "z").split(/[\s,]+/).filter(Boolean);
    const val = extractTagNumber(body, "scale") ?? extractTagNumber(body, "value") ?? 0;
    boundaryConditions.push({
      id,
      name: attrs["name"] ?? id,
      type: "prescribed displacement",
      nodeSet,
      dofs,
      value: val,
      range: makeRange(lineOffsets, prescMatch.index, prescMatch.index + prescMatch[0].length),
    });
  }

  // 9. Parse <Loads>
  const loads: FebioLoad[] = [];
  const surfLoadRegex = /<surface_load\b([^>]*)>([\s\S]*?)<\/surface_load>/gi;
  let slMatch: RegExpExecArray | null;
  while ((slMatch = surfLoadRegex.exec(content)) !== null) {
    const attrs = parseAttributes(slMatch[1] ?? "");
    const body = slMatch[2] ?? "";
    const id = `Load_${loads.length + 1}`;
    const name = attrs["name"] ?? id;
    const rawType = (attrs["type"] ?? "pressure").toLowerCase();
    const type: FebioLoad["type"] = rawType.includes("traction") ? "traction" : "pressure";
    const surface = attrs["surface"] ?? extractTagValue(body, "surface");
    const value =
      extractTagNumber(body, "pressure") ?? extractTagNumber(body, "scale") ?? extractTagNumber(body, "value") ?? 0;
    const loadEntry: FebioLoad = {
      id,
      name,
      type,
      value,
      range: makeRange(lineOffsets, slMatch.index, slMatch.index + slMatch[0].length),
    };
    if (surface !== undefined) loadEntry.surface = surface;
    loads.push(loadEntry);
  }

  const nodalLoadRegex = /<nodal_load\b([^>]*)>([\s\S]*?)<\/nodal_load>/gi;
  let nlMatch: RegExpExecArray | null;
  while ((nlMatch = nodalLoadRegex.exec(content)) !== null) {
    const attrs = parseAttributes(nlMatch[1] ?? "");
    const body = nlMatch[2] ?? "";
    const id = `Load_${loads.length + 1}`;
    const name = attrs["name"] ?? id;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? extractTagValue(body, "node_set");
    const dof = attrs["bc"] ?? attrs["dof"] ?? extractTagValue(body, "dof");
    const value = extractTagNumber(body, "scale") ?? extractTagNumber(body, "value") ?? 0;
    const loadEntry: FebioLoad = {
      id,
      name,
      type: "nodal_load",
      value,
      range: makeRange(lineOffsets, nlMatch.index, nlMatch.index + nlMatch[0].length),
    };
    if (nodeSet !== undefined) loadEntry.nodeSet = nodeSet;
    if (dof !== undefined) loadEntry.dof = dof;
    loads.push(loadEntry);
  }

  // 10. Parse <Contact>
  const contacts: FebioContact[] = [];
  const contactRegex = /<contact\b(\s+[^>]*)>([\s\S]*?)<\/contact>|<contact\b(\s+[^>]*)\/>/gi;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = contactRegex.exec(content)) !== null) {
    const attrs = parseAttributes(cMatch[1] ?? cMatch[3] ?? "");
    const body = cMatch[2] ?? "";
    const id = `Contact_${contacts.length + 1}`;
    const name = attrs["name"] ?? attrs["surface_pair"] ?? id;
    const type = attrs["type"] ?? "sliding-elastic";
    const primarySurface =
      attrs["primary"] ?? extractTagValue(body, "primary") ?? extractTagValue(body, "master") ?? "";
    const secondarySurface =
      attrs["secondary"] ?? extractTagValue(body, "secondary") ?? extractTagValue(body, "slave") ?? "";
    const penaltyAttr = attrs["penalty"] !== undefined ? Number(attrs["penalty"]) : undefined;
    const penalty = penaltyAttr ?? extractTagNumber(body, "penalty") ?? 100.0;

    contacts.push({
      id,
      name,
      type,
      primarySurface,
      secondarySurface,
      penalty,
      range: makeRange(lineOffsets, cMatch.index, cMatch.index + cMatch[0].length),
    });
  }

  const doc: FebioDocument = {
    format: "feb",
    version,
    moduleType,
    title,
    materials,
    nodes,
    elements,
    nodeSets,
    surfaces,
    solidDomains,
    boundaryConditions,
    loads,
    contacts,
    sofaNodes: [],
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (control !== undefined) doc.control = control;
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

function parseSofaScnXml(content: string, lineOffsets: number[], sourceUri?: string): FebioDocument {
  const sofaNodes: SofaSceneNode[] = [];
  const materials: FebioMaterial[] = [];
  const nodes: FebioNode[] = [];
  const elements: FebioElement[] = [];
  const nodeSets: FebioNodeSet[] = [];
  const boundaryConditions: FebioBoundaryCondition[] = [];
  const loads: FebioLoad[] = [];

  // Match each <Node ...> opening tag and inspect direct child components before nested <Node>
  const openNodeRegex = /<Node\b([^>]*)>/gi;
  let openMatch: RegExpExecArray | null;
  let title = "SofaSurgicalScene";
  let dt = 0.01;

  while ((openMatch = openNodeRegex.exec(content)) !== null) {
    const attrs = parseAttributes(openMatch[1] ?? "");
    const nodeName = attrs["name"] ?? `SofaNode_${sofaNodes.length + 1}`;
    if (sofaNodes.length === 0) {
      title = nodeName;
      if (attrs["dt"]) {
        const parsedDt = Number(attrs["dt"]);
        if (Number.isFinite(parsedDt)) dt = parsedDt;
      }
    }

    const startIdx = openMatch.index;
    const afterOpenIdx = startIdx + openMatch[0].length;
    // Find the segment belonging directly to this <Node> up to either the next <Node or </Node>
    const nextNodeIdx = content.slice(afterOpenIdx).search(/<\/?Node\b/i);
    const localBody =
      nextNodeIdx >= 0 ? content.slice(afterOpenIdx, afterOpenIdx + nextNodeIdx) : content.slice(afterOpenIdx);
    const endIdx = nextNodeIdx >= 0 ? afterOpenIdx + nextNodeIdx : content.length;
    const nodeRange = makeRange(lineOffsets, startIdx, endIdx);

    const mechMatch = /<MechanicalObject\b([^>]*)\/?>/i.exec(localBody);
    const hasMechanicalObject = mechMatch !== null;
    let mechanicalObjectName: string | undefined;

    if (mechMatch) {
      const mAttrs = parseAttributes(mechMatch[1] ?? "");
      mechanicalObjectName = mAttrs["name"] ?? "DOFs";
      if (mAttrs["position"] && nodes.length === 0) {
        const nums = mAttrs["position"].trim().split(/\s+/).map(Number).filter(Number.isFinite);
        for (let i = 0; i + 2 < nums.length; i += 3) {
          nodes.push({
            id: String(i / 3 + 1),
            x: nums[i]!,
            y: nums[i + 1]!,
            z: nums[i + 2]!,
            range: nodeRange,
          });
        }
      }
    }

    // Check topology for positions and tetrahedra
    const topoMatch = /<(?:MeshTopology|TetrahedronSetTopologyContainer)\b([^>]*)\/?>/i.exec(localBody);
    if (topoMatch) {
      const tAttrs = parseAttributes(topoMatch[1] ?? "");
      if (tAttrs["position"] && nodes.length === 0) {
        const nums = tAttrs["position"].trim().split(/\s+/).map(Number).filter(Number.isFinite);
        for (let i = 0; i + 2 < nums.length; i += 3) {
          nodes.push({
            id: String(i / 3 + 1),
            x: nums[i]!,
            y: nums[i + 1]!,
            z: nums[i + 2]!,
            range: nodeRange,
          });
        }
      }
      if (tAttrs["tetrahedra"]) {
        const tetIds = tAttrs["tetrahedra"].trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i + 3 < tetIds.length; i += 4) {
          // SOFA uses 0-based indexing if '0' is present
          const usesZeroBase = tetIds.includes("0");
          const mapIdx = (raw: string) => (usesZeroBase ? String(Number(raw) + 1) : raw);
          elements.push({
            id: String(elements.length + 1),
            type: "tet4",
            nodeIds: [mapIdx(tetIds[i]!), mapIdx(tetIds[i + 1]!), mapIdx(tetIds[i + 2]!), mapIdx(tetIds[i + 3]!)],
            range: nodeRange,
          });
        }
      }
    }

    // Parse ForceFields inside this <Node>
    const forceFields: SofaForceField[] = [];
    const ffRegex = /<([A-Za-z0-9_]*ForceField)\b([^>]*)\/?>/gi;
    let ffMatch: RegExpExecArray | null;
    while ((ffMatch = ffRegex.exec(localBody)) !== null) {
      const ffType = ffMatch[1] ?? "TetrahedronFEMForceField";
      if (ffType === "ConstantForceField" || ffType === "LinearForceField") {
        const cAttrs = parseAttributes(ffMatch[2] ?? "");
        const forceVals = (cAttrs["forces"] ?? cAttrs["force"] ?? "0 0 -1").trim().split(/\s+/).map(Number);
        const mag = Math.hypot(forceVals[0] ?? 0, forceVals[1] ?? 0, forceVals[2] ?? 0);
        loads.push({
          id: `Load_${loads.length + 1}`,
          name: cAttrs["name"] ?? ffType,
          type: "nodal_load",
          value: mag,
          range: makeRange(lineOffsets, afterOpenIdx + ffMatch.index, afterOpenIdx + ffMatch.index + ffMatch[0].length),
        });
        continue;
      }

      const ffAttrs = parseAttributes(ffMatch[2] ?? "");
      const ffName = ffAttrs["name"] ?? ffType;
      const youngModulus = ffAttrs["youngModulus"] !== undefined ? Number(ffAttrs["youngModulus"]) : undefined;
      const poissonRatio = ffAttrs["poissonRatio"] !== undefined ? Number(ffAttrs["poissonRatio"]) : undefined;
      const stiffness = ffAttrs["stiffness"] !== undefined ? Number(ffAttrs["stiffness"]) : undefined;
      const ffRange = makeRange(
        lineOffsets,
        afterOpenIdx + ffMatch.index,
        afterOpenIdx + ffMatch.index + ffMatch[0].length,
      );

      const ff: SofaForceField = {
        type: ffType,
        name: ffName,
        range: ffRange,
      };
      if (youngModulus !== undefined) ff.youngModulus = youngModulus;
      if (poissonRatio !== undefined) ff.poissonRatio = poissonRatio;
      if (stiffness !== undefined) ff.stiffness = stiffness;
      forceFields.push(ff);

      if (youngModulus !== undefined || poissonRatio !== undefined) {
        const mat: FebioMaterial = {
          id: String(materials.length + 1),
          name: ffName,
          type: "neo-Hookean",
          range: ffRange,
        };
        if (youngModulus !== undefined) mat.E = youngModulus;
        if (poissonRatio !== undefined) mat.v = poissonRatio;
        materials.push(mat);
      }
    }

    // Parse FixedConstraint inside this <Node>
    const fixedMatch = /<(?:FixedConstraint|FixedProjectiveConstraint)\b([^>]*)\/?>/i.exec(localBody);
    const hasFixedConstraint = fixedMatch !== null;
    const fixedIndices: number[] = [];
    if (fixedMatch) {
      const fAttrs = parseAttributes(fixedMatch[1] ?? "");
      const idxList = (fAttrs["indices"] ?? "0")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      fixedIndices.push(...idxList);
      const nsName = `${nodeName}_FixedSet`;
      const mappedIds = idxList.map((idx) => String(idx + 1)).filter((nid) => nodes.some((n) => n.id === nid));
      if (mappedIds.length > 0) {
        nodeSets.push({
          name: nsName,
          nodeIds: mappedIds,
          range: nodeRange,
        });
      }
      boundaryConditions.push({
        id: `BC_${boundaryConditions.length + 1}`,
        name: fAttrs["name"] ?? "FixedConstraint",
        type: "fix",
        nodeSet: mappedIds.length > 0 ? nsName : "",
        dofs: ["x", "y", "z"],
        range: nodeRange,
      });
    }

    const sNode: SofaSceneNode = {
      name: nodeName,
      hasMechanicalObject,
      forceFields,
      hasFixedConstraint,
      fixedIndices,
      range: nodeRange,
    };
    if (mechanicalObjectName !== undefined) {
      sNode.mechanicalObjectName = mechanicalObjectName;
    }
    sofaNodes.push(sNode);
  }

  const doc: FebioDocument = {
    format: "scn",
    version: "23.12",
    moduleType: "sofa",
    title,
    control: {
      analysis: "DYNAMIC",
      timeSteps: 100,
      stepSize: dt,
      range: makeRange(lineOffsets, 0, content.length),
    },
    materials,
    nodes,
    elements,
    nodeSets,
    surfaces: [],
    solidDomains: [],
    boundaryConditions,
    loads,
    contacts: [],
    sofaNodes,
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

function parseFebioDsl(content: string, lineOffsets: number[], sourceUri?: string): FebioDocument {
  const materials: FebioMaterial[] = [];
  const nodes: FebioNode[] = [];
  const elements: FebioElement[] = [];
  const nodeSets: FebioNodeSet[] = [];
  const surfaces: FebioSurface[] = [];
  const solidDomains: FebioSolidDomain[] = [];
  const boundaryConditions: FebioBoundaryCondition[] = [];
  const loads: FebioLoad[] = [];
  const contacts: FebioContact[] = [];
  const sofaNodes: SofaSceneNode[] = [];
  let control: FebioControl | undefined;
  let title = "FEBioModel";
  let version = "4.0";
  let moduleType = "solid";
  let format: FebioFormat = "dsl";

  const lines = content.split(/\r?\n/);
  let offset = 0;

  for (const rawLine of lines) {
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const range = makeRange(lineOffsets, lineStart, lineEnd);
    const kv = parseAttributes(line);
    const tokens = line.split(/\s+/);
    const head = (tokens[0] ?? "").toUpperCase();

    if (head === "FEBIO") {
      version = tokens[1] ?? "4.0";
      if (kv["title"]) title = kv["title"];
      if (kv["module"]) moduleType = kv["module"];
    } else if (head === "CONTROL") {
      const analysisRaw = (kv["analysis"] ?? "STATIC").toUpperCase();
      control = {
        analysis:
          analysisRaw === "DYNAMIC" || analysisRaw === "BIPHASIC" || analysisRaw === "STEADY-STATE"
            ? analysisRaw
            : "STATIC",
        timeSteps: Number(kv["steps"] ?? kv["time_steps"] ?? 10),
        stepSize: Number(kv["dt"] ?? kv["step_size"] ?? 0.1),
        range,
      };
    } else if (head === "MATERIAL") {
      const id = kv["id"] ?? tokens[1] ?? String(materials.length + 1);
      const name = kv["name"] ?? `Mat_${id}`;
      const type = kv["type"] ?? "neo-Hookean";
      const mat: FebioMaterial = { id, name, type, range };
      if (kv["E"] !== undefined) mat.E = Number(kv["E"]);
      if (kv["v"] !== undefined) mat.v = Number(kv["v"]);
      if (kv["density"] !== undefined) mat.density = Number(kv["density"]);
      if (kv["c1"] !== undefined) mat.c1 = Number(kv["c1"]);
      if (kv["c2"] !== undefined) mat.c2 = Number(kv["c2"]);
      if (kv["k"] !== undefined) mat.k = Number(kv["k"]);
      if (kv["perm"] !== undefined) mat.perm = Number(kv["perm"]);
      if (kv["phi0"] !== undefined) mat.phi0 = Number(kv["phi0"]);
      materials.push(mat);
    } else if (head === "NODE") {
      const id = kv["id"] ?? tokens[1] ?? String(nodes.length + 1);
      const x = Number(kv["x"] ?? tokens[2] ?? 0);
      const y = Number(kv["y"] ?? tokens[3] ?? 0);
      const z = Number(kv["z"] ?? tokens[4] ?? 0);
      nodes.push({ id, x, y, z, range });
    } else if (head === "ELEMENT") {
      const id = kv["id"] ?? tokens[1] ?? String(elements.length + 1);
      const rawType = (kv["type"] ?? tokens[2] ?? "tet4").toLowerCase();
      const type: FebioElementType = rawType === "hex8" || rawType === "tri3" || rawType === "quad4" ? rawType : "tet4";
      const nodeIds = (kv["nodes"] ?? "").split(/[\s,]+/).filter(Boolean);
      const el: FebioElement = { id, type, nodeIds, range };
      if (kv["mat"] !== undefined) el.materialId = kv["mat"];
      if (kv["domain"] !== undefined) el.domainName = kv["domain"];
      elements.push(el);
    } else if (head === "NODESET") {
      const name = kv["name"] ?? tokens[1] ?? `NodeSet_${nodeSets.length + 1}`;
      const nodeIds = (kv["nodes"] ?? "").split(/[\s,]+/).filter(Boolean);
      nodeSets.push({ name, nodeIds, range });
    } else if (head === "SURFACE") {
      const name = kv["name"] ?? tokens[1] ?? `Surface_${surfaces.length + 1}`;
      const nodeIds = (kv["nodes"] ?? "").split(/[\s,]+/).filter(Boolean);
      const facets: FebioSurfaceFacet[] =
        nodeIds.length > 0 ? [{ id: "1", type: nodeIds.length === 4 ? "quad4" : "tri3", nodeIds, range }] : [];
      surfaces.push({ name, facets, range });
    } else if (head === "DOMAIN") {
      const name = kv["name"] ?? tokens[1] ?? `Domain_${solidDomains.length + 1}`;
      const materialId = kv["mat"] ?? "";
      solidDomains.push({ name, materialId, range });
    } else if (head === "BC") {
      const id = kv["id"] ?? tokens[1] ?? `BC_${boundaryConditions.length + 1}`;
      const name = kv["name"] ?? id;
      const nodeSet = kv["node_set"] ?? kv["set"] ?? "";
      const dofs = (kv["dofs"] ?? "x,y,z").split(/[\s,]+/).filter(Boolean);
      const rawType = (kv["type"] ?? "fix").toLowerCase();
      const type: FebioBoundaryCondition["type"] = rawType.includes("prescribe") ? "prescribed displacement" : "fix";
      const bc: FebioBoundaryCondition = { id, name, type, nodeSet, dofs, range };
      if (kv["value"] !== undefined) bc.value = Number(kv["value"]);
      boundaryConditions.push(bc);
    } else if (head === "LOAD") {
      const id = kv["id"] ?? tokens[1] ?? `Load_${loads.length + 1}`;
      const name = kv["name"] ?? id;
      const value = Number(kv["value"] ?? kv["pressure"] ?? 0);
      const load: FebioLoad = {
        id,
        name,
        type: kv["surface"] ? "pressure" : "nodal_load",
        value,
        range,
      };
      if (kv["surface"] !== undefined) load.surface = kv["surface"];
      if (kv["node_set"] !== undefined) load.nodeSet = kv["node_set"];
      loads.push(load);
    } else if (head === "CONTACT") {
      const id = kv["id"] ?? tokens[1] ?? `Contact_${contacts.length + 1}`;
      const name = kv["name"] ?? id;
      contacts.push({
        id,
        name,
        type: kv["type"] ?? "sliding-elastic",
        primarySurface: kv["primary"] ?? "",
        secondarySurface: kv["secondary"] ?? "",
        penalty: Number(kv["penalty"] ?? 100),
        range,
      });
    } else if (head === "SOFA_NODE") {
      format = "scn";
      const name = kv["name"] ?? tokens[1] ?? `SofaNode_${sofaNodes.length + 1}`;
      const hasMechanicalObject = kv["mechanicalObject"] !== "false";
      const ffType = kv["forceField"];
      const forceFields: SofaForceField[] = ffType ? [{ type: ffType, name: ffType, range }] : [];
      const hasFixedConstraint = kv["fixed"] === "true";
      sofaNodes.push({
        name,
        hasMechanicalObject,
        forceFields,
        hasFixedConstraint,
        fixedIndices: hasFixedConstraint ? [0] : [],
        range,
      });
    }
  }

  const doc: FebioDocument = {
    format,
    version,
    moduleType,
    title,
    materials,
    nodes,
    elements,
    nodeSets,
    surfaces,
    solidDomains,
    boundaryConditions,
    loads,
    contacts,
    sofaNodes,
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (control !== undefined) doc.control = control;
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}
