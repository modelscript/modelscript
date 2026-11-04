// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — OpenSim 3.x / 4.x (.osim) XML Parser.
 *
 * Parses `<OpenSimDocument>`, `<Model>`, `<BodySet>`, `<JointSet>`, `<ForceSet>`,
 * `<MarkerSet>`, `<WrapObjectSet>`, `<ConstraintSet>`, `<PhysicalOffsetFrame>`,
 * and Hill-type muscles with exact 1-indexed line/column/offset source ranges.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  OpenSimBody,
  OpenSimConstraint,
  OpenSimConstraintType,
  OpenSimCoordinate,
  OpenSimCoordinateMotionType,
  OpenSimDocument,
  OpenSimJoint,
  OpenSimJointType,
  OpenSimMarker,
  OpenSimMuscle,
  OpenSimMuscleType,
  OpenSimPathPoint,
  OpenSimSourceRange,
  OpenSimWrapObject,
  OpenSimWrapType,
} from "../types.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const found = elem.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found?.value;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function getChildText(elem: XmlElement, name: string): string | undefined {
  const child = findChild(elem, name);
  if (child?.text !== undefined) {
    return child.text.trim();
  }
  return getAttr(elem, name);
}

function getChildNumber(elem: XmlElement, name: string, fallback: number): number {
  const raw = getChildText(elem, name);
  if (raw === undefined || raw.length === 0) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function getChildBoolean(elem: XmlElement, name: string, fallback: boolean): boolean {
  const raw = getChildText(elem, name)?.toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

function parseVec3(raw: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!raw) return fallback;
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  if (parts.length >= 3) {
    return [parts[0] ?? fallback[0], parts[1] ?? fallback[1], parts[2] ?? fallback[2]];
  }
  return fallback;
}

function parseInertia6(elem: XmlElement): [number, number, number, number, number, number] {
  const rawVec = getChildText(elem, "inertia");
  if (rawVec) {
    const parts = rawVec
      .trim()
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    if (parts.length >= 6) {
      return [parts[0] ?? 1, parts[1] ?? 1, parts[2] ?? 1, parts[3] ?? 0, parts[4] ?? 0, parts[5] ?? 0];
    }
    if (parts.length >= 3) {
      return [parts[0] ?? 1, parts[1] ?? 1, parts[2] ?? 1, 0, 0, 0];
    }
  }

  const has3xInertia =
    findChild(elem, "inertia_xx") !== undefined ||
    findChild(elem, "inertia_yy") !== undefined ||
    findChild(elem, "inertia_zz") !== undefined;

  if (has3xInertia) {
    return [
      getChildNumber(elem, "inertia_xx", 1),
      getChildNumber(elem, "inertia_yy", 1),
      getChildNumber(elem, "inertia_zz", 1),
      getChildNumber(elem, "inertia_xy", 0),
      getChildNumber(elem, "inertia_xz", 0),
      getChildNumber(elem, "inertia_yz", 0),
    ];
  }

  return [1, 1, 1, 0, 0, 0];
}

function normalizeFrameRef(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed === "/ground" || trimmed === "ground") return trimmed;
  return trimmed.replace(/^\/?bodyset\//i, "").replace(/^\/?markerset\//i, "");
}

function unwrapSetObjects(setElem: XmlElement | undefined): XmlElement[] {
  if (!setElem) return [];
  const objectsElem = findChild(setElem, "objects");
  if (objectsElem) {
    return objectsElem.children;
  }
  return setElem.children;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(lineOffsets: number[], offset: number): { line: number; column: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const lineStart = lineOffsets[mid] ?? 0;
    if (lineStart <= clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = Math.max(0, high);
  const lineStartOffset = lineOffsets[lineIdx] ?? 0;
  return {
    line: lineIdx + 1,
    column: clamped - lineStartOffset + 1,
  };
}

function computeRange(lineOffsets: number[], elem: XmlElement): OpenSimSourceRange {
  const start = offsetToLineCol(lineOffsets, elem.start);
  const end = offsetToLineCol(lineOffsets, elem.end);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: Math.max(start.line, end.line),
    endColumn: end.column,
    startOffset: elem.start,
    endOffset: elem.end,
  };
}

const JOINT_TYPES = new Set<OpenSimJointType>([
  "PinJoint",
  "SliderJoint",
  "BallJoint",
  "WeldJoint",
  "CustomJoint",
  "FreeJoint",
]);

const MUSCLE_TYPES = new Set<OpenSimMuscleType>([
  "Thelen2003Muscle",
  "Millard2012EquilibriumMuscle",
  "Schutte1993Muscle",
]);

const WRAP_TYPES = new Set<OpenSimWrapType>(["WrapCylinder", "WrapSphere", "WrapEllipsoid"]);

const CONSTRAINT_TYPES = new Set<OpenSimConstraintType>([
  "PointConstraint",
  "WeldConstraint",
  "CoordinateCouplerConstraint",
]);

function parseCoordinateElement(
  cElem: XmlElement,
  lineOffsets: number[],
  defaultMotionType: OpenSimCoordinateMotionType,
  index: number,
): OpenSimCoordinate {
  const name = getAttr(cElem, "name") ?? getChildText(cElem, "name") ?? `coord_${index}`;
  const id = getAttr(cElem, "id") ?? name;
  const rawMotion = (getChildText(cElem, "motion_type") ?? getChildText(cElem, "motionType") ?? "").toLowerCase();
  let motionType: OpenSimCoordinateMotionType = defaultMotionType;
  if (rawMotion === "rotational" || rawMotion === "translational" || rawMotion === "coupled") {
    motionType = rawMotion;
  }

  const defaultValue = getChildNumber(cElem, "default_value", getChildNumber(cElem, "defaultValue", 0));

  let rangeMin = -Math.PI;
  let rangeMax = Math.PI;
  const rangeStr = getChildText(cElem, "range");
  if (rangeStr) {
    const nums = rangeStr
      .trim()
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    if (nums.length >= 2) {
      rangeMin = nums[0] ?? rangeMin;
      rangeMax = nums[1] ?? rangeMax;
    }
  } else {
    rangeMin = getChildNumber(cElem, "range_min", getChildNumber(cElem, "rangeMin", rangeMin));
    rangeMax = getChildNumber(cElem, "range_max", getChildNumber(cElem, "rangeMax", rangeMax));
  }

  const clamped = getChildBoolean(cElem, "clamped", false);
  const locked = getChildBoolean(cElem, "locked", false);

  return {
    id,
    name,
    motionType,
    defaultValue,
    rangeMin,
    rangeMax,
    clamped,
    locked,
    range: computeRange(lineOffsets, cElem),
  };
}

function parseJointElement(
  jElem: XmlElement,
  lineOffsets: number[],
  index: number,
  defaultChildBody?: string,
): OpenSimJoint | null {
  let jointType: OpenSimJointType = "PinJoint";
  if (JOINT_TYPES.has(jElem.name as OpenSimJointType)) {
    jointType = jElem.name as OpenSimJointType;
  } else if (jElem.name.toLowerCase() === "joint") {
    const tAttr = getAttr(jElem, "type") as OpenSimJointType | undefined;
    if (tAttr && JOINT_TYPES.has(tAttr)) {
      jointType = tAttr;
    }
  } else {
    return null;
  }

  const name = getAttr(jElem, "name") ?? getChildText(jElem, "name") ?? `joint_${index}`;
  const id = getAttr(jElem, "id") ?? name;

  // Inspect <frames><PhysicalOffsetFrame ...> if present
  const offsetFrames = new Map<
    string,
    {
      parent: string;
      translation: [number, number, number];
      orientation: [number, number, number];
    }
  >();

  const framesContainer = findChild(jElem, "frames");
  const frameElements = [
    ...(framesContainer ? findChildren(framesContainer, "PhysicalOffsetFrame") : []),
    ...findChildren(jElem, "PhysicalOffsetFrame"),
  ];
  for (const fElem of frameElements) {
    const fName = getAttr(fElem, "name");
    if (fName) {
      const fParent = normalizeFrameRef(
        getChildText(fElem, "socket_parent") ??
          getChildText(fElem, "parent_frame") ??
          getChildText(fElem, "parent_body"),
      );
      const translation = parseVec3(getChildText(fElem, "translation") ?? getChildText(fElem, "location"), [0, 0, 0]);
      const orientation = parseVec3(getChildText(fElem, "orientation"), [0, 0, 0]);
      offsetFrames.set(fName, { parent: fParent, translation, orientation });
    }
  }

  const rawParentSocket =
    getChildText(jElem, "socket_parent_frame") ??
    getChildText(jElem, "parent_frame") ??
    getChildText(jElem, "parent_body") ??
    "ground";

  const rawChildSocket =
    getChildText(jElem, "socket_child_frame") ??
    getChildText(jElem, "child_frame") ??
    getChildText(jElem, "child_body") ??
    defaultChildBody ??
    "";

  let parentFrame = normalizeFrameRef(rawParentSocket);
  let childFrame = normalizeFrameRef(rawChildSocket);

  let locationInParent = parseVec3(
    getChildText(jElem, "location_in_parent") ?? getChildText(jElem, "location"),
    [0, 0, 0],
  );
  let orientationInParent = parseVec3(
    getChildText(jElem, "orientation_in_parent") ?? getChildText(jElem, "orientation"),
    [0, 0, 0],
  );

  const hasExplicitLocation =
    findChild(jElem, "location_in_parent") !== undefined || findChild(jElem, "location") !== undefined;
  const hasExplicitOrientation =
    findChild(jElem, "orientation_in_parent") !== undefined || findChild(jElem, "orientation") !== undefined;

  const parentOffset = offsetFrames.get(rawParentSocket) ?? offsetFrames.get(parentFrame);
  if (parentOffset) {
    if (parentOffset.parent) {
      parentFrame = parentOffset.parent;
    }
    if (!hasExplicitLocation) {
      locationInParent = parentOffset.translation;
    }
    if (!hasExplicitOrientation) {
      orientationInParent = parentOffset.orientation;
    }
  }

  const childOffset = offsetFrames.get(rawChildSocket) ?? offsetFrames.get(childFrame);
  if (childOffset && childOffset.parent) {
    childFrame = childOffset.parent;
  }

  const defaultMotionType: OpenSimCoordinateMotionType = jointType === "SliderJoint" ? "translational" : "rotational";

  const coordElements: XmlElement[] = [];
  const coordSet = findChild(jElem, "CoordinateSet");
  if (coordSet) {
    for (const c of unwrapSetObjects(coordSet)) {
      if (c.name.toLowerCase() === "coordinate") coordElements.push(c);
    }
  }
  const coordsList = findChild(jElem, "coordinates");
  if (coordsList) {
    for (const c of findChildren(coordsList, "Coordinate")) {
      coordElements.push(c);
    }
  }
  for (const c of findChildren(jElem, "Coordinate")) {
    coordElements.push(c);
  }

  const coordinates = coordElements.map((cElem, idx) =>
    parseCoordinateElement(cElem, lineOffsets, defaultMotionType, idx),
  );

  return {
    id,
    name,
    jointType,
    parentFrame,
    childFrame,
    locationInParent,
    orientationInParent,
    coordinates,
    range: computeRange(lineOffsets, jElem),
  };
}

function parseWrapObjectElement(
  wElem: XmlElement,
  lineOffsets: number[],
  index: number,
  defaultBodyFrame?: string,
): OpenSimWrapObject | null {
  let wrapType: OpenSimWrapType = "WrapCylinder";
  if (WRAP_TYPES.has(wElem.name as OpenSimWrapType)) {
    wrapType = wElem.name as OpenSimWrapType;
  } else if (wElem.name.toLowerCase() === "wrapobject") {
    const tAttr = getAttr(wElem, "type") as OpenSimWrapType | undefined;
    if (tAttr && WRAP_TYPES.has(tAttr)) {
      wrapType = tAttr;
    }
  } else {
    return null;
  }

  const name = getAttr(wElem, "name") ?? getChildText(wElem, "name") ?? `wrap_${index}`;
  const id = getAttr(wElem, "id") ?? name;
  const bodyFrame = normalizeFrameRef(
    getChildText(wElem, "socket_parent_frame") ??
      getChildText(wElem, "body_frame") ??
      getChildText(wElem, "body") ??
      defaultBodyFrame ??
      "ground",
  );

  let radius = getChildNumber(wElem, "radius", 0.05);
  const dimensionsText = getChildText(wElem, "dimensions");
  if (dimensionsText && findChild(wElem, "radius") === undefined) {
    const dims = parseVec3(dimensionsText, [0.05, 0.05, 0.05]);
    radius = dims[0];
  }
  const length = getChildNumber(wElem, "length", 0.1);

  return {
    id,
    name,
    wrapType,
    bodyFrame,
    radius,
    length,
    range: computeRange(lineOffsets, wElem),
  };
}

function parseMuscleElement(mElem: XmlElement, lineOffsets: number[], index: number): OpenSimMuscle | null {
  let muscleType: OpenSimMuscleType = "Thelen2003Muscle";
  if (MUSCLE_TYPES.has(mElem.name as OpenSimMuscleType)) {
    muscleType = mElem.name as OpenSimMuscleType;
  } else if (mElem.name.toLowerCase() === "muscle") {
    const tAttr = getAttr(mElem, "type") as OpenSimMuscleType | undefined;
    if (tAttr && MUSCLE_TYPES.has(tAttr)) {
      muscleType = tAttr;
    }
  } else {
    return null;
  }

  const name = getAttr(mElem, "name") ?? getChildText(mElem, "name") ?? `muscle_${index}`;
  const id = getAttr(mElem, "id") ?? name;

  const maxIsometricForce = getChildNumber(mElem, "max_isometric_force", 1000);
  const optimalFiberLength = getChildNumber(mElem, "optimal_fiber_length", 0.1);
  const tendonSlackLength = getChildNumber(mElem, "tendon_slack_length", 0.2);
  const pennationAngleAtOptimal = getChildNumber(
    mElem,
    "pennation_angle_at_optimal",
    getChildNumber(mElem, "pennation_angle", 0),
  );
  const activationTimeConstant = getChildNumber(mElem, "activation_time_constant", 0.01);
  const deactivationTimeConstant = getChildNumber(mElem, "deactivation_time_constant", 0.04);
  const maxContractionVelocity = getChildNumber(mElem, "max_contraction_velocity", 10);

  const pathPoints: OpenSimPathPoint[] = [];
  const wrapObjects: string[] = [];

  const geomPath = findChild(mElem, "GeometryPath") ?? mElem;
  const pathPointSet = findChild(geomPath, "PathPointSet") ?? findChild(mElem, "PathPointSet");
  const rawPointElems = pathPointSet
    ? unwrapSetObjects(pathPointSet)
    : [
        ...findChildren(geomPath, "PathPoint"),
        ...findChildren(geomPath, "ConditionalPathPoint"),
        ...findChildren(geomPath, "MovingPathPoint"),
      ];

  for (let i = 0; i < rawPointElems.length; i++) {
    const pElem = rawPointElems[i];
    if (!pElem) continue;
    const tagLower = pElem.name.toLowerCase();
    if (tagLower !== "pathpoint" && tagLower !== "conditionalpathpoint" && tagLower !== "movingpathpoint") {
      continue;
    }
    const pName = getAttr(pElem, "name") ?? getChildText(pElem, "name") ?? `${name}_p${i + 1}`;
    const bodyFrame = normalizeFrameRef(
      getChildText(pElem, "socket_parent_frame") ??
        getChildText(pElem, "socket_frame") ??
        getChildText(pElem, "body_frame") ??
        getChildText(pElem, "body") ??
        "",
    );
    const location = parseVec3(getChildText(pElem, "location"), [0, 0, 0]);
    pathPoints.push({
      name: pName,
      bodyFrame,
      location,
      range: computeRange(lineOffsets, pElem),
    });
  }

  // Extract wrap object references from PathWrapSet or <wrap_objects> / <wrap_object>
  const pathWrapSet = findChild(geomPath, "PathWrapSet") ?? findChild(mElem, "PathWrapSet");
  if (pathWrapSet) {
    for (const pwElem of unwrapSetObjects(pathWrapSet)) {
      const wrapRef =
        getChildText(pwElem, "wrap_object") ??
        getChildText(pwElem, "socket_wrap_object") ??
        getAttr(pwElem, "wrap_object") ??
        getAttr(pwElem, "name");
      if (wrapRef) {
        wrapObjects.push(wrapRef.trim());
      }
    }
  }

  for (const wChild of [
    ...findChildren(geomPath, "wrap_object"),
    ...findChildren(mElem, "wrap_object"),
    ...findChildren(geomPath, "PathWrap"),
    ...findChildren(mElem, "PathWrap"),
  ]) {
    const ref = getChildText(wChild, "wrap_object") ?? getAttr(wChild, "wrap_object") ?? wChild.text?.trim();
    if (ref && !wrapObjects.includes(ref)) {
      wrapObjects.push(ref);
    }
  }

  const wrapListText = getChildText(geomPath, "wrap_objects") ?? getChildText(mElem, "wrap_objects");
  if (wrapListText) {
    for (const token of wrapListText.split(/[\s,]+/)) {
      const trimmed = token.trim();
      if (trimmed && !wrapObjects.includes(trimmed)) {
        wrapObjects.push(trimmed);
      }
    }
  }

  return {
    id,
    name,
    muscleType,
    maxIsometricForce,
    optimalFiberLength,
    tendonSlackLength,
    pennationAngleAtOptimal,
    activationTimeConstant,
    deactivationTimeConstant,
    maxContractionVelocity,
    pathPoints,
    wrapObjects,
    range: computeRange(lineOffsets, mElem),
  };
}

export function parseOpenSim(text: string, uri?: string): OpenSimDocument {
  const xmlDoc = parseXml(text);
  const root = xmlDoc.root;
  if (!root) {
    throw new Error("Invalid OpenSim XML: empty document");
  }

  const rootTag = root.name.toLowerCase();
  if (rootTag !== "opensimdocument" && rootTag !== "model") {
    throw new Error(`Invalid OpenSim XML: expected <OpenSimDocument> or <Model>, found <${root.name}>`);
  }

  const lineOffsets = buildLineOffsets(text);
  const version = getAttr(root, "Version") ?? "40000";
  const modelElem = rootTag === "model" ? root : (findChild(root, "Model") ?? root);

  const modelName = getAttr(modelElem, "name") ?? getChildText(modelElem, "name") ?? "OpenSimModel";

  const gravity = parseVec3(getChildText(modelElem, "gravity"), [0, -9.80665, 0]);

  const bodies: OpenSimBody[] = [];
  const joints: OpenSimJoint[] = [];
  const muscles: OpenSimMuscle[] = [];
  const markers: OpenSimMarker[] = [];
  const wrapObjects: OpenSimWrapObject[] = [];
  const constraints: OpenSimConstraint[] = [];

  // 1. Parse BodySet (and any embedded 3.x Joint or WrapObjectSet inside Body)
  const bodySet = findChild(modelElem, "BodySet");
  const bodyElems = bodySet ? unwrapSetObjects(bodySet) : findChildren(modelElem, "Body");
  for (let i = 0; i < bodyElems.length; i++) {
    const bElem = bodyElems[i];
    if (!bElem || bElem.name.toLowerCase() !== "body") continue;
    const name = getAttr(bElem, "name") ?? getChildText(bElem, "name") ?? `body_${i}`;
    const id = getAttr(bElem, "id") ?? name;
    const mass = getChildNumber(bElem, "mass", 1.0);
    const massCenter = parseVec3(getChildText(bElem, "mass_center") ?? getChildText(bElem, "massCenter"), [0, 0, 0]);
    const inertia = parseInertia6(bElem);

    bodies.push({
      id,
      name,
      mass,
      massCenter,
      inertia,
      range: computeRange(lineOffsets, bElem),
    });

    // OpenSim 3.x embedded Joint inside Body
    const embeddedJointContainer = findChild(bElem, "Joint");
    if (embeddedJointContainer) {
      for (const jChild of embeddedJointContainer.children) {
        const parsedJoint = parseJointElement(jChild, lineOffsets, joints.length, name);
        if (parsedJoint) joints.push(parsedJoint);
      }
    }

    // Embedded WrapObjectSet inside Body
    const bodyWrapSet = findChild(bElem, "WrapObjectSet");
    if (bodyWrapSet) {
      for (const wChild of unwrapSetObjects(bodyWrapSet)) {
        const parsedWrap = parseWrapObjectElement(wChild, lineOffsets, wrapObjects.length, name);
        if (parsedWrap) wrapObjects.push(parsedWrap);
      }
    }
  }

  // 2. Parse JointSet
  const jointSet = findChild(modelElem, "JointSet");
  const jointElems = jointSet ? unwrapSetObjects(jointSet) : [];
  for (const jElem of jointElems) {
    const parsed = parseJointElement(jElem, lineOffsets, joints.length);
    if (parsed) joints.push(parsed);
  }

  // 3. Parse ForceSet (Muscles)
  const forceSet = findChild(modelElem, "ForceSet") ?? findChild(modelElem, "Muscles");
  const forceElems = forceSet ? unwrapSetObjects(forceSet) : [];
  for (const fElem of forceElems) {
    const parsed = parseMuscleElement(fElem, lineOffsets, muscles.length);
    if (parsed) muscles.push(parsed);
  }

  // 4. Parse MarkerSet
  const markerSet = findChild(modelElem, "MarkerSet");
  const markerElems = markerSet ? unwrapSetObjects(markerSet) : findChildren(modelElem, "Marker");
  for (let i = 0; i < markerElems.length; i++) {
    const mkElem = markerElems[i];
    if (!mkElem || mkElem.name.toLowerCase() !== "marker") continue;
    const name = getAttr(mkElem, "name") ?? getChildText(mkElem, "name") ?? `marker_${i}`;
    const id = getAttr(mkElem, "id") ?? name;
    const bodyFrame = normalizeFrameRef(
      getChildText(mkElem, "socket_parent_frame") ??
        getChildText(mkElem, "body_frame") ??
        getChildText(mkElem, "body") ??
        "ground",
    );
    const location = parseVec3(getChildText(mkElem, "location"), [0, 0, 0]);
    markers.push({
      id,
      name,
      bodyFrame,
      location,
      range: computeRange(lineOffsets, mkElem),
    });
  }

  // 5. Parse Model-level WrapObjectSet
  const modelWrapSet = findChild(modelElem, "WrapObjectSet");
  if (modelWrapSet) {
    for (const wElem of unwrapSetObjects(modelWrapSet)) {
      const parsed = parseWrapObjectElement(wElem, lineOffsets, wrapObjects.length);
      if (parsed) wrapObjects.push(parsed);
    }
  }

  // 6. Parse ConstraintSet
  const constraintSet = findChild(modelElem, "ConstraintSet");
  const constraintElems = constraintSet ? unwrapSetObjects(constraintSet) : [];
  for (let i = 0; i < constraintElems.length; i++) {
    const cElem = constraintElems[i];
    if (!cElem) continue;
    let constraintType: OpenSimConstraintType = "WeldConstraint";
    if (CONSTRAINT_TYPES.has(cElem.name as OpenSimConstraintType)) {
      constraintType = cElem.name as OpenSimConstraintType;
    } else if (cElem.name.toLowerCase() === "constraint") {
      const tAttr = getAttr(cElem, "type") as OpenSimConstraintType | undefined;
      if (tAttr && CONSTRAINT_TYPES.has(tAttr)) {
        constraintType = tAttr;
      }
    } else {
      continue;
    }

    const name = getAttr(cElem, "name") ?? getChildText(cElem, "name") ?? `constraint_${i}`;
    const id = getAttr(cElem, "id") ?? name;
    const body1 = normalizeFrameRef(
      getChildText(cElem, "socket_body_1") ??
        getChildText(cElem, "body_1") ??
        getChildText(cElem, "body1") ??
        getChildText(cElem, "socket_frame1") ??
        getChildText(cElem, "independent_coordinate_names") ??
        "",
    );
    const body2 = normalizeFrameRef(
      getChildText(cElem, "socket_body_2") ??
        getChildText(cElem, "body_2") ??
        getChildText(cElem, "body2") ??
        getChildText(cElem, "socket_frame2") ??
        getChildText(cElem, "dependent_coordinate_name") ??
        "",
    );

    constraints.push({
      id,
      name,
      constraintType,
      body1,
      body2,
      range: computeRange(lineOffsets, cElem),
    });
  }

  return {
    modelName,
    version,
    gravity,
    bodies,
    joints,
    muscles,
    markers,
    wrapObjects,
    constraints,
    uri,
  };
}
