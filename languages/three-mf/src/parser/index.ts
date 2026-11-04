// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — ISO/ASTM 52915 3MF & Medical Extension Parser.
 *
 * Parses 3MF XML `<model>` documents (`<basematerials>`, `<object>`, `<mesh>`,
 * `<vertices>`, `<triangles>`, `<medical:SurgicalGuide>`, `<build><item>`)
 * as well as JSON serialized representations.
 */

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

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrString)) !== null) {
    const key = m[1]!;
    const val = m[2] ?? m[3] ?? "";
    attrs[key] = val;
  }
  return attrs;
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

  let unit: ThreeMfUnit = "millimeter";
  const modelMatch = /<model\b([^>]*)>/i.exec(text);
  if (modelMatch) {
    const modelAttrs = parseAttributes(modelMatch[1]!);
    if (modelAttrs["unit"]) {
      unit = modelAttrs["unit"] as ThreeMfUnit;
    }
  }

  // 1. Parse <metadata name="...">value</metadata>
  const metadata: Record<string, string> = {};
  const metaRegex = /<metadata\b([^>]*)>([\s\S]*?)<\/metadata>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRegex.exec(text)) !== null) {
    const attrs = parseAttributes(metaMatch[1]!);
    const name = attrs["name"];
    if (name) {
      metadata[name] = metaMatch[2]!.trim();
    }
  }

  // 2. Parse <basematerials id="...">
  const baseMaterialGroups: ThreeMfBaseMaterialsGroup[] = [];
  const bmGroupRegex = /<basematerials\b([^>]*)>([\s\S]*?)<\/basematerials>/gi;
  let bmGroupMatch: RegExpExecArray | null;
  while ((bmGroupMatch = bmGroupRegex.exec(text)) !== null) {
    const groupAttrs = parseAttributes(bmGroupMatch[1]!);
    const groupId = groupAttrs["id"] ?? "1";
    const groupBody = bmGroupMatch[2]!;
    const groupStart = bmGroupMatch.index;
    const materials: ThreeMfBaseMaterial[] = [];

    const baseRegex = /<base\b([^>]*)\/?>/gi;
    let baseMatch: RegExpExecArray | null;
    let idx = 0;
    while ((baseMatch = baseRegex.exec(groupBody)) !== null) {
      const bAttrs = parseAttributes(baseMatch[1]!);
      const bRange = makeRange(
        groupStart + baseMatch.index,
        groupStart + baseMatch.index + baseMatch[0].length,
        lineOffsets,
      );
      materials.push({
        index: idx++,
        name: bAttrs["name"] ?? `Material_${idx}`,
        displayColor: bAttrs["displaycolor"],
        range: bRange,
      });
    }

    baseMaterialGroups.push({
      id: groupId,
      materials,
      range: makeRange(groupStart, groupStart + bmGroupMatch[0].length, lineOffsets),
    });
  }

  // Build quick lookup for base materials by (pid, pindex)
  const resolveMaterialName = (pid?: string, pindex?: number): string | undefined => {
    if (!pid) return undefined;
    const grp = baseMaterialGroups.find((g) => g.id === pid);
    if (!grp) return undefined;
    const mat = grp.materials[pindex ?? 0];
    return mat?.name;
  };

  // 3. Parse <object ...>...</object>
  const objects: ThreeMfObject[] = [];
  const objRegex = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objRegex.exec(text)) !== null) {
    const objAttrs = parseAttributes(objMatch[1]!);
    const objBody = objMatch[2]!;
    const objStart = objMatch.index;
    const bodyStart = objStart + objMatch[0].indexOf(objBody);
    const objRange = makeRange(objStart, objStart + objMatch[0].length, lineOffsets);

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
    const meshMatch = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/i.exec(objBody);
    if (meshMatch) {
      const meshBody = meshMatch[1]!;
      const meshOffset = bodyStart + meshMatch.index;

      const vertRegex = /<vertex\b([^>]*)\/?>/gi;
      let vMatch: RegExpExecArray | null;
      while ((vMatch = vertRegex.exec(meshBody)) !== null) {
        const vAttrs = parseAttributes(vMatch[1]!);
        vertices.push({
          x: Number(vAttrs["x"] ?? 0),
          y: Number(vAttrs["y"] ?? 0),
          z: Number(vAttrs["z"] ?? 0),
        });
      }

      const triRegex = /<triangle\b([^>]*)\/?>/gi;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = triRegex.exec(meshBody)) !== null) {
        const tAttrs = parseAttributes(tMatch[1]!);
        const tStart = meshOffset + tMatch.index;
        const tri: ThreeMfTriangle = {
          v1: Number(tAttrs["v1"] ?? 0),
          v2: Number(tAttrs["v2"] ?? 0),
          v3: Number(tAttrs["v3"] ?? 0),
          range: makeRange(tStart, tStart + tMatch[0].length, lineOffsets),
        };
        if (tAttrs["p1"] !== undefined) tri.p1 = Number(tAttrs["p1"]);
        if (tAttrs["pid"] !== undefined) tri.pid = tAttrs["pid"];
        triangles.push(tri);
      }
    }

    // Parse <medical:SurgicalGuide> or <SurgicalGuide>
    let surgicalGuide: ThreeMfSurgicalGuideSpec | undefined;
    const guideMatch = /<(?:medical:)?SurgicalGuide\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:medical:)?SurgicalGuide>)/i.exec(
      objBody,
    );
    if (guideMatch) {
      isMedicalDevice = true;
      const gAttrs = parseAttributes(guideMatch[1]!);
      const gBody = guideMatch[2] ?? "";
      const gStart = bodyStart + guideMatch.index;

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
      const planeRegex = /<(?:medical:)?OsteotomyPlane\b([^>]*)\/?>/gi;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = planeRegex.exec(gBody)) !== null) {
        const pAttrs = parseAttributes(pMatch[1]!);
        const pStart = gStart + pMatch.index;
        osteotomyPlanes.push({
          id: pAttrs["id"] ?? `Plane_${osteotomyPlanes.length + 1}`,
          origin: parseVec3(pAttrs["origin"], [0, 0, 0]),
          normal: parseVec3(pAttrs["normal"], [0, 0, 1]),
          slotWidthMm: pAttrs["slotWidth"] !== undefined ? Number(pAttrs["slotWidth"]) : undefined,
          range: makeRange(pStart, pStart + pMatch[0].length, lineOffsets),
        });
      }

      const drillSleeves: ThreeMfDrillSleeve[] = [];
      const sleeveRegex = /<(?:medical:)?DrillSleeve\b([^>]*)\/?>/gi;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = sleeveRegex.exec(gBody)) !== null) {
        const sAttrs = parseAttributes(sMatch[1]!);
        const sStart = gStart + sMatch.index;
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
          range: makeRange(sStart, sStart + sMatch[0].length, lineOffsets),
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
        range: makeRange(gStart, gStart + guideMatch[0].length, lineOffsets),
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
    if (meshMatch) obj.mesh = { vertices, triangles };
    if (surgicalGuide !== undefined) obj.surgicalGuide = surgicalGuide;

    objects.push(obj);
  }

  // 4. Parse <build><item .../></build>
  const buildItems: ThreeMfBuildItem[] = [];
  const buildMatch = /<build\b[^>]*>([\s\S]*?)<\/build>/i.exec(text);
  if (buildMatch) {
    const buildBody = buildMatch[1]!;
    const buildStart = buildMatch.index + buildMatch[0].indexOf(buildBody);
    const itemRegex = /<item\b([^>]*)\/?>/gi;
    let iMatch: RegExpExecArray | null;
    while ((iMatch = itemRegex.exec(buildBody)) !== null) {
      const iAttrs = parseAttributes(iMatch[1]!);
      const iStart = buildStart + iMatch.index;
      const item: ThreeMfBuildItem = {
        objectId: iAttrs["objectid"] ?? iAttrs["objectId"] ?? "",
        range: makeRange(iStart, iStart + iMatch[0].length, lineOffsets),
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
