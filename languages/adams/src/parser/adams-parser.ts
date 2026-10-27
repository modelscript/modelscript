// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Robust Zero-Regex MSC Adams Dataset (.adm) & Command (.cmd) Parser.
 *
 * Implements deterministic card/token-based parsing for Hexagon MSC Adams MBD models.
 * Correctly resolves card line continuations (&), comment delimiters (!, $, //),
 * coordinate markers (QP, REULER), inertia tensors, kinematic joint constraints,
 * spring-dampers, applied forces, prescribed motions, and simulation controls.
 */

import type {
  AdamsDataset,
  AdamsForce,
  AdamsForceType,
  AdamsInertia,
  AdamsJoint,
  AdamsJointType,
  AdamsMarker,
  AdamsMotion,
  AdamsPart,
  AdamsRequest,
  AdamsSimulateDirective,
  SourceRange,
  Vector3D,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Regex Number & Angle Evaluation
// ─────────────────────────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Parses an Adams number literal, supporting standard scientific notation
 * and degree suffix 'D' (e.g. "30D" -> 0.523598775 rad).
 */
export function parseAdamsNumber(raw: string): number {
  const str = raw.trim();
  if (!str) return 0;

  const upper = str.toUpperCase();
  if (upper === "PI") return Math.PI;

  let isDegree = false;
  let numStr = upper;
  if (upper.endsWith("D")) {
    isDegree = true;
    numStr = upper.slice(0, -1).trim();
  }

  const val = Number.parseFloat(numStr);
  if (Number.isNaN(val)) return 0;
  return isDegree ? val * DEG_TO_RAD : val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card Preprocessor (Continuations & Comments)
// ─────────────────────────────────────────────────────────────────────────────

interface LogicalCard {
  text: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Normalizes source text into logical statements by merging lines ending with '&'
 * and stripping comment lines starting with '!', '$', or '//'.
 */
function preprocessCards(source: string): LogicalCard[] {
  const lines = source.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const cards: LogicalCard[] = [];

  let currentText = "";
  let cardStartLine = 1;
  let cardEndLine = 1;
  let cardStartOffset = 0;
  let currentOffset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    const lineNum = lineIdx + 1;
    const lineLen = rawLine.length + 1; // +1 for newline

    // Strip inline or full-line comments
    let lineContent = rawLine;
    let commentIdx = -1;
    let inQuotes = false;
    let quoteChar = "";

    for (let c = 0; c < lineContent.length; c++) {
      const ch = lineContent[c];
      if ((ch === '"' || ch === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else if (ch === quoteChar && inQuotes) {
        inQuotes = false;
      } else if (!inQuotes) {
        if (ch === "!" || ch === "$") {
          commentIdx = c;
          break;
        }
        if (ch === "/" && lineContent[c + 1] === "/") {
          commentIdx = c;
          break;
        }
      }
    }

    if (commentIdx !== -1) {
      lineContent = lineContent.slice(0, commentIdx);
    }

    const trimmed = lineContent.trim();
    if (!trimmed) {
      currentOffset += lineLen;
      continue;
    }

    const isContinuation = trimmed.endsWith("&");
    const contentToAdd = isContinuation ? trimmed.slice(0, -1).trimEnd() : trimmed;

    if (!currentText) {
      cardStartLine = lineNum;
      cardStartOffset = currentOffset;
      currentText = contentToAdd;
    } else {
      currentText += " " + contentToAdd;
    }

    cardEndLine = lineNum;

    if (!isContinuation) {
      cards.push({
        text: currentText,
        startLine: cardStartLine,
        endLine: cardEndLine,
        startOffset: cardStartOffset,
        endOffset: currentOffset + lineLen,
      });
      currentText = "";
    }

    currentOffset += lineLen;
  }

  if (currentText) {
    cards.push({
      text: currentText,
      startLine: cardStartLine,
      endLine: cardEndLine,
      startOffset: cardStartOffset,
      endOffset: currentOffset,
    });
  }

  return cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Regex Card Tokenizer
// ─────────────────────────────────────────────────────────────────────────────

interface KeyValueCard {
  keyword: string;
  id?: string | number | undefined;
  params: Map<string, string[]>;
  rawText: string;
  range: SourceRange;
}

/**
 * Tokenizes a logical Adams statement card into keyword, ID, and parameters.
 * Handles both:
 *   Standard Card: KEYWORD / ID , PARAM1 = VAL1, VAL2 ...
 *   Command Style: part create rigid_body ...
 */
function tokenizeCard(card: LogicalCard): KeyValueCard | null {
  const text = card.text.trim();
  if (!text) return null;

  const range: SourceRange = {
    startLine: card.startLine,
    startColumn: 1,
    endLine: card.endLine,
    endColumn: card.text.length + 1,
    startOffset: card.startOffset,
    endOffset: card.endOffset,
  };

  const slashIdx = text.indexOf("/");
  if (slashIdx !== -1) {
    // Statement Card: KEYWORD / ID , PARAM=VAL ...
    const keyword = text.slice(0, slashIdx).trim().toUpperCase();
    const rest = text.slice(slashIdx + 1).trim();

    // The first token after slash up to comma or end is the ID (or subtype like DYNAMIC)
    const firstCommaIdx = rest.indexOf(",");
    let idStr = "";
    let paramsStr = "";

    if (firstCommaIdx === -1) {
      idStr = rest.trim();
    } else {
      idStr = rest.slice(0, firstCommaIdx).trim();
      paramsStr = rest.slice(firstCommaIdx + 1).trim();
    }

    const params = parseParams(paramsStr);
    const parsedId = Number.isNaN(Number(idStr)) ? idStr : Number(idStr);

    return {
      keyword,
      id: parsedId,
      params,
      rawText: text,
      range,
    };
  }

  // Check for command style (e.g., "part create rigid_body ...", "marker create ...")
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx !== -1) {
    const keyword = text.slice(0, spaceIdx).trim().toUpperCase();
    const rest = text.slice(spaceIdx + 1).trim();
    const params = parseCommandParams(rest);
    return {
      keyword,
      params,
      rawText: text,
      range,
    };
  }

  return {
    keyword: text.toUpperCase(),
    params: new Map(),
    rawText: text,
    range,
  };
}

/**
 * Parses comma-separated parameters:
 * "MASS = 12.5, CM = 201, IP = 0.15, 0.22, 0.18, GROUND"
 */
function parseParams(paramStr: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!paramStr) return map;

  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if ((ch === '"' || ch === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === quoteChar && inQuotes) {
      inQuotes = false;
      current += ch;
    } else if (ch === "(" && !inQuotes) {
      parenDepth++;
      current += ch;
    } else if (ch === ")" && !inQuotes) {
      parenDepth--;
      current += ch;
    } else if (ch === "," && !inQuotes && parenDepth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  const MULTI_VALUE_KEYS = new Set(["IP", "QP", "REULER", "LOCATION", "ORIENTATION", "Z", "X"]);
  let activeKey = "";
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx).trim().toUpperCase();
      const val = part.slice(eqIdx + 1).trim();
      activeKey = key;
      const list = map.get(key) ?? [];
      if (val) list.push(val);
      map.set(key, list);
    } else {
      const trimmedPart = part.trim();
      const firstCh = trimmedPart[0];
      const isNum =
        firstCh !== undefined &&
        ((firstCh >= "0" && firstCh <= "9") || firstCh === "." || firstCh === "+" || firstCh === "-");
      if (activeKey && MULTI_VALUE_KEYS.has(activeKey) && isNum) {
        map.get(activeKey)?.push(part);
      } else {
        activeKey = "";
        const flagKey = part.toUpperCase();
        map.set(flagKey, ["true"]);
      }
    }
  }

  return map;
}

/**
 * Parses space-separated command parameters (e.g. key = val or key_name = val).
 */
function parseCommandParams(cmdStr: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!cmdStr) return map;

  // Split by whitespace unless inside quotes or after '='
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const ch = cmdStr[i];
    if (ch === '"' || ch === "'") {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === " " || ch === "\t") && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? "";
    const eqIdx = tok.indexOf("=");
    if (eqIdx !== -1) {
      const key = tok.slice(0, eqIdx).trim().toUpperCase();
      let val = tok.slice(eqIdx + 1).trim();
      if (!val && i + 1 < tokens.length && tokens[i + 1] !== "=") {
        val = tokens[++i] ?? "";
      }
      map.set(key, [val]);
    } else if (tok === "=" && i > 0 && i + 1 < tokens.length) {
      const key = (tokens[i - 1] ?? "").toUpperCase();
      const val = tokens[++i] ?? "";
      map.set(key, [val]);
    } else {
      map.set(tok.toUpperCase(), ["true"]);
    }
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adams AST Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses an MSC Adams Dataset (.adm), Command script (.cmd), or Analysis (.acf).
 */
export function parseAdams(source: string, defaultTitle = "adams_model"): AdamsDataset {
  const dataset: AdamsDataset = {
    title: defaultTitle,
    parts: new Map(),
    markers: new Map(),
    joints: new Map(),
    forces: new Map(),
    motions: new Map(),
    requests: new Map(),
  };

  // Check for title in initial header comments
  const rawLines = source.split("\n");
  for (let i = 0; i < Math.min(10, rawLines.length); i++) {
    const raw = rawLines[i] ?? "";
    const l = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trim();
    if (l.startsWith("!") || l.startsWith("$") || l.startsWith("//")) {
      let startIdx = 0;
      while (
        startIdx < l.length &&
        (l[startIdx] === "!" ||
          l[startIdx] === "$" ||
          l[startIdx] === "/" ||
          l[startIdx] === "-" ||
          l[startIdx] === " " ||
          l[startIdx] === "\t")
      ) {
        startIdx++;
      }
      const cleaned = l.slice(startIdx).trim();
      const marker = "MSC Adams Dataset:";
      const idx = cleaned.indexOf(marker);
      if (idx !== -1) {
        dataset.title = cleaned.slice(idx + marker.length).trim();
        break;
      }
      const marker2 = "Title:";
      const idx2 = cleaned.indexOf(marker2);
      if (idx2 !== -1) {
        dataset.title = cleaned.slice(idx2 + marker2.length).trim();
        break;
      }
    }
  }

  const cards = preprocessCards(source);

  for (const card of cards) {
    const parsed = tokenizeCard(card);
    if (!parsed) continue;

    const { keyword, id, params } = parsed;

    switch (keyword) {
      case "ADAMS":
      case "TITLE": {
        if (typeof id === "string" && id) {
          dataset.title = id;
        } else if (params.has("NAME")) {
          dataset.title = params.get("NAME")?.[0] ?? defaultTitle;
        }
        break;
      }

      case "PART": {
        parsePartCard(parsed, dataset);
        break;
      }

      case "MARKER": {
        parseMarkerCard(parsed, dataset);
        break;
      }

      case "JOINT": {
        parseJointCard(parsed, dataset);
        break;
      }

      case "SPRINGDAMPER":
      case "SFORCE":
      case "VFORCE":
      case "GFORCE":
      case "BUSHING": {
        parseForceCard(parsed, dataset);
        break;
      }

      case "MOTION": {
        parseMotionCard(parsed, dataset);
        break;
      }

      case "REQUEST": {
        parseRequestCard(parsed, dataset);
        break;
      }

      case "SIMULATE": {
        parseSimulateCard(parsed, dataset);
        break;
      }

      case "MODEL": {
        // Handle "model create model_name = ..."
        const modelName = params.get("MODEL_NAME")?.[0] ?? params.get("NAME")?.[0];
        if (modelName) dataset.title = modelName;
        break;
      }

      case "CONSTRAINT": {
        // Handle "constraint create joint ..."
        parseCommandJoint(parsed, dataset);
        break;
      }

      default:
        // Ignore other keywords (END, ACCELEROMETER, etc.) gracefully
        break;
    }
  }

  return dataset;
}

function parsePartCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.parts.size + 1;
  const isGround = card.params.has("GROUND") || String(id).toUpperCase() === "GROUND";
  const massVal = card.params.get("MASS")?.[0];
  const mass = isGround ? 0 : massVal ? parseAdamsNumber(massVal) : 0;

  const cmStr = card.params.get("CM")?.[0];
  const cmMarkerId = cmStr ? (Number.isNaN(Number(cmStr)) ? cmStr : Number(cmStr)) : undefined;

  // Inertia IP = ixx, iyy, izz
  const ipList = card.params.get("IP") ?? [];
  const ixx = ipList[0] ? parseAdamsNumber(ipList[0]) : 0;
  const iyy = ipList[1] ? parseAdamsNumber(ipList[1]) : 0;
  const izz = ipList[2] ? parseAdamsNumber(ipList[2]) : 0;

  const inertia: AdamsInertia = { ixx, iyy, izz };
  const ixyStr = card.params.get("IXY")?.[0];
  if (ixyStr) inertia.ixy = parseAdamsNumber(ixyStr);
  const ixzStr = card.params.get("IXZ")?.[0];
  if (ixzStr) inertia.ixz = parseAdamsNumber(ixzStr);
  const iyzStr = card.params.get("IYZ")?.[0];
  if (iyzStr) inertia.iyz = parseAdamsNumber(iyzStr);

  const name = isGround ? "ground" : `part_${id}`;

  const part: AdamsPart = {
    id,
    name,
    isGround,
    mass,
    cmMarkerId,
    inertia,
    range: card.range,
  };

  dataset.parts.set(id, part);
}

function parseMarkerCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.markers.size + 1;
  const partStr = card.params.get("PART")?.[0] ?? card.params.get("PART_NAME")?.[0] ?? "1";
  const partId = Number.isNaN(Number(partStr)) ? partStr : Number(partStr);

  // Position: QP = x, y, z or LOCATION = x, y, z
  const qpList = card.params.get("QP") ?? card.params.get("LOCATION") ?? [];
  const position: Vector3D = {
    x: qpList[0] ? parseAdamsNumber(qpList[0]) : 0,
    y: qpList[1] ? parseAdamsNumber(qpList[1]) : 0,
    z: qpList[2] ? parseAdamsNumber(qpList[2]) : 0,
  };

  // Orientation: REULER = psi, theta, phi or ORIENTATION = a1, a2, a3
  const reulerList = card.params.get("REULER") ?? card.params.get("ORIENTATION") ?? [];
  const orientation: Vector3D = {
    x: reulerList[0] ? parseAdamsNumber(reulerList[0]) : 0,
    y: reulerList[1] ? parseAdamsNumber(reulerList[1]) : 0,
    z: reulerList[2] ? parseAdamsNumber(reulerList[2]) : 0,
  };

  const name = card.params.get("NAME")?.[0] ?? `marker_${id}`;

  const marker: AdamsMarker = {
    id,
    name,
    partId,
    position,
    orientation,
    useEuler: reulerList.length > 0,
    range: card.range,
  };

  dataset.markers.set(id, marker);
}

function parseJointCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.joints.size + 1;

  // Joint type might be in params flags or explicit TYPE parameter
  let type: AdamsJointType = "REVOLUTE";
  const validTypes: AdamsJointType[] = [
    "REVOLUTE",
    "TRANSLATIONAL",
    "SPHERICAL",
    "UNIVERSAL",
    "PLANAR",
    "CYLINDRICAL",
    "FIXED",
    "SCREW",
  ];

  for (const t of validTypes) {
    if (card.params.has(t)) {
      type = t;
      break;
    }
  }

  const typeParam = card.params.get("TYPE")?.[0]?.toUpperCase();
  if (typeParam && validTypes.includes(typeParam as AdamsJointType)) {
    type = typeParam as AdamsJointType;
  }

  const iStr = card.params.get("I")?.[0] ?? card.params.get("I_MARKER_NAME")?.[0] ?? "";
  const jStr = card.params.get("J")?.[0] ?? card.params.get("J_MARKER_NAME")?.[0] ?? "";

  const iMarkerId = Number.isNaN(Number(iStr)) ? iStr : Number(iStr);
  const jMarkerId = Number.isNaN(Number(jStr)) ? jStr : Number(jStr);

  const pitchVal = card.params.get("PD")?.[0];
  const pitch = pitchVal ? parseAdamsNumber(pitchVal) : undefined;

  let dofCount = 1;
  switch (type) {
    case "REVOLUTE":
    case "TRANSLATIONAL":
    case "SCREW":
      dofCount = 1;
      break;
    case "CYLINDRICAL":
    case "UNIVERSAL":
      dofCount = 2;
      break;
    case "SPHERICAL":
    case "PLANAR":
      dofCount = 3;
      break;
    case "FIXED":
      dofCount = 0;
      break;
  }

  const joint: AdamsJoint = {
    id,
    name: `joint_${id}`,
    type,
    iMarkerId,
    jMarkerId,
    pitch,
    dofCount,
    range: card.range,
  };

  dataset.joints.set(id, joint);
}

