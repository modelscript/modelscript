// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Parser for FEBio 3.x/4.x (.feb) XML, SOFA Framework (.scn) XML,
 * and line-oriented Biomechanics DSL.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
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

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function matchTag(el: XmlElement, name: string): boolean {
  return localName(el.name).toLowerCase() === name.toLowerCase();
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  const attr = el.attributes.find((a: XmlAttribute) => localName(a.name).toLowerCase() === target);
  return attr?.value;
}

function getAttrsMap(el: XmlElement): Record<string, string> {
  const res: Record<string, string> = {};
  for (const a of el.attributes) {
    res[localName(a.name)] = a.value;
  }
  return res;
}

function getChild(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  return el.children.find((c: XmlElement) => matchTag(c, name));
}

function getChildren(el: XmlElement | null | undefined, name?: string): XmlElement[] {
  if (!el) return [];
  if (!name) return el.children;
  return el.children.filter((c: XmlElement) => matchTag(c, name));
}

function findDescendants(el: XmlElement | null | undefined, predicate: (e: XmlElement) => boolean): XmlElement[] {
  if (!el) return [];
  const res: XmlElement[] = [];
  function walk(node: XmlElement) {
    for (const child of node.children) {
      if (predicate(child)) res.push(child);
      walk(child);
    }
  }
  walk(el);
  return res;
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

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const num = Number(raw.trim());
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
  const xmlDoc = parseXml(content);
  const root = xmlDoc.root;
  const specEl =
    root && matchTag(root, "febio_spec") ? root : (findDescendants(root, (e) => matchTag(e, "febio_spec"))[0] ?? root);

  const version = (specEl ? getAttr(specEl, "version") : undefined) ?? "4.0";
  const moduleEl = specEl
    ? (getChild(specEl, "Module") ?? findDescendants(specEl, (e) => matchTag(e, "Module"))[0])
    : undefined;
  const moduleType = (moduleEl ? getAttr(moduleEl, "type") : undefined) ?? "solid";
  const titleEl = specEl ? getChild(specEl, "title") : undefined;
  const title = titleEl ? titleEl.text.trim() : "FEBioBiomechanicsModel";

  // 1. Parse <Control>
  let control: FebioControl | undefined;
  const controlEl = specEl
    ? (getChild(specEl, "Control") ?? findDescendants(specEl, (e) => matchTag(e, "Control"))[0])
    : undefined;
  if (controlEl) {
    const analysisRaw = (getChild(controlEl, "analysis")?.text.trim() ?? "STATIC").toUpperCase();
    const analysis =
      analysisRaw === "DYNAMIC" || analysisRaw === "BIPHASIC" || analysisRaw === "STEADY-STATE"
        ? analysisRaw
        : "STATIC";
    const timeSteps = parseNumber(getChild(controlEl, "time_steps")?.text) ?? 10;
    const stepSize = parseNumber(getChild(controlEl, "step_size")?.text) ?? 0.1;
    const maxRefs = parseNumber(getChild(controlEl, "max_refs")?.text);
    const dtol = parseNumber(getChild(controlEl, "dtol")?.text);
    control = {
      analysis,
      timeSteps,
      stepSize,
      range: makeRange(lineOffsets, controlEl.start, controlEl.end),
    };
    if (maxRefs !== undefined) control.maxRefs = maxRefs;
    if (dtol !== undefined) control.dtol = dtol;
  }

  // 2. Parse <Material>
  const materials: FebioMaterial[] = [];
  const materialContainer = specEl ? getChild(specEl, "Material") : undefined;
  const matEls = materialContainer
    ? getChildren(materialContainer, "material")
    : findDescendants(specEl, (e) => matchTag(e, "material"));
  for (const matEl of matEls) {
    const attrs = getAttrsMap(matEl);
    const id = attrs["id"] ?? String(materials.length + 1);
    const name = attrs["name"] ?? `Mat_${id}`;
    const type = attrs["type"] ?? "neo-Hookean";

    const E = parseNumber(getChild(matEl, "E")?.text);
    const v = parseNumber(getChild(matEl, "v")?.text);
    const density = parseNumber(getChild(matEl, "density")?.text);
    const c1 = parseNumber(getChild(matEl, "c1")?.text);
    const c2 = parseNumber(getChild(matEl, "c2")?.text);
    const k = parseNumber(getChild(matEl, "k")?.text);
    const perm = parseNumber(getChild(matEl, "perm")?.text ?? getChild(matEl, "permeability")?.text);
    const phi0 = parseNumber(getChild(matEl, "phi0")?.text);

    const mat: FebioMaterial = {
      id,
      name,
      type,
      range: makeRange(lineOffsets, matEl.start, matEl.end),
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

  // 3. Parse <Nodes> / <node>
  const nodes: FebioNode[] = [];
  const nodeEls = findDescendants(specEl, (e) => matchTag(e, "node"));
  for (const nodeEl of nodeEls) {
    if (nodeEl.parent && (matchTag(nodeEl.parent, "NodeSet") || matchTag(nodeEl.parent, "bc"))) continue;
    const attrs = getAttrsMap(nodeEl);
    const id = attrs["id"] ?? String(nodes.length + 1);
    const coords = nodeEl.text
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    nodes.push({
      id,
      x: coords[0] ?? 0,
      y: coords[1] ?? 0,
      z: coords[2] ?? 0,
      range: makeRange(lineOffsets, nodeEl.start, nodeEl.end),
    });
  }

  // 4. Parse <Elements>
  const elements: FebioElement[] = [];
  const elemsContainer = findDescendants(specEl, (e) => matchTag(e, "Elements"));
  for (const elemsEl of elemsContainer) {
    const blockAttrs = getAttrsMap(elemsEl);
    const rawType = (blockAttrs["type"] ?? "tet4").toLowerCase();
    const elemType: FebioElementType =
      rawType === "hex8" || rawType === "tri3" || rawType === "quad4" ? rawType : "tet4";
    const domainName = blockAttrs["name"];
    const matId = blockAttrs["mat"];

    for (const elemEl of elemsEl.children) {
      if (
        !matchTag(elemEl, "elem") &&
        !matchTag(elemEl, "tet4") &&
        !matchTag(elemEl, "hex8") &&
        !matchTag(elemEl, "tri3") &&
        !matchTag(elemEl, "quad4")
      ) {
        continue;
      }
      const eAttrs = getAttrsMap(elemEl);
      const id = eAttrs["id"] ?? String(elements.length + 1);
      const nodeIds = elemEl.text
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      const elem: FebioElement = {
        id,
        type: elemType,
        nodeIds,
        range: makeRange(lineOffsets, elemEl.start, elemEl.end),
      };
      if (domainName !== undefined) elem.domainName = domainName;
      if (matId !== undefined) elem.materialId = matId;
      elements.push(elem);
    }
  }

  // 5. Parse <NodeSet>
  const nodeSets: FebioNodeSet[] = [];
  const nsEls = findDescendants(specEl, (e) => matchTag(e, "NodeSet"));
  for (const nsEl of nsEls) {
    const attrs = getAttrsMap(nsEl);
    const name = attrs["name"] ?? `NodeSet_${nodeSets.length + 1}`;
    const nodeIds: string[] = [];
    for (const cn of nsEl.children) {
      if (matchTag(cn, "node") || matchTag(cn, "n")) {
        const cAttrs = getAttrsMap(cn);
        if (cAttrs["id"]) {
          nodeIds.push(cAttrs["id"]);
        }
      }
    }
    if (nodeIds.length === 0) {
      const stripped = nsEl.text.trim();
      if (stripped) {
        for (const tok of stripped.split(/[\s,]+/)) {
          if (tok) nodeIds.push(tok);
        }
      }
    }
    nodeSets.push({
      name,
      nodeIds,
      range: makeRange(lineOffsets, nsEl.start, nsEl.end),
    });
  }

  // 6. Parse <Surface>
  const surfaces: FebioSurface[] = [];
  const surfEls = findDescendants(specEl, (e) => matchTag(e, "Surface"));
  for (const surfEl of surfEls) {
    const attrs = getAttrsMap(surfEl);
    const name = attrs["name"] ?? `Surface_${surfaces.length + 1}`;
    const facets: FebioSurfaceFacet[] = [];
    for (const fEl of surfEl.children) {
      if (!matchTag(fEl, "tri3") && !matchTag(fEl, "quad4")) continue;
      const fType = matchTag(fEl, "quad4") ? "quad4" : "tri3";
      const fAttrs = getAttrsMap(fEl);
      const fId = fAttrs["id"] ?? String(facets.length + 1);
      const nodeIds = fEl.text
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      facets.push({
        id: fId,
        type: fType,
        nodeIds,
        range: makeRange(lineOffsets, fEl.start, fEl.end),
      });
    }
    surfaces.push({
      name,
      facets,
      range: makeRange(lineOffsets, surfEl.start, surfEl.end),
    });
  }

  // 7. Parse <MeshDomains> / <SolidDomain>
  const solidDomains: FebioSolidDomain[] = [];
  const sdEls = findDescendants(specEl, (e) => matchTag(e, "SolidDomain"));
  for (const sdEl of sdEls) {
    const attrs = getAttrsMap(sdEl);
    const name = attrs["name"] ?? `Domain_${solidDomains.length + 1}`;
    const materialId = attrs["mat"] ?? "";
    solidDomains.push({
      name,
      materialId,
      range: makeRange(lineOffsets, sdEl.start, sdEl.end),
    });
    for (const el of elements) {
      if (el.domainName === name && el.materialId === undefined && materialId) {
        el.materialId = materialId;
      }
    }
  }

  // 8. Parse <Boundary> / <bc>, <fix>, <prescribe>
  const boundaryConditions: FebioBoundaryCondition[] = [];
  const bcEls = findDescendants(specEl, (e) => matchTag(e, "bc"));
  for (const bcEl of bcEls) {
    const attrs = getAttrsMap(bcEl);
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
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? getChild(bcEl, "node_set")?.text.trim() ?? "";

    const dofs: string[] = [];
    if (parseNumber(getChild(bcEl, "x_dof")?.text) === 1) dofs.push("x");
    if (parseNumber(getChild(bcEl, "y_dof")?.text) === 1) dofs.push("y");
    if (parseNumber(getChild(bcEl, "z_dof")?.text) === 1) dofs.push("z");
    const dofTag = getChild(bcEl, "dof")?.text.trim() ?? attrs["bc"] ?? attrs["dof"];
    if (dofTag) {
      for (const d of dofTag.split(/[\s,]+/)) {
        if (d && !dofs.includes(d)) dofs.push(d);
      }
    }
    if (dofs.length === 0) dofs.push("x", "y", "z");

    const value = parseNumber(getChild(bcEl, "value")?.text) ?? parseNumber(getChild(bcEl, "scale")?.text);
    const bcEntry: FebioBoundaryCondition = {
      id,
      name,
      type,
      nodeSet,
      dofs,
      range: makeRange(lineOffsets, bcEl.start, bcEl.end),
    };
    if (value !== undefined) bcEntry.value = value;
    boundaryConditions.push(bcEntry);
  }

  const fixEls = findDescendants(specEl, (e) => matchTag(e, "fix"));
  for (const fixEl of fixEls) {
    const attrs = getAttrsMap(fixEl);
    const id = `BC_${boundaryConditions.length + 1}`;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? "";
    const dofs = (attrs["bc"] ?? "x,y,z").split(/[\s,]+/).filter(Boolean);
    boundaryConditions.push({
      id,
      name: attrs["name"] ?? id,
      type: "fix",
      nodeSet,
      dofs,
      range: makeRange(lineOffsets, fixEl.start, fixEl.end),
    });
  }

  const prescEls = findDescendants(specEl, (e) => matchTag(e, "prescribe"));
  for (const prescEl of prescEls) {
    const attrs = getAttrsMap(prescEl);
    const id = `BC_${boundaryConditions.length + 1}`;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? "";
    const dofs = (attrs["bc"] ?? attrs["dof"] ?? "z").split(/[\s,]+/).filter(Boolean);
    const val = parseNumber(getChild(prescEl, "scale")?.text) ?? parseNumber(getChild(prescEl, "value")?.text) ?? 0;
    boundaryConditions.push({
      id,
      name: attrs["name"] ?? id,
      type: "prescribed displacement",
      nodeSet,
      dofs,
      value: val,
      range: makeRange(lineOffsets, prescEl.start, prescEl.end),
    });
  }

  // 9. Parse <Loads> / <surface_load>, <nodal_load>
  const loads: FebioLoad[] = [];
  const slEls = findDescendants(specEl, (e) => matchTag(e, "surface_load"));
  for (const slEl of slEls) {
    const attrs = getAttrsMap(slEl);
    const id = `Load_${loads.length + 1}`;
    const name = attrs["name"] ?? id;
    const rawType = (attrs["type"] ?? "pressure").toLowerCase();
    const type: FebioLoad["type"] = rawType.includes("traction") ? "traction" : "pressure";
    const surface = attrs["surface"] ?? getChild(slEl, "surface")?.text.trim();
    const value =
      parseNumber(getChild(slEl, "pressure")?.text) ??
      parseNumber(getChild(slEl, "scale")?.text) ??
      parseNumber(getChild(slEl, "value")?.text) ??
      0;
    const loadEntry: FebioLoad = {
      id,
      name,
      type,
      value,
      range: makeRange(lineOffsets, slEl.start, slEl.end),
    };
    if (surface !== undefined) loadEntry.surface = surface;
    loads.push(loadEntry);
  }

  const nlEls = findDescendants(specEl, (e) => matchTag(e, "nodal_load"));
  for (const nlEl of nlEls) {
    const attrs = getAttrsMap(nlEl);
    const id = `Load_${loads.length + 1}`;
    const name = attrs["name"] ?? id;
    const nodeSet = attrs["node_set"] ?? attrs["set"] ?? getChild(nlEl, "node_set")?.text.trim();
    const dof = attrs["bc"] ?? attrs["dof"] ?? getChild(nlEl, "dof")?.text.trim();
    const value = parseNumber(getChild(nlEl, "scale")?.text) ?? parseNumber(getChild(nlEl, "value")?.text) ?? 0;
    const loadEntry: FebioLoad = {
      id,
      name,
      type: "nodal_load",
      value,
      range: makeRange(lineOffsets, nlEl.start, nlEl.end),
    };
    if (nodeSet !== undefined) loadEntry.nodeSet = nodeSet;
    if (dof !== undefined) loadEntry.dof = dof;
    loads.push(loadEntry);
  }

  // 10. Parse <Contact> / <contact>
  const contacts: FebioContact[] = [];
  const contactEls = findDescendants(specEl, (e) => matchTag(e, "contact"));
  for (const cEl of contactEls) {
    const attrs = getAttrsMap(cEl);
    const id = `Contact_${contacts.length + 1}`;
    const name = attrs["name"] ?? attrs["surface_pair"] ?? id;
    const type = attrs["type"] ?? "sliding-elastic";
    const primarySurface =
      attrs["primary"] ?? getChild(cEl, "primary")?.text.trim() ?? getChild(cEl, "master")?.text.trim() ?? "";
    const secondarySurface =
      attrs["secondary"] ?? getChild(cEl, "secondary")?.text.trim() ?? getChild(cEl, "slave")?.text.trim() ?? "";
    const penaltyAttr = attrs["penalty"] !== undefined ? Number(attrs["penalty"]) : undefined;
    const penalty = penaltyAttr ?? parseNumber(getChild(cEl, "penalty")?.text) ?? 100.0;

    contacts.push({
      id,
      name,
      type,
      primarySurface,
      secondarySurface,
      penalty,
      range: makeRange(lineOffsets, cEl.start, cEl.end),
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
  const xmlDoc = parseXml(content);
  const root = xmlDoc.root;
  const sofaNodes: SofaSceneNode[] = [];
  const materials: FebioMaterial[] = [];
  const nodes: FebioNode[] = [];
  const elements: FebioElement[] = [];
  const nodeSets: FebioNodeSet[] = [];
  const boundaryConditions: FebioBoundaryCondition[] = [];
  const loads: FebioLoad[] = [];

  const allNodeEls: XmlElement[] = [];
  if (root) {
    if (matchTag(root, "Node")) allNodeEls.push(root);
    allNodeEls.push(...findDescendants(root, (e) => matchTag(e, "Node")));
  }

  let title = "SofaSurgicalScene";
  let dt = 0.01;

  for (const nodeEl of allNodeEls) {
    const attrs = getAttrsMap(nodeEl);
    const nodeName = attrs["name"] ?? `SofaNode_${sofaNodes.length + 1}`;
    if (sofaNodes.length === 0) {
      title = nodeName;
      if (attrs["dt"]) {
        const parsedDt = Number(attrs["dt"]);
        if (Number.isFinite(parsedDt)) dt = parsedDt;
      }
    }

    const nodeRange = makeRange(lineOffsets, nodeEl.start, nodeEl.end);
    const directChildren = nodeEl.children.filter((c) => !matchTag(c, "Node"));

    const mechEl = directChildren.find((c) => matchTag(c, "MechanicalObject"));
    const hasMechanicalObject = mechEl !== undefined;
    let mechanicalObjectName: string | undefined;

    if (mechEl) {
      const mAttrs = getAttrsMap(mechEl);
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

    const topoEl = directChildren.find(
      (c) => matchTag(c, "MeshTopology") || matchTag(c, "TetrahedronSetTopologyContainer"),
    );
    if (topoEl) {
      const tAttrs = getAttrsMap(topoEl);
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

    const forceFields: SofaForceField[] = [];
    const ffEls = directChildren.filter((c) => localName(c.name).toLowerCase().endsWith("forcefield"));
    for (const ffEl of ffEls) {
      const ffType = localName(ffEl.name);
      if (ffType === "ConstantForceField" || ffType === "LinearForceField") {
        const cAttrs = getAttrsMap(ffEl);
        const forceVals = (cAttrs["forces"] ?? cAttrs["force"] ?? "0 0 -1").trim().split(/\s+/).map(Number);
        const mag = Math.hypot(forceVals[0] ?? 0, forceVals[1] ?? 0, forceVals[2] ?? 0);
        loads.push({
          id: `Load_${loads.length + 1}`,
          name: cAttrs["name"] ?? ffType,
          type: "nodal_load",
          value: mag,
          range: makeRange(lineOffsets, ffEl.start, ffEl.end),
        });
        continue;
      }

      const ffAttrs = getAttrsMap(ffEl);
      const ffName = ffAttrs["name"] ?? ffType;
      const youngModulus = ffAttrs["youngModulus"] !== undefined ? Number(ffAttrs["youngModulus"]) : undefined;
      const poissonRatio = ffAttrs["poissonRatio"] !== undefined ? Number(ffAttrs["poissonRatio"]) : undefined;
      const stiffness = ffAttrs["stiffness"] !== undefined ? Number(ffAttrs["stiffness"]) : undefined;
      const ffRange = makeRange(lineOffsets, ffEl.start, ffEl.end);

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

    const fixedEl = directChildren.find(
      (c) => matchTag(c, "FixedConstraint") || matchTag(c, "FixedProjectiveConstraint"),
    );
    const hasFixedConstraint = fixedEl !== undefined;
    const fixedIndices: number[] = [];
    if (fixedEl) {
      const fAttrs = getAttrsMap(fixedEl);
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
