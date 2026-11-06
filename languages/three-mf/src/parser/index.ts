// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — ISO/ASTM 52915 3MF & Medical Extension Parser.
 *
 * Parses 3MF XML `<model>` documents (`<basematerials>`, `<object>`, `<mesh>`,
 * `<vertices>`, `<triangles>`, `<medical:SurgicalGuide>`, `<build><item>`)
 * as well as JSON serialized representations.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
import type {
  ThreeMfBaseMaterial,
  ThreeMfBaseMaterialsGroup,
  ThreeMfBuildItem,
  ThreeMfDocument,
  ThreeMfDrillSleeve,
  ThreeMfObject,
  ThreeMfOsteotomyPlane,
  ThreeMfSourceRange,
  ThreeMfSurgicalGuideSpec,
  ThreeMfTriangle,
  ThreeMfUnit,
  ThreeMfVertex,
} from "../types.js";

function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = lineOffsets[mid]!;
    if (midVal <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  return {
    line: lineIndex + 1,
    column: offset - (lineOffsets[lineIndex] ?? 0) + 1,
  };
}

function makeRange(startOffset: number, endOffset: number, lineOffsets: number[]): ThreeMfSourceRange {
  const start = offsetToLineCol(startOffset, lineOffsets);
  const end = offsetToLineCol(endOffset, lineOffsets);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
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
  const attr = el.attributes.find(
    (a: XmlAttribute) => localName(a.name).toLowerCase() === target || a.name.toLowerCase() === target,
  );
  return attr?.value;
}

function getAttrsMap(el: XmlElement): Record<string, string> {
  const res: Record<string, string> = {};
  for (const a of el.attributes) {
    res[localName(a.name)] = a.value;
    res[a.name] = a.value;
  }
  return res;
}

function getChild(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  return el.children.find((c: XmlElement) => matchTag(c, name));
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

function parseVec3(raw: string | undefined, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!raw) return fallback;
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (nums.length >= 3 && nums.every((n) => !Number.isNaN(n))) {
    return [nums[0]!, nums[1]!, nums[2]!];
  }
  return fallback;
}