function parseCommandJoint(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.params.get("JOINT_NAME")?.[0] ?? `joint_${dataset.joints.size + 1}`;
  let type: AdamsJointType = "REVOLUTE";
  if (card.params.has("REVOLUTE")) type = "REVOLUTE";
  else if (card.params.has("SPHERICAL")) type = "SPHERICAL";
  else if (card.params.has("TRANSLATIONAL")) type = "TRANSLATIONAL";
  else if (card.params.has("UNIVERSAL")) type = "UNIVERSAL";
  else if (card.params.has("FIXED")) type = "FIXED";

  const iMarkerId = card.params.get("I_MARKER_NAME")?.[0] ?? "";
  const jMarkerId = card.params.get("J_MARKER_NAME")?.[0] ?? "";

  let dofCount = 1;
  if (type === "SPHERICAL") dofCount = 3;
  else if (type === "UNIVERSAL") dofCount = 2;
  else if (type === "FIXED") dofCount = 0;

  dataset.joints.set(id, {
    id,
    name: String(id),
    type,
    iMarkerId,
    jMarkerId,
    dofCount,
    range: card.range,
  });
}

function parseForceCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.forces.size + 1;
  const type = card.keyword as AdamsForceType;

  const actionType: "TRANSLATIONAL" | "ROTATIONAL" =
    card.params.has("ROTATIONAL") || card.params.get("TYPE")?.[0]?.toUpperCase() === "ROTATIONAL"
      ? "ROTATIONAL"
      : "TRANSLATIONAL";

  const iStr = card.params.get("I")?.[0] ?? "";
  const jStr = card.params.get("J")?.[0] ?? "";
  const iMarkerId = Number.isNaN(Number(iStr)) ? iStr : Number(iStr);
  const jMarkerId = Number.isNaN(Number(jStr)) ? jStr : Number(jStr);

  const kVal = card.params.get("K")?.[0] ?? card.params.get("STIFFNESS")?.[0];
  const cVal = card.params.get("C")?.[0] ?? card.params.get("DAMPING")?.[0];
  const lenVal = card.params.get("LENGTH")?.[0] ?? card.params.get("FREE_LENGTH")?.[0];
  const funcVal = card.params.get("FUNCTION")?.[0];

  const force: AdamsForce = {
    id,
    name: `${type.toLowerCase()}_${id}`,
    type,
    actionType,
    iMarkerId,
    jMarkerId,
    stiffness: kVal ? parseAdamsNumber(kVal) : undefined,
    damping: cVal ? parseAdamsNumber(cVal) : undefined,
    freeLength: lenVal ? parseAdamsNumber(lenVal) : undefined,
    functionExpr: funcVal,
    range: card.range,
  };

  dataset.forces.set(id, force);
}

function parseMotionCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.motions.size + 1;
  const jointIdStr = card.params.get("JOINT")?.[0];
  const jointId = jointIdStr ? (Number.isNaN(Number(jointIdStr)) ? jointIdStr : Number(jointIdStr)) : undefined;

  const markerIdStr = card.params.get("I")?.[0] ?? card.params.get("MARKER")?.[0];
  const markerId = markerIdStr ? (Number.isNaN(Number(markerIdStr)) ? markerIdStr : Number(markerIdStr)) : undefined;

  const type = card.params.has("ROTATIONAL") ? "ROTATIONAL" : "TRANSLATIONAL";
  const functionExpr = card.params.get("FUNCTION")?.[0] ?? "0.0";

  const motion: AdamsMotion = {
    id,
    name: `motion_${id}`,
    jointId,
    markerId,
    type,
    functionExpr,
    range: card.range,
  };

  dataset.motions.set(id, motion);
}

function parseRequestCard(card: KeyValueCard, dataset: AdamsDataset): void {
  const id = card.id ?? dataset.requests.size + 1;
  let type: AdamsRequest["type"] = "DISPLACEMENT";
  if (card.params.has("VELOCITY")) type = "VELOCITY";
  else if (card.params.has("ACCELERATION")) type = "ACCELERATION";
  else if (card.params.has("FORCE")) type = "FORCE";

  const iStr = card.params.get("I")?.[0] ?? "";
  const jStr = card.params.get("J")?.[0] ?? "";
  const rmStr = card.params.get("RM")?.[0];

  const request: AdamsRequest = {
    id,
    name: `req_${id}`,
    type,
    iMarkerId: Number.isNaN(Number(iStr)) ? iStr : Number(iStr),
    jMarkerId: Number.isNaN(Number(jStr)) ? jStr : Number(jStr),
    refMarkerId: rmStr ? (Number.isNaN(Number(rmStr)) ? rmStr : Number(rmStr)) : undefined,
    range: card.range,
  };

  dataset.requests.set(id, request);
}