export function parseThreeMf(text: string, sourceUri?: string): ThreeMfDocument {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = JSON.parse(trimmed) as ThreeMfDocument;
    if (sourceUri !== undefined) {
      parsed.sourceUri = sourceUri;
    }
    return parsed;
  }

  const lineOffsets = computeLineOffsets(text);
  const docRange = makeRange(0, text.length, lineOffsets);

  const xmlDoc = parseXml(text);
  const root = xmlDoc.root;
  const modelEl =
    root && matchTag(root, "model") ? root : (findDescendants(root, (e) => matchTag(e, "model"))[0] ?? root);

  let unit: ThreeMfUnit = "millimeter";
  if (modelEl) {
    const unitAttr = getAttr(modelEl, "unit");
    if (unitAttr) {
      unit = unitAttr as ThreeMfUnit;
    }
  }

  // 1. Parse <metadata name="...">value</metadata>
  const metadata: Record<string, string> = {};
  const metaEls = modelEl ? findDescendants(modelEl, (e) => matchTag(e, "metadata")) : [];
  for (const metaEl of metaEls) {
    const name = getAttr(metaEl, "name");
    if (name) {
      metadata[name] = metaEl.text.trim();
    }
  }

  // 2. Parse <basematerials id="...">
  const baseMaterialGroups: ThreeMfBaseMaterialsGroup[] = [];
  const bmGroupEls = modelEl ? findDescendants(modelEl, (e) => matchTag(e, "basematerials")) : [];
  for (const bmGroupEl of bmGroupEls) {
    const groupId = getAttr(bmGroupEl, "id") ?? "1";
    const materials: ThreeMfBaseMaterial[] = [];
    let idx = 0;
    for (const baseEl of bmGroupEl.children) {
      if (!matchTag(baseEl, "base")) continue;
      const bAttrs = getAttrsMap(baseEl);
      materials.push({
        index: idx++,
        name: bAttrs["name"] ?? `Material_${idx}`,
        displayColor: bAttrs["displaycolor"],
        range: makeRange(baseEl.start, baseEl.end, lineOffsets),
      });
    }
    baseMaterialGroups.push({
      id: groupId,
      materials,
      range: makeRange(bmGroupEl.start, bmGroupEl.end, lineOffsets),
    });
  }

  const resolveMaterialName = (pid?: string, pindex?: number): string | undefined => {
    if (!pid) return undefined;
    const grp = baseMaterialGroups.find((g) => g.id === pid);
    if (!grp) return undefined;
    const mat = grp.materials[pindex ?? 0];
    return mat?.name;
  };

  // 3. Parse <object ...>...</object>
  const objects: ThreeMfObject[] = [];
  const objEls = modelEl ? findDescendants(modelEl, (e) => matchTag(e, "object")) : [];
  for (const objEl of objEls) {
    const objAttrs = getAttrsMap(objEl);
    const objRange = makeRange(objEl.start, objEl.end, lineOffsets);

    const id = objAttrs["id"] ?? "";
    const name = objAttrs["name"];
    const rawType = (objAttrs["type"] ?? "model") as ThreeMfObject["type"];
    const pid = objAttrs["pid"];
    const pindex = objAttrs["pindex"] !== undefined ? Number(objAttrs["pindex"]) : undefined;
    let materialName = objAttrs["material"] ?? objAttrs["medical:material"] ?? resolveMaterialName(pid, pindex);
    let wallThicknessMm =
      objAttrs["wallThickness"] !== undefined
        ? Number(objAttrs["wallThickness"])
        : objAttrs["medical:wallThickness"] !== undefined
          ? Number(objAttrs["medical:wallThickness"])
          : undefined;
    let isMedicalDevice =
      objAttrs["medical:device"] === "true" ||
      objAttrs["isMedicalDevice"] === "true" ||
      Boolean(name && /guide|implant|osteotomy|cannula|cranio|prosthesis|splint/i.test(name));

    // Parse <mesh>
    const vertices: ThreeMfVertex[] = [];
    const triangles: ThreeMfTriangle[] = [];
    const meshEl = getChild(objEl, "mesh");
    if (meshEl) {
      const vertContainer = getChild(meshEl, "vertices") ?? meshEl;
      for (const vEl of vertContainer.children) {
        if (!matchTag(vEl, "vertex")) continue;
        const vAttrs = getAttrsMap(vEl);
        vertices.push({
          x: Number(vAttrs["x"] ?? 0),
          y: Number(vAttrs["y"] ?? 0),
          z: Number(vAttrs["z"] ?? 0),
        });
      }
      const triContainer = getChild(meshEl, "triangles") ?? meshEl;
      for (const tEl of triContainer.children) {
        if (!matchTag(tEl, "triangle")) continue;
        const tAttrs = getAttrsMap(tEl);
        const tri: ThreeMfTriangle = {
          v1: Number(tAttrs["v1"] ?? 0),
          v2: Number(tAttrs["v2"] ?? 0),
          v3: Number(tAttrs["v3"] ?? 0),
          range: makeRange(tEl.start, tEl.end, lineOffsets),
        };
        if (tAttrs["p1"] !== undefined) tri.p1 = Number(tAttrs["p1"]);
        if (tAttrs["pid"] !== undefined) tri.pid = tAttrs["pid"];
        triangles.push(tri);
      }
    }

    // Parse <medical:SurgicalGuide> or <SurgicalGuide>
    let surgicalGuide: ThreeMfSurgicalGuideSpec | undefined;
    const guideEl = objEl.children.find((c) => matchTag(c, "SurgicalGuide"));
    if (guideEl) {
      isMedicalDevice = true;
      const gAttrs = getAttrsMap(guideEl);
      const guideWall =
        gAttrs["wallThickness"] !== undefined
          ? Number(gAttrs["wallThickness"])
          : gAttrs["wallThicknessMm"] !== undefined
            ? Number(gAttrs["wallThicknessMm"])
            : wallThicknessMm;
      if (guideWall !== undefined) wallThicknessMm = guideWall;

      const guideMat = gAttrs["material"] ?? gAttrs["biocompatibleMaterial"] ?? materialName;
      if (guideMat !== undefined) materialName = guideMat;

      const osteotomyPlanes: ThreeMfOsteotomyPlane[] = [];
      const planeEls = guideEl.children.filter((c) => matchTag(c, "OsteotomyPlane"));
      for (const pEl of planeEls) {
        const pAttrs = getAttrsMap(pEl);
        osteotomyPlanes.push({
          id: pAttrs["id"] ?? `Plane_${osteotomyPlanes.length + 1}`,
          origin: parseVec3(pAttrs["origin"], [0, 0, 0]),
          normal: parseVec3(pAttrs["normal"], [0, 0, 1]),
          slotWidthMm: pAttrs["slotWidth"] !== undefined ? Number(pAttrs["slotWidth"]) : undefined,
          range: makeRange(pEl.start, pEl.end, lineOffsets),
        });
      }

      const drillSleeves: ThreeMfDrillSleeve[] = [];
      const sleeveEls = guideEl.children.filter((c) => matchTag(c, "DrillSleeve"));
      for (const sEl of sleeveEls) {
        const sAttrs = getAttrsMap(sEl);
        const innerD = Number(sAttrs["innerDiameter"] ?? 2.0);
        const outerD = Number(sAttrs["outerDiameter"] ?? 4.0);
        const explicitWall =
          sAttrs["wallThickness"] !== undefined ? Number(sAttrs["wallThickness"]) : (outerD - innerD) / 2.0;
        drillSleeves.push({
          id: sAttrs["id"] ?? `Sleeve_${drillSleeves.length + 1}`,
          entryPoint: parseVec3(sAttrs["entry"] ?? sAttrs["entryPoint"], [0, 0, 0]),
          axis: parseVec3(sAttrs["axis"], [0, 0, 1]),
          innerDiameterMm: innerD,
          outerDiameterMm: outerD,
          wallThicknessMm: explicitWall,
          lengthMm: sAttrs["length"] !== undefined ? Number(sAttrs["length"]) : undefined,
          range: makeRange(sEl.start, sEl.end, lineOffsets),
        });
      }

      surgicalGuide = {
        patientId: gAttrs["patientId"],
        anatomicalSite: gAttrs["anatomicalSite"],
        wallThicknessMm: guideWall,
        biocompatibleMaterial: guideMat,
        sterilizationMethod: gAttrs["sterilization"] ?? gAttrs["sterilizationMethod"],
        osteotomyPlanes,
        drillSleeves,
        range: makeRange(guideEl.start, guideEl.end, lineOffsets),
      };
    }

    const obj: ThreeMfObject = {
      id,
      type: rawType,
      isMedicalDevice,
      range: objRange,
    };
    if (name !== undefined) obj.name = name;
    if (pid !== undefined) obj.pid = pid;
    if (pindex !== undefined) obj.pindex = pindex;
    if (materialName !== undefined) obj.materialName = materialName;
    if (wallThicknessMm !== undefined) obj.wallThicknessMm = wallThicknessMm;
    if (meshEl) obj.mesh = { vertices, triangles };
    if (surgicalGuide !== undefined) obj.surgicalGuide = surgicalGuide;

    objects.push(obj);
  }

  // 4. Parse <build><item .../></build>
  const buildItems: ThreeMfBuildItem[] = [];
  const buildEl = modelEl ? getChild(modelEl, "build") : undefined;
  if (buildEl) {
    for (const itemEl of buildEl.children) {
      if (!matchTag(itemEl, "item")) continue;
      const iAttrs = getAttrsMap(itemEl);
      const item: ThreeMfBuildItem = {
        objectId: iAttrs["objectid"] ?? iAttrs["objectId"] ?? "",
        range: makeRange(itemEl.start, itemEl.end, lineOffsets),
      };
      if (iAttrs["partnumber"]) item.partNumber = iAttrs["partnumber"];
      if (iAttrs["transform"] !== undefined) {
        item.rawTransform = iAttrs["transform"];
        const nums = iAttrs["transform"].trim().split(/\s+/).map(Number);
        if (nums.length === 12 && nums.every((n) => !Number.isNaN(n))) {
          item.transform = nums as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ];
        }
      }
      buildItems.push(item);
    }
  }

  const doc: ThreeMfDocument = {
    unit,
    metadata,
    baseMaterialGroups,
    objects,
    buildItems,
    range: docRange,
  };
  if (sourceUri !== undefined) {
    doc.sourceUri = sourceUri;
  }
  return doc;
}