function parseSimulateCard(card: KeyValueCard, dataset: AdamsDataset): void {
  let type: AdamsSimulateDirective["type"] = "DYNAMIC";
  const idUpper = String(card.id).toUpperCase();
  if (idUpper === "STATICS" || card.params.has("STATICS")) type = "STATICS";
  else if (idUpper === "KINEMATICS" || card.params.has("KINEMATICS")) type = "KINEMATICS";
  else if (idUpper === "LINEAR" || card.params.has("LINEAR")) type = "LINEAR";

  const endVal = card.params.get("END")?.[0] ?? card.params.get("END_TIME")?.[0];
  const dtVal = card.params.get("DTOUT")?.[0];
  const stepVal = card.params.get("STEPS")?.[0] ?? card.params.get("NUMBER_OF_STEPS")?.[0];

  dataset.simulation = {
    type,
    endTime: endVal ? parseAdamsNumber(endVal) : undefined,
    dtOut: dtVal ? parseAdamsNumber(dtVal) : undefined,
    numSteps: stepVal ? Number.parseInt(stepVal, 10) : undefined,
    range: card.range,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lossless Adams Serializer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializes an AdamsDataset back to canonical MSC Adams Dataset (.adm) syntax.
 */
export function serializeAdams(dataset: AdamsDataset): string {
  const lines: string[] = [];
  lines.push("!------------------------------------------------------------------");
  lines.push(`! MSC Adams Dataset: ${dataset.title}`);
  lines.push("! ModelScript Compiler & MBD Synthesis Tool");
  lines.push("!------------------------------------------------------------------");
  lines.push(`ADAMS/`);
  lines.push("");

  // 1. Parts
  lines.push("!----------------------------------- PARTS ------------------------");
  for (const part of dataset.parts.values()) {
    if (part.isGround) {
      lines.push(`PART/${part.id}, GROUND`);
    } else {
      const cmStr = part.cmMarkerId !== undefined ? `, CM = ${part.cmMarkerId}` : "";
      const ipStr = `, IP = ${part.inertia.ixx}, ${part.inertia.iyy}, ${part.inertia.izz}`;
      lines.push(`PART/${part.id}, MASS = ${part.mass}${cmStr}${ipStr}`);
    }
  }
  lines.push("");

  // 2. Markers
  lines.push("!---------------------------------- MARKERS -----------------------");
  for (const m of dataset.markers.values()) {
    const qp = `QP = ${m.position.x}, ${m.position.y}, ${m.position.z}`;
    const reuler = `REULER = ${m.orientation.x}, ${m.orientation.y}, ${m.orientation.z}`;
    lines.push(`MARKER/${m.id}, PART = ${m.partId}, ${qp}, ${reuler}`);
  }
  lines.push("");

  // 3. Joints
  lines.push("!----------------------------------- JOINTS -----------------------");
  for (const j of dataset.joints.values()) {
    const pitchStr = j.pitch !== undefined ? `, PD = ${j.pitch}` : "";
    lines.push(`JOINT/${j.id}, ${j.type}, I = ${j.iMarkerId}, J = ${j.jMarkerId}${pitchStr}`);
  }
  lines.push("");

  // 4. Force Elements
  if (dataset.forces.size > 0) {
    lines.push("!----------------------------------- FORCES -----------------------");
    for (const f of dataset.forces.values()) {
      if (f.type === "SPRINGDAMPER") {
        const kStr = f.stiffness !== undefined ? `, K = ${f.stiffness}` : "";
        const cStr = f.damping !== undefined ? `, C = ${f.damping}` : "";
        const lenStr = f.freeLength !== undefined ? `, LENGTH = ${f.freeLength}` : "";
        lines.push(
          `SPRINGDAMPER/${f.id}, ${f.actionType ?? "TRANSLATIONAL"}, I = ${f.iMarkerId}, J = ${f.jMarkerId}${kStr}${cStr}${lenStr}`,
        );
      } else {
        const funcStr = f.functionExpr ? `, FUNCTION = ${f.functionExpr}` : "";
        lines.push(
          `${f.type}/${f.id}, ${f.actionType ?? "TRANSLATIONAL"}, I = ${f.iMarkerId}, J = ${f.jMarkerId}${funcStr}`,
        );
      }
    }
    lines.push("");
  }

  // 5. Motions
  if (dataset.motions.size > 0) {
    lines.push("!---------------------------------- MOTIONS -----------------------");
    for (const mot of dataset.motions.values()) {
      const target = mot.jointId !== undefined ? `JOINT = ${mot.jointId}` : `MARKER = ${mot.markerId}`;
      lines.push(`MOTION/${mot.id}, ${target}, ${mot.type}, FUNCTION = ${mot.functionExpr}`);
    }
    lines.push("");
  }

  // 6. Requests
  if (dataset.requests.size > 0) {
    lines.push("!--------------------------------- REQUESTS -----------------------");
    for (const req of dataset.requests.values()) {
      lines.push(`REQUEST/${req.id}, ${req.type}, I = ${req.iMarkerId}, J = ${req.jMarkerId}`);
    }
    lines.push("");
  }

  // 7. Simulation Control
  if (dataset.simulation) {
    lines.push("!--------------------------- SIMULATION CONTROL -------------------");
    const sim = dataset.simulation;
    const endStr = sim.endTime !== undefined ? `, END = ${sim.endTime}` : "";
    const dtStr = sim.dtOut !== undefined ? `, DTOUT = ${sim.dtOut}` : "";
    const stepStr = sim.numSteps !== undefined ? `, STEPS = ${sim.numSteps}` : "";
    lines.push(`SIMULATE/${sim.type}${endStr}${dtStr}${stepStr}`);
    lines.push("");
  }

  lines.push("END");
  return lines.join("\n");
}
