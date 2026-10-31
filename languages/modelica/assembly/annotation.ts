// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable */
// @ts-nocheck
import {
  getNodeFirstChild,
  getNodeNextSibling,
  getNodeType,
  getNodePadding,
  getNodeByteLength,
  getInputBuffer,
  atomicChunkAlloc,
  inputEncoding,
} from "./arena";
import { SourceTextView } from "./array";
import { SyntaxType } from "./types";
import {
  locMake,
  locMakeRoot,
  locPtr,
  locOffset,
  locIsNull,
  locLen,
  locByteLen,
  locType,
  locBytes,
  locFirstChild,
  locNextSibling,
  locMatches,
  locStartsWith,
  locChild,
  locFindChild,
  locFindDescendant,
  locFindLastDescendant,
} from "./flattener";

// ── Graphic Item Kinds ───────────────────────────────────────────────────────
export const GRAPHIC_NONE: u8 = 0;
export const GRAPHIC_RECTANGLE: u8 = 1;
export const GRAPHIC_ELLIPSE: u8 = 2;
export const GRAPHIC_LINE: u8 = 3;
export const GRAPHIC_POLYGON: u8 = 4;
export const GRAPHIC_TEXT: u8 = 5;
export const GRAPHIC_BITMAP: u8 = 6;

// ── Pattern Enums ────────────────────────────────────────────────────────────
export const FILL_NONE: u8 = 0;
export const FILL_SOLID: u8 = 1;
export const FILL_HORIZONTAL: u8 = 2;
export const FILL_VERTICAL: u8 = 3;
export const FILL_CROSS: u8 = 4;
export const FILL_FORWARD: u8 = 5;
export const FILL_BACKWARD: u8 = 6;
export const FILL_CROSSDIAG: u8 = 7;
export const FILL_HORIZ_CYLINDER: u8 = 8;
export const FILL_VERT_CYLINDER: u8 = 9;
export const FILL_SPHERE: u8 = 10;

export const LINE_NONE: u8 = 0;
export const LINE_SOLID: u8 = 1;
export const LINE_DASH: u8 = 2;
export const LINE_DOT: u8 = 3;
export const LINE_DASHDOT: u8 = 4;
export const LINE_DASHDOTDOT: u8 = 5;

export const SMOOTH_NONE: u8 = 0;
export const SMOOTH_BEZIER: u8 = 1;

export const ALIGN_LEFT: u8 = 0;
export const ALIGN_CENTER: u8 = 1;
export const ALIGN_RIGHT: u8 = 2;

export const ARROW_NONE: u8 = 0;
export const ARROW_OPEN: u8 = 1;
export const ARROW_FILLED: u8 = 2;
export const ARROW_HALF: u8 = 3;

// ── Unmanaged Linear Graphics Arena ─────────────────────────────────────────
const MAX_GRAPHICS: i32 = 256;
const MAX_POINTS: i32 = 4096;
const SVG_BUFFER_CAP: u32 = 262144; // 256 KB

@unmanaged
class GraphicSlot {
  x1: f64;
  y1: f64;
  x2: f64;
  y2: f64;
  originX: f64;
  originY: f64;
  rotation: f64;
  thickness: f64;
  radius: f64;
  fontSize: f64;
  arrowSize: f64;
  strokeColor: i32;
  fillColor: i32;
  pointsOffset: i32;
  pointsCount: i32;
  textOffset: u32;
  textLen: u32;
  kind: u8;
  fillPattern: u8;
  linePattern: u8;
  smooth: u8;
  visible: u8;
  textAlignment: u8;
  arrowStart: u8;
  arrowEnd: u8;
}

let g_graphicsBuf: usize = 0;
let g_pointsXBuf: usize = 0;
let g_pointsYBuf: usize = 0;
let g_digitBuf: usize = 0;
let g_svgBuffer: usize = 0;
let g_svgLen: u32 = 0;

// Scratch registers for point/extent/color parsing (zero heap allocations)
let g_tmpX1: f64 = 0.0;
let g_tmpY1: f64 = 0.0;
let g_ptCoordIdx: i32 = 0;

let g_extX1: f64 = 0.0;
let g_extY1: f64 = 0.0;
let g_extX2: f64 = 0.0;
let g_extY2: f64 = 0.0;
let g_extPtIdx: i32 = 0;

let g_colR: i32 = 0;
let g_colG: i32 = 0;
let g_colB: i32 = 0;
let g_colIdx: i32 = 0;
let g_arrowIdx: i32 = 0;

let g_foundIconMod: u64 = 0;
let g_iconClauseCount: i32 = 0;
let g_scanTargetDiagram: bool = false;

// Placement & Transformation state
let g_foundPlacementMod: u64 = 0;
let g_placementClauseCount: i32 = 0;
let g_hasPlacement: bool = false;
let g_placementVisible: i8 = -1;
let g_placementIconVisible: i8 = -1;

let g_hasTrans: bool = false;
let g_transHasOrigin: bool = false;
let g_transHasExtent: bool = false;
let g_transHasRotation: bool = false;
let g_transOriginX: f64 = 0.0;
let g_transOriginY: f64 = 0.0;
let g_transX1: f64 = 0.0;
let g_transY1: f64 = 0.0;
let g_transX2: f64 = 0.0;
let g_transY2: f64 = 0.0;
let g_transRotation: f64 = 0.0;

let g_hasIconTrans: bool = false;
let g_iconTransHasOrigin: bool = false;
let g_iconTransHasExtent: bool = false;
let g_iconTransHasRotation: bool = false;
let g_iconTransOriginX: f64 = 0.0;
let g_iconTransOriginY: f64 = 0.0;
let g_iconTransX1: f64 = 0.0;
let g_iconTransY1: f64 = 0.0;
let g_iconTransX2: f64 = 0.0;
let g_iconTransY2: f64 = 0.0;
let g_iconTransRotation: f64 = 0.0;

// Connect Line state
let g_foundLineMod: u64 = 0;
let g_lineClauseCount: i32 = 0;
let g_hasConnectLine: bool = false;

// Coordinate System
let g_coordX1: f64 = -100.0;
let g_coordY1: f64 = -100.0;
let g_coordX2: f64 = 100.0;
let g_coordY2: f64 = 100.0;
let g_preserveAspectRatio: bool = true;
let g_hasCoordSys: bool = false;
let g_hasIcon: bool = false;
let g_bailOut: bool = false;

let g_graphicCount: i32 = 0;
let g_totalPoints: i32 = 0;

const ARRAY_MODE_POINT_XY: i32 = 1;
const ARRAY_MODE_EXTENT_POINTS: i32 = 2;
const ARRAY_MODE_POINT_LIST: i32 = 3;
const ARRAY_MODE_COLOR_RGB: i32 = 4;
const ARRAY_MODE_GRAPHIC_ITEMS: i32 = 5;
const ARRAY_MODE_ARROWS: i32 = 6;

const MOD_MODE_FIND_ICON: i32 = 1;
const MOD_MODE_ICON_PROPS: i32 = 2;
const MOD_MODE_COORDSYS_PROPS: i32 = 3;
const MOD_MODE_FIND_PLACEMENT: i32 = 4;
const MOD_MODE_PLACEMENT_PROPS: i32 = 5;
const MOD_MODE_TRANS_PROPS: i32 = 6;
const MOD_MODE_ICON_TRANS_PROPS: i32 = 7;
const MOD_MODE_FIND_CONNECT_LINE: i32 = 8;
const MOD_MODE_CONNECT_LINE_PROPS: i32 = 9;

function ensureAnnotationArena(): void {
  if (g_graphicsBuf == 0) {
    g_graphicsBuf = atomicChunkAlloc((MAX_GRAPHICS as u32) * offsetof<GraphicSlot>());
    g_pointsXBuf = atomicChunkAlloc((MAX_POINTS as u32) * sizeof<f64>());
    g_pointsYBuf = atomicChunkAlloc((MAX_POINTS as u32) * sizeof<f64>());
    g_digitBuf = atomicChunkAlloc(32);
  }
}

function ensureSvgBuffer(): void {
  ensureAnnotationArena();
  if (g_svgBuffer == 0) {
    g_svgBuffer = atomicChunkAlloc(SVG_BUFFER_CAP);
  }
  g_svgLen = 0;
}

@inline
function getSlot(idx: i32): GraphicSlot {
  return changetype<GraphicSlot>(g_graphicsBuf + (idx as usize) * offsetof<GraphicSlot>());
}

@inline
function getPointX(ptIdx: i32): f64 {
  return load<f64>(g_pointsXBuf + (ptIdx as usize) * sizeof<f64>());
}

@inline
function setPointX(ptIdx: i32, val: f64): void {
  store<f64>(g_pointsXBuf + (ptIdx as usize) * sizeof<f64>(), val);
}

@inline
function getPointY(ptIdx: i32): f64 {
  return load<f64>(g_pointsYBuf + (ptIdx as usize) * sizeof<f64>());
}

@inline
function setPointY(ptIdx: i32, val: f64): void {
  store<f64>(g_pointsYBuf + (ptIdx as usize) * sizeof<f64>(), val);
}

@inline
function writeByte(b: u8): void {
  if (g_svgLen < SVG_BUFFER_CAP - 1) {
    store<u8>(g_svgBuffer + (g_svgLen++), b);
  }
}

function writeString(str: string): void {
  let len = str.length;
  for (let i = 0; i < len; ++i) {
    writeByte(str.charCodeAt(i) as u8);
  }
}

function writeInt(val: i32): void {
  if (val == 0) {
    writeByte(48); // '0'
    return;
  }
  if (val < 0) {
    writeByte(45); // '-'
    val = -val;
  }
  let pos: usize = 0;
  while (val > 0 && pos < 16) {
    store<u8>(g_digitBuf + pos, ((val % 10) + 48) as u8);
    pos++;
    val = val / 10;
  }
  while (pos > 0) {
    pos--;
    writeByte(load<u8>(g_digitBuf + pos));
  }
}

function writeFloat(val: f64, decimals: i32 = 2): void {
  if (val < 0.0) {
    if (val > -0.00005) {
      val = 0.0;
    } else {
      writeByte(45); // '-'
      val = -val;
    }
  }
  let intPart = Math.floor(val + 1e-9) as i64;
  let fracPart = val - (intPart as f64);
  if (fracPart < 0.0) fracPart = 0.0;
  writeInt(intPart as i32);
  if (decimals > 0 && fracPart > 0.0001) {
    writeByte(46); // '.'
    for (let d = 0; d < decimals; ++d) {
      fracPart *= 10.0;
      let digit = Math.floor(fracPart + 1e-7) as i32;
      if (digit > 9) digit = 9;
      writeByte((digit + 48) as u8);
      fracPart -= digit as f64;
      if (fracPart <= 0.0001) break;
    }
  }
}

function writeColorRgb(packed: i32, defaultVal: string): void {
  if (packed < 0) {
    writeString(defaultVal);
    return;
  }
  let r = (packed >> 16) & 0xff;
  let g = (packed >> 8) & 0xff;
  let b = packed & 0xff;
  writeString("rgb(");
  writeInt(r);
  writeString(",");
  writeInt(g);
  writeString(",");
  writeInt(b);
  writeString(")");
}

// ── CST Parsing & Extraction Helpers ────────────────────────────────────────

@inline
function isSpaceChar(c: i32): bool {
  return c == 32 || c == 9 || c == 10 || c == 13;
}

function parseNumberStrict(loc: u64): f64 {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return 0.0;
  }
  let src = locBytes(loc);
  let byteLen = locByteLen(loc);
  if (src == 0 || byteLen == 0) {
    g_bailOut = true;
    return 0.0;
  }
  let text = SourceTextView.at(src, byteLen, inputEncoding == 1 || inputEncoding == 2);
  let n = text.charCount;
  let i: u32 = 0;
  while (i < n && isSpaceChar(text.charAt(i))) i++;
  let sign: f64 = 1.0;
  if (i < n) {
    let c = text.charAt(i);
    if (c == 45) {
      sign = -1.0;
      i++;
    } else if (c == 43) {
      i++;
    }
  }
  while (i < n && isSpaceChar(text.charAt(i))) i++;
  let intPart: f64 = 0.0;
  let hasDigits = false;
  while (i < n) {
    let c = text.charAt(i);
    if (c >= 48 && c <= 57) {
      intPart = intPart * 10.0 + ((c - 48) as f64);
      hasDigits = true;
      i++;
    } else {
      break;
    }
  }
  let fracPart: f64 = 0.0;
  let fracDiv: f64 = 1.0;
  if (i < n && text.charAt(i) == 46) {
    i++;
    while (i < n) {
      let c = text.charAt(i);
      if (c >= 48 && c <= 57) {
        fracPart = fracPart * 10.0 + ((c - 48) as f64);
        fracDiv *= 10.0;
        hasDigits = true;
        i++;
      } else {
        break;
      }
    }
  }
  let expSign: i32 = 1;
  let expVal: i32 = 0;
  if (i < n && (text.charAt(i) == 101 || text.charAt(i) == 69)) {
    i++;
    if (i < n) {
      let ec = text.charAt(i);
      if (ec == 45) {
        expSign = -1;
        i++;
      } else if (ec == 43) {
        i++;
      }
    }
    let hasExpDigits = false;
    while (i < n) {
      let ec = text.charAt(i);
      if (ec >= 48 && ec <= 57) {
        expVal = expVal * 10 + ((ec - 48) as i32);
        hasExpDigits = true;
        i++;
      } else {
        break;
      }
    }
    if (!hasExpDigits) {
      g_bailOut = true;
      return 0.0;
    }
  }
  while (i < n && isSpaceChar(text.charAt(i))) i++;
  if (!hasDigits || i < n) {
    g_bailOut = true;
    return 0.0;
  }
  let val = sign * (intPart + (fracDiv > 1.0 ? fracPart / fracDiv : 0.0));
  if (expVal != 0) {
    val *= Math.pow(10.0, (expSign * expVal) as f64);
  }
  return val;
}

function visitArrayElements(loc: u64, mode: i32, slotIdx: i32): void {
  if (locIsNull(loc) || g_bailOut) return;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch) && !g_bailOut) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.EXPRESSION) {
        if (mode == ARRAY_MODE_POINT_XY) {
          if (g_ptCoordIdx == 0) {
            g_tmpX1 = parseNumberStrict(ch);
            g_ptCoordIdx = 1;
          } else if (g_ptCoordIdx == 1) {
            g_tmpY1 = parseNumberStrict(ch);
            g_ptCoordIdx = 2;
          } else {
            g_bailOut = true;
          }
        } else if (mode == ARRAY_MODE_EXTENT_POINTS) {
          if (g_extPtIdx == 0) {
            if (parsePointPairIntoScratch(ch)) {
              g_extX1 = g_tmpX1;
              g_extY1 = g_tmpY1;
              g_extPtIdx = 1;
            }
          } else if (g_extPtIdx == 1) {
            if (parsePointPairIntoScratch(ch)) {
              g_extX2 = g_tmpX1;
              g_extY2 = g_tmpY1;
              g_extPtIdx = 2;
            }
          } else {
            g_bailOut = true;
          }
        } else if (mode == ARRAY_MODE_POINT_LIST) {
          if (parsePointPairIntoScratch(ch)) {
            if (g_totalPoints < MAX_POINTS) {
              setPointX(g_totalPoints, g_tmpX1);
              setPointY(g_totalPoints, g_tmpY1);
              g_totalPoints++;
              getSlot(slotIdx).pointsCount++;
            } else {
              g_bailOut = true;
            }
          }
        } else if (mode == ARRAY_MODE_COLOR_RGB) {
          let val = Math.round(parseNumberStrict(ch)) as i32;
          if (!g_bailOut) {
            if (g_colIdx == 0) g_colR = val;
            else if (g_colIdx == 1) g_colG = val;
            else if (g_colIdx == 2) g_colB = val;
            else g_bailOut = true;
            g_colIdx++;
          }
        } else if (mode == ARRAY_MODE_GRAPHIC_ITEMS) {
          parseGraphicItem(ch);
        } else if (mode == ARRAY_MODE_ARROWS) {
          let arrVal = parseArrow(ch);
          if (!g_bailOut) {
            if (g_arrowIdx == 0) getSlot(slotIdx).arrowStart = arrVal;
            else if (g_arrowIdx == 1) getSlot(slotIdx).arrowEnd = arrVal;
            else g_bailOut = true;
            g_arrowIdx++;
          }
        }
      } else {
        visitArrayElements(ch, mode, slotIdx);
      }
    }
    ch = locNextSibling(ch);
  }
}

function parsePointPairIntoScratch(loc: u64): bool {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return false;
  }
  let arrArgs = locType(loc) == SyntaxType.ARRAY_ARGUMENTS ? loc : locFindDescendant(loc, SyntaxType.ARRAY_ARGUMENTS);
  if (locIsNull(arrArgs)) {
    g_bailOut = true;
    return false;
  }
  g_ptCoordIdx = 0;
  visitArrayElements(arrArgs, ARRAY_MODE_POINT_XY, 0);
  if (g_ptCoordIdx != 2 || g_bailOut) {
    g_bailOut = true;
    return false;
  }
  return true;
}

function parseExtentToScratch(loc: u64): bool {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return false;
  }
  let arrArgs = locType(loc) == SyntaxType.ARRAY_ARGUMENTS ? loc : locFindDescendant(loc, SyntaxType.ARRAY_ARGUMENTS);
  if (locIsNull(arrArgs)) {
    g_bailOut = true;
    return false;
  }
  g_extPtIdx = 0;
  visitArrayElements(arrArgs, ARRAY_MODE_EXTENT_POINTS, 0);
  if (g_extPtIdx != 2 || g_bailOut) {
    g_bailOut = true;
    return false;
  }
  return true;
}

function parsePoints(loc: u64, slotIdx: i32): void {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return;
  }
  let slot = getSlot(slotIdx);
  slot.pointsOffset = g_totalPoints;
  slot.pointsCount = 0;

  let arrArgs = locType(loc) == SyntaxType.ARRAY_ARGUMENTS ? loc : locFindDescendant(loc, SyntaxType.ARRAY_ARGUMENTS);
  if (locIsNull(arrArgs)) {
    return;
  }
  visitArrayElements(arrArgs, ARRAY_MODE_POINT_LIST, slotIdx);
}

function parseColor(loc: u64): i32 {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return -1;
  }
  let arrArgs = locType(loc) == SyntaxType.ARRAY_ARGUMENTS ? loc : locFindDescendant(loc, SyntaxType.ARRAY_ARGUMENTS);
  if (locIsNull(arrArgs)) {
    g_bailOut = true;
    return -1;
  }
  g_colIdx = 0;
  visitArrayElements(arrArgs, ARRAY_MODE_COLOR_RGB, 0);
  if (g_colIdx == 3 && !g_bailOut) {
    return ((g_colR & 0xff) << 16) | ((g_colG & 0xff) << 8) | (g_colB & 0xff);
  }
  g_bailOut = true;
  return -1;
}

function parseFillPattern(loc: u64): u8 {
  if (locIsNull(loc)) return FILL_NONE;
  let lastId = locFindLastDescendant(loc, SyntaxType.IDENTIFIER);
  let target = !locIsNull(lastId) ? lastId : loc;
  if (locMatches(target, "None")) return FILL_NONE;
  if (locMatches(target, "Solid")) return FILL_SOLID;
  if (locMatches(target, "Horizontal")) return FILL_HORIZONTAL;
  if (locMatches(target, "Vertical")) return FILL_VERTICAL;
  if (locMatches(target, "Cross")) return FILL_CROSS;
  if (locMatches(target, "Forward")) return FILL_FORWARD;
  if (locMatches(target, "Backward")) return FILL_BACKWARD;
  if (locMatches(target, "CrossDiag")) return FILL_CROSSDIAG;
  if (locMatches(target, "HorizontalCylinder")) return FILL_HORIZ_CYLINDER;
  if (locMatches(target, "VerticalCylinder")) return FILL_VERT_CYLINDER;
  if (locMatches(target, "Sphere")) return FILL_SPHERE;
  g_bailOut = true;
  return FILL_NONE;
}

function parseLinePattern(loc: u64): u8 {
  if (locIsNull(loc)) return LINE_SOLID;
  let lastId = locFindLastDescendant(loc, SyntaxType.IDENTIFIER);
  let target = !locIsNull(lastId) ? lastId : loc;
  if (locMatches(target, "None")) return LINE_NONE;
  if (locMatches(target, "Solid")) return LINE_SOLID;
  if (locMatches(target, "Dash")) return LINE_DASH;
  if (locMatches(target, "Dot")) return LINE_DOT;
  if (locMatches(target, "DashDot")) return LINE_DASHDOT;
  if (locMatches(target, "DashDotDot")) return LINE_DASHDOTDOT;
  g_bailOut = true;
  return LINE_SOLID;
}

function parseSmooth(loc: u64): u8 {
  if (locIsNull(loc)) return SMOOTH_NONE;
  let lastId = locFindLastDescendant(loc, SyntaxType.IDENTIFIER);
  let target = !locIsNull(lastId) ? lastId : loc;
  if (locMatches(target, "None")) return SMOOTH_NONE;
  if (locMatches(target, "Bezier")) return SMOOTH_BEZIER;
  g_bailOut = true;
  return SMOOTH_NONE;
}

function parseTextAlignment(loc: u64): u8 {
  if (locIsNull(loc)) return ALIGN_CENTER;
  let lastId = locFindLastDescendant(loc, SyntaxType.IDENTIFIER);
  let target = !locIsNull(lastId) ? lastId : loc;
  if (locMatches(target, "Left")) return ALIGN_LEFT;
  if (locMatches(target, "Center")) return ALIGN_CENTER;
  if (locMatches(target, "Right")) return ALIGN_RIGHT;
  g_bailOut = true;
  return ALIGN_CENTER;
}

function parseArrow(loc: u64): u8 {
  if (locIsNull(loc)) return ARROW_NONE;
  let lastId = locFindLastDescendant(loc, SyntaxType.IDENTIFIER);
  let target = !locIsNull(lastId) ? lastId : loc;
  if (locMatches(target, "None")) return ARROW_NONE;
  if (locMatches(target, "Open")) return ARROW_OPEN;
  if (locMatches(target, "Filled")) return ARROW_FILLED;
  if (locMatches(target, "Half")) return ARROW_HALF;
  g_bailOut = true;
  return ARROW_NONE;
}

function parseArrows(loc: u64, slotIdx: i32): void {
  if (locIsNull(loc)) {
    g_bailOut = true;
    return;
  }
  let arrArgs = locType(loc) == SyntaxType.ARRAY_ARGUMENTS ? loc : locFindDescendant(loc, SyntaxType.ARRAY_ARGUMENTS);
  if (locIsNull(arrArgs)) {
    g_bailOut = true;
    return;
  }
  g_arrowIdx = 0;
  visitArrayElements(arrArgs, ARRAY_MODE_ARROWS, slotIdx);
  if (g_arrowIdx != 2) {
    g_bailOut = true;
  }
}

// ── Graphic Item Evaluator ──────────────────────────────────────────────────

function applyGraphicProp(ident: u64, argVal: u64, slotIdx: i32): void {
  if (locIsNull(ident) || locIsNull(argVal)) {
    g_bailOut = true;
    return;
  }

  let slot = getSlot(slotIdx);
  if (locMatches(ident, "extent")) {
    if (parseExtentToScratch(argVal)) {
      slot.x1 = g_extX1;
      slot.y1 = g_extY1;
      slot.x2 = g_extX2;
      slot.y2 = g_extY2;
    }
  } else if (locMatches(ident, "points")) {
    parsePoints(argVal, slotIdx);
  } else if (locMatches(ident, "lineColor") || locMatches(ident, "color") || locMatches(ident, "textColor")) {
    slot.strokeColor = parseColor(argVal);
  } else if (locMatches(ident, "fillColor")) {
    slot.fillColor = parseColor(argVal);
  } else if (locMatches(ident, "fillPattern")) {
    slot.fillPattern = parseFillPattern(argVal);
  } else if (locMatches(ident, "linePattern") || locMatches(ident, "pattern")) {
    slot.linePattern = parseLinePattern(argVal);
  } else if (locMatches(ident, "lineThickness") || locMatches(ident, "thickness")) {
    slot.thickness = parseNumberStrict(argVal);
  } else if (locMatches(ident, "radius") || locMatches(ident, "cornerRadius")) {
    slot.radius = parseNumberStrict(argVal);
  } else if (locMatches(ident, "smooth")) {
    slot.smooth = parseSmooth(argVal);
  } else if (locMatches(ident, "origin")) {
    if (parsePointPairIntoScratch(argVal)) {
      slot.originX = g_tmpX1;
      slot.originY = g_tmpY1;
    }
  } else if (locMatches(ident, "rotation")) {
    slot.rotation = parseNumberStrict(argVal);
  } else if (locMatches(ident, "visible")) {
    if (locMatches(argVal, "true")) {
      slot.visible = 1;
    } else if (locMatches(argVal, "false")) {
      slot.visible = 0;
    } else {
      g_bailOut = true;
    }
  } else if (locMatches(ident, "textString") || locMatches(ident, "string")) {
    let strLit = locType(argVal) == SyntaxType.STRING_LITERAL ? argVal : locFindDescendant(argVal, SyntaxType.STRING_LITERAL);
    if (!locIsNull(strLit)) {
      let off = locOffset(strLit);
      let len = locLen(strLit);
      if (len >= 2) {
        slot.textOffset = off + 1;
        slot.textLen = len - 2;
      }
    } else {
      g_bailOut = true;
    }
  } else if (locMatches(ident, "fontSize")) {
    slot.fontSize = parseNumberStrict(argVal);
  } else if (locMatches(ident, "horizontalAlignment")) {
    slot.textAlignment = parseTextAlignment(argVal);
  } else if (locMatches(ident, "borderPattern")) {
    let lastId = locFindLastDescendant(argVal, SyntaxType.IDENTIFIER);
    if (locIsNull(lastId) || !locMatches(lastId, "None")) {
      g_bailOut = true;
    }
  } else if (locMatches(ident, "arrow")) {
    parseArrows(argVal, slotIdx);
  } else if (locMatches(ident, "arrowSize")) {
    slot.arrowSize = parseNumberStrict(argVal);
  } else {
    g_bailOut = true;
  }
}

function processNamedGraphicArg(namedArg: u64, slotIdx: i32): void {
  let ident = locFindChild(namedArg, SyntaxType.IDENTIFIER);
  if (locIsNull(ident)) ident = locFindDescendant(namedArg, SyntaxType.IDENTIFIER);
  let funcArg = locFindChild(namedArg, SyntaxType.FUNCTION_ARGUMENT);
  if (locIsNull(funcArg)) funcArg = locFindDescendant(namedArg, SyntaxType.FUNCTION_ARGUMENT);
  let argVal = !locIsNull(funcArg) ? locFindDescendant(funcArg, SyntaxType.EXPRESSION) : 0;
  if (locIsNull(argVal)) argVal = funcArg;

  applyGraphicProp(ident, argVal, slotIdx);
}

function visitCallArgs(loc: u64, slotIdx: i32): void {
  if (locIsNull(loc) || g_bailOut) return;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch) && !g_bailOut) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.NAMED_ARGUMENT) {
        processNamedGraphicArg(ch, slotIdx);
      } else if (t == SyntaxType.FUNCTION_ARGUMENT) {
        // Positional argument on graphic item -> bail out to TS evaluator
        g_bailOut = true;
      } else {
        visitCallArgs(ch, slotIdx);
      }
    }
    ch = locNextSibling(ch);
  }
}

function initGraphicSlot(slotIdx: i32, kind: u8): void {
  let slot = getSlot(slotIdx);
  slot.kind = kind;
  slot.strokeColor = 0x000000;
  slot.fillColor = -1;
  slot.fillPattern = FILL_NONE;
  slot.linePattern = LINE_SOLID;
  slot.thickness = 0.25;
  slot.radius = 0.0;
  slot.smooth = SMOOTH_NONE;
  slot.visible = 1;
  slot.originX = 0.0;
  slot.originY = 0.0;
  slot.rotation = 0.0;
  slot.x1 = kind == GRAPHIC_ELLIPSE ? -100.0 : 0.0;
  slot.y1 = kind == GRAPHIC_ELLIPSE ? -100.0 : 0.0;
  slot.x2 = kind == GRAPHIC_ELLIPSE ? 100.0 : 0.0;
  slot.y2 = kind == GRAPHIC_ELLIPSE ? 100.0 : 0.0;
  slot.pointsOffset = 0;
  slot.pointsCount = 0;
  slot.textOffset = 0;
  slot.textLen = 0;
  slot.fontSize = 0.0;
  slot.arrowSize = 0.0;
  slot.textAlignment = ALIGN_CENTER;
  slot.arrowStart = ARROW_NONE;
  slot.arrowEnd = ARROW_NONE;
}

function parseGraphicItem(exprLoc: u64): void {
  if (locIsNull(exprLoc) || g_bailOut) return;
  if (g_graphicCount >= MAX_GRAPHICS) {
    g_bailOut = true;
    return;
  }

  let primaryLoc = locType(exprLoc) == SyntaxType.PRIMARY ? exprLoc : locFindDescendant(exprLoc, SyntaxType.PRIMARY);
  if (locIsNull(primaryLoc)) {
    g_bailOut = true;
    return;
  }

  let compRef = locFindDescendant(primaryLoc, SyntaxType.COMPONENT_REFERENCE);
  let callArgs = locFindDescendant(primaryLoc, SyntaxType.FUNCTION_CALL_ARGS);
  if (locIsNull(compRef) || locIsNull(callArgs)) {
    g_bailOut = true;
    return;
  }

  let kind: u8 = GRAPHIC_NONE;
  if (locMatches(compRef, "Rectangle")) kind = GRAPHIC_RECTANGLE;
  else if (locMatches(compRef, "Polygon")) kind = GRAPHIC_POLYGON;
  else if (locMatches(compRef, "Line")) kind = GRAPHIC_LINE;
  else if (locMatches(compRef, "Ellipse")) kind = GRAPHIC_ELLIPSE;
  else if (locMatches(compRef, "Text")) kind = GRAPHIC_TEXT;
  else {
    g_bailOut = true;
    return;
  }

  let slotIdx = g_graphicCount;
  initGraphicSlot(slotIdx, kind);

  visitCallArgs(callArgs, slotIdx);
  if (!g_bailOut) {
    g_graphicCount++;
  }
}

// ── Icon, Diagram, Placement & Connect Line Scanners ────────────────────────

function visitClassModArgs(loc: u64, mode: i32): void {
  if (locIsNull(loc) || g_bailOut) return;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch) && !g_bailOut) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.ELEMENT_MODIFICATION) {
        let nameLoc = locFindChild(ch, SyntaxType.NAME);
        if (locIsNull(nameLoc)) nameLoc = locFindDescendant(ch, SyntaxType.NAME);
        if (locIsNull(nameLoc)) nameLoc = locFindDescendant(ch, SyntaxType.IDENTIFIER);

        if (!locIsNull(nameLoc)) {
          if (mode == MOD_MODE_FIND_ICON) {
            if (!g_scanTargetDiagram) {
              if (locMatches(nameLoc, "Icon") || locMatches(nameLoc, "icon")) {
                g_foundIconMod = ch;
                g_iconClauseCount++;
              }
            } else {
              if (locMatches(nameLoc, "Diagram") || locMatches(nameLoc, "diagram")) {
                g_foundIconMod = ch;
                g_iconClauseCount++;
              }
            }
          } else if (mode == MOD_MODE_ICON_PROPS) {
            if (locMatches(nameLoc, "coordinateSystem")) {
              g_hasCoordSys = true;
              let csMod = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
              if (!locIsNull(csMod)) {
                visitClassModArgs(csMod, MOD_MODE_COORDSYS_PROPS);
              }
            } else if (locMatches(nameLoc, "graphics")) {
              let arrArgs = locFindDescendant(ch, SyntaxType.ARRAY_ARGUMENTS);
              if (!locIsNull(arrArgs)) {
                visitArrayElements(arrArgs, ARRAY_MODE_GRAPHIC_ITEMS, 0);
              }
            } else {
              g_bailOut = true;
            }
          } else if (mode == MOD_MODE_COORDSYS_PROPS) {
            if (locMatches(nameLoc, "extent")) {
              let extVal = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(extVal) && parseExtentToScratch(extVal)) {
                g_coordX1 = g_extX1;
                g_coordY1 = g_extY1;
                g_coordX2 = g_extX2;
                g_coordY2 = g_extY2;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "preserveAspectRatio")) {
              let parVal = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(parVal)) {
                if (locMatches(parVal, "false")) g_preserveAspectRatio = false;
                else if (locMatches(parVal, "true")) g_preserveAspectRatio = true;
                else g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "initialScale") || locMatches(nameLoc, "grid")) {
              // Allowed coordinateSystem properties not affecting SVG bounds
            } else {
              g_bailOut = true;
            }
          } else if (mode == MOD_MODE_FIND_PLACEMENT) {
            if (locMatches(nameLoc, "Placement") || locMatches(nameLoc, "placement")) {
              g_foundPlacementMod = ch;
              g_placementClauseCount++;
            }
          } else if (mode == MOD_MODE_PLACEMENT_PROPS) {
            if (locMatches(nameLoc, "visible")) {
              let visVal = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(visVal)) {
                if (locMatches(visVal, "true")) g_placementVisible = 1;
                else if (locMatches(visVal, "false")) g_placementVisible = 0;
                else g_bailOut = true;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "iconVisible")) {
              let visVal = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(visVal)) {
                if (locMatches(visVal, "true")) g_placementIconVisible = 1;
                else if (locMatches(visVal, "false")) g_placementIconVisible = 0;
                else g_bailOut = true;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "transformation")) {
              g_hasTrans = true;
              let trMod = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
              if (!locIsNull(trMod)) {
                visitClassModArgs(trMod, MOD_MODE_TRANS_PROPS);
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "iconTransformation")) {
              g_hasIconTrans = true;
              let trMod = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
              if (!locIsNull(trMod)) {
                visitClassModArgs(trMod, MOD_MODE_ICON_TRANS_PROPS);
              } else {
                g_bailOut = true;
              }
            } else {
              g_bailOut = true;
            }
          } else if (mode == MOD_MODE_TRANS_PROPS) {
            if (locMatches(nameLoc, "origin")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc) && parsePointPairIntoScratch(valLoc)) {
                g_transHasOrigin = true;
                g_transOriginX = g_tmpX1;
                g_transOriginY = g_tmpY1;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "extent")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc) && parseExtentToScratch(valLoc)) {
                g_transHasExtent = true;
                g_transX1 = g_extX1;
                g_transY1 = g_extY1;
                g_transX2 = g_extX2;
                g_transY2 = g_extY2;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "rotation")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc)) {
                let rot = parseNumberStrict(valLoc);
                if (!g_bailOut) {
                  g_transHasRotation = true;
                  g_transRotation = rot;
                }
              } else {
                g_bailOut = true;
              }
            } else {
              g_bailOut = true;
            }
          } else if (mode == MOD_MODE_ICON_TRANS_PROPS) {
            if (locMatches(nameLoc, "origin")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc) && parsePointPairIntoScratch(valLoc)) {
                g_iconTransHasOrigin = true;
                g_iconTransOriginX = g_tmpX1;
                g_iconTransOriginY = g_tmpY1;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "extent")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc) && parseExtentToScratch(valLoc)) {
                g_iconTransHasExtent = true;
                g_iconTransX1 = g_extX1;
                g_iconTransY1 = g_extY1;
                g_iconTransX2 = g_extX2;
                g_iconTransY2 = g_extY2;
              } else {
                g_bailOut = true;
              }
            } else if (locMatches(nameLoc, "rotation")) {
              let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
              if (!locIsNull(valLoc)) {
                let rot = parseNumberStrict(valLoc);
                if (!g_bailOut) {
                  g_iconTransHasRotation = true;
                  g_iconTransRotation = rot;
                }
              } else {
                g_bailOut = true;
              }
            } else {
              g_bailOut = true;
            }
          } else if (mode == MOD_MODE_FIND_CONNECT_LINE) {
            if (locMatches(nameLoc, "Line") || locMatches(nameLoc, "line")) {
              g_foundLineMod = ch;
              g_lineClauseCount++;
            }
          } else if (mode == MOD_MODE_CONNECT_LINE_PROPS) {
            let valLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
            let exprLoc = !locIsNull(valLoc) ? locFindDescendant(valLoc, SyntaxType.EXPRESSION) : 0;
            if (locIsNull(exprLoc)) exprLoc = valLoc;
            applyGraphicProp(nameLoc, exprLoc, 0);
          }
        }
      } else if (t == SyntaxType.ELEMENT_REDECLARATION || t == SyntaxType.ELEMENT_REPLACEABLE) {
        if (
          mode != MOD_MODE_FIND_ICON &&
          mode != MOD_MODE_FIND_PLACEMENT &&
          mode != MOD_MODE_FIND_CONNECT_LINE
        ) {
          g_bailOut = true;
        }
      } else {
        visitClassModArgs(ch, mode);
      }
    }
    ch = locNextSibling(ch);
  }
}

function findIconClauseInClass(loc: u64, isRoot: bool): void {
  if (locIsNull(loc) || g_bailOut) return;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch) && !g_bailOut) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.ANNOTATION_CLAUSE) {
        let classMod = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
        if (!locIsNull(classMod)) {
          visitClassModArgs(classMod, MOD_MODE_FIND_ICON);
        }
      } else if (
        t == SyntaxType.CLASS_DEFINITION ||
        t == SyntaxType.SHORT_CLASS_DEFINITION ||
        t == SyntaxType.COMPONENT_CLAUSE ||
        t == SyntaxType.COMPONENT_CLAUSE1 ||
        t == SyntaxType.SOME_EQUATION ||
        t == SyntaxType.STATEMENT ||
        t == SyntaxType.EXTENDS_CLAUSE ||
        t == SyntaxType.IMPORT_CLAUSE ||
        t == SyntaxType.EXTERNAL_CLAUSE
      ) {
        // Do not descend into nested classes, components, extends, equations, or statements
      } else {
        findIconClauseInClass(ch, false);
      }
    }
    ch = locNextSibling(ch);
  }
}

function findLeafAnnotationClause(loc: u64, findMode: i32): void {
  if (locIsNull(loc) || g_bailOut) return;
  if (locType(loc) == SyntaxType.ANNOTATION_CLAUSE) {
    let classMod = locFindDescendant(loc, SyntaxType.CLASS_MODIFICATION);
    if (!locIsNull(classMod)) {
      visitClassModArgs(classMod, findMode);
    }
    return;
  }
  let ch = locFirstChild(loc);
  while (!locIsNull(ch) && !g_bailOut) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.ANNOTATION_CLAUSE) {
        let classMod = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
        if (!locIsNull(classMod)) {
          visitClassModArgs(classMod, findMode);
        }
      } else if (
        t == SyntaxType.DECLARATION ||
        t == SyntaxType.CONDITION_ATTRIBUTE ||
        t == SyntaxType.CONNECT_EQUATION ||
        t == SyntaxType.IF_EQUATION ||
        t == SyntaxType.FOR_EQUATION ||
        t == SyntaxType.WHEN_EQUATION ||
        t == SyntaxType.SIMPLE_EQUATION
      ) {
        // Do not descend into declaration modifications or equation bodies
      } else {
        findLeafAnnotationClause(ch, findMode);
      }
    }
    ch = locNextSibling(ch);
  }
}

let g_topClassCount: i32 = 0;
let g_topClassLoc: u64 = 0;

function findTopClassDefs(loc: u64): void {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locLen(ch) > 0) {
      let t = locType(ch);
      if (t == SyntaxType.CLASS_DEFINITION) {
        g_topClassLoc = ch;
        g_topClassCount++;
      } else if (t == 0) {
        findTopClassDefs(ch);
      }
    }
    ch = locNextSibling(ch);
  }
}

function scanClassGraphicsLayer(classNodePtr: u32, startOffset: u32, isDiagram: bool): i32 {
  ensureAnnotationArena();
  g_graphicCount = 0;
  g_totalPoints = 0;
  g_coordX1 = -100.0;
  g_coordY1 = -100.0;
  g_coordX2 = 100.0;
  g_coordY2 = 100.0;
  g_preserveAspectRatio = true;
  g_hasCoordSys = false;
  g_hasIcon = false;
  g_bailOut = false;
  g_foundIconMod = 0;
  g_iconClauseCount = 0;
  g_scanTargetDiagram = isDiagram;

  if (classNodePtr == 0) return 0;

  let actualOffset = startOffset > 0 ? startOffset : getNodePadding(classNodePtr);
  let rootLoc = locMake(classNodePtr, actualOffset);
  if (locType(rootLoc) == SyntaxType.STORED_DEFINITION) {
    g_topClassCount = 0;
    g_topClassLoc = 0;
    findTopClassDefs(rootLoc);
    if (g_topClassCount == 1 && !locIsNull(g_topClassLoc)) {
      rootLoc = g_topClassLoc;
    } else if (g_topClassCount > 1) {
      g_bailOut = true;
      return -1;
    } else {
      return 0;
    }
  }

  findIconClauseInClass(rootLoc, true);

  if (g_iconClauseCount > 1) {
    g_bailOut = true;
    return -1;
  }

  if (locIsNull(g_foundIconMod)) return 0;
  g_hasIcon = true;

  let iconMod = locFindDescendant(g_foundIconMod, SyntaxType.CLASS_MODIFICATION);
  if (locIsNull(iconMod)) return 0;

  visitClassModArgs(iconMod, MOD_MODE_ICON_PROPS);
  if (g_bailOut) return -1;

  return g_graphicCount;
}

export function annotation_scanIcon(classNodePtr: u32, startOffset: u32): i32 {
  return scanClassGraphicsLayer(classNodePtr, startOffset, false);
}

export function annotation_scanDiagram(classNodePtr: u32, startOffset: u32): i32 {
  return scanClassGraphicsLayer(classNodePtr, startOffset, true);
}

export function annotation_scanPlacement(compNodePtr: u32, startOffset: u32): i32 {
  ensureAnnotationArena();
  g_bailOut = false;
  g_foundPlacementMod = 0;
  g_placementClauseCount = 0;
  g_hasPlacement = false;
  g_placementVisible = -1;
  g_placementIconVisible = -1;

  g_hasTrans = false;
  g_transHasOrigin = false;
  g_transHasExtent = false;
  g_transHasRotation = false;
  g_transOriginX = 0.0;
  g_transOriginY = 0.0;
  g_transX1 = 0.0;
  g_transY1 = 0.0;
  g_transX2 = 0.0;
  g_transY2 = 0.0;
  g_transRotation = 0.0;

  g_hasIconTrans = false;
  g_iconTransHasOrigin = false;
  g_iconTransHasExtent = false;
  g_iconTransHasRotation = false;
  g_iconTransOriginX = 0.0;
  g_iconTransOriginY = 0.0;
  g_iconTransX1 = 0.0;
  g_iconTransY1 = 0.0;
  g_iconTransX2 = 0.0;
  g_iconTransY2 = 0.0;
  g_iconTransRotation = 0.0;

  if (compNodePtr == 0) return 0;

  let actualOffset = startOffset > 0 ? startOffset : getNodePadding(compNodePtr);
  let rootLoc = locMake(compNodePtr, actualOffset);

  findLeafAnnotationClause(rootLoc, MOD_MODE_FIND_PLACEMENT);

  if (g_placementClauseCount > 1) {
    g_bailOut = true;
    return -1;
  }

  if (locIsNull(g_foundPlacementMod)) return 0;
  g_hasPlacement = true;

  let plMod = locFindDescendant(g_foundPlacementMod, SyntaxType.CLASS_MODIFICATION);
  if (locIsNull(plMod)) return 1;

  visitClassModArgs(plMod, MOD_MODE_PLACEMENT_PROPS);
  if (g_bailOut) return -1;

  return 1;
}

export function annotation_scanConnectLine(eqNodePtr: u32, startOffset: u32): i32 {
  ensureAnnotationArena();
  g_graphicCount = 0;
  g_totalPoints = 0;
  g_bailOut = false;
  g_foundLineMod = 0;
  g_lineClauseCount = 0;
  g_hasConnectLine = false;

  if (eqNodePtr == 0) return 0;

  let actualOffset = startOffset > 0 ? startOffset : getNodePadding(eqNodePtr);
  let rootLoc = locMake(eqNodePtr, actualOffset);

  findLeafAnnotationClause(rootLoc, MOD_MODE_FIND_CONNECT_LINE);

  if (g_lineClauseCount > 1) {
    g_bailOut = true;
    return -1;
  }

  if (locIsNull(g_foundLineMod)) return 0;
  g_hasConnectLine = true;

  initGraphicSlot(0, GRAPHIC_LINE);
  g_graphicCount = 1;

  let lineMod = locFindDescendant(g_foundLineMod, SyntaxType.CLASS_MODIFICATION);
  if (locIsNull(lineMod)) return 1;

  visitClassModArgs(lineMod, MOD_MODE_CONNECT_LINE_PROPS);
  if (g_bailOut) {
    g_graphicCount = 0;
    return -1;
  }

  return 1;
}

// ── In-WASM SVG Serializer ──────────────────────────────────────────────────

export function annotation_renderIconSvg(classNodePtr: u32, startOffset: u32, size: f32): u32 {
  let count = annotation_scanIcon(classNodePtr, startOffset);
  if (count <= 0) return 0;

  for (let i = 0; i < count; ++i) {
    let slot = getSlot(i);
    if (slot.kind == GRAPHIC_TEXT || slot.kind == GRAPHIC_BITMAP) return 0;
    if (slot.fillPattern != FILL_NONE && slot.fillPattern != FILL_SOLID) return 0;
    if (slot.smooth == SMOOTH_BEZIER) return 0;
  }

  ensureSvgBuffer();

  // Convert coordinate system extent via convertPoint: [x, -y]
  let cx1 = g_coordX1;
  let cy1 = -g_coordY1;
  let cx2 = g_coordX2;
  let cy2 = -g_coordY2;

  let vw = Math.abs(cx2 - cx1);
  let vh = Math.abs(cy2 - cy1);
  let vx = Math.min(cx1, cx2);
  let vy = Math.min(cy1, cy2);

  let padX = vw * 0.02;
  let padY = vh * 0.02;

  let targetSize = size > 0.0 ? (size as f64) : 16.0;
  let scale = Math.max(vw / targetSize, vh / targetSize);

  writeString('<svg xmlns="http://www.w3.org/2000/svg" width="');
  writeFloat(targetSize * 2.0, 2);
  writeString('" height="');
  writeFloat(targetSize * 2.0, 2);
  writeString('" viewBox="0 0 ');
  writeFloat(vw + padX * 2.0, 2);
  writeString(" ");
  writeFloat(vh + padY * 2.0, 2);
  writeString('" preserveAspectRatio="none" overflow="visible"><g transform="translate(');
  writeFloat(-vx + padX, 2);
  writeString(", ");
  writeFloat(-vy + padY, 2);
  writeString(')"><g>');

  for (let i = 0; i < count; ++i) {
    let slot = getSlot(i);
    let kind = slot.kind;
    let ox = slot.originX;
    let oy = -slot.originY;
    let rot = -slot.rotation;
    let vis = slot.visible != 0 ? "visible" : "hidden";

    writeString('<g visibility="');
    writeString(vis);
    writeString('" transform="translate(');
    writeFloat(ox, 2);
    writeString(", ");
    writeFloat(oy, 2);
    writeString(") rotate(");
    writeFloat(rot, 2);
    writeString(')">');

    let strokeW = slot.thickness * 2.0 * scale;
    if (strokeW < 1.0) strokeW = 1.0;

    let hasStroke = slot.linePattern != LINE_NONE;
    let dashArray = "none";
    if (slot.linePattern == LINE_DASH) dashArray = "4, 2";
    else if (slot.linePattern == LINE_DOT) dashArray = "1, 2";
    else if (slot.linePattern == LINE_DASHDOT) dashArray = "4, 2, 1, 2";
    else if (slot.linePattern == LINE_DASHDOTDOT) dashArray = "4, 2, 1, 2, 1, 2";

    let isSolidFill = slot.fillPattern == FILL_SOLID;
    let fillColorPacked = slot.fillColor >= 0 ? slot.fillColor : slot.strokeColor;

    if (kind == GRAPHIC_RECTANGLE) {
      let x1 = slot.x1;
      let y1 = -slot.y1;
      let x2 = slot.x2;
      let y2 = -slot.y2;
      let rx = Math.min(x1, x2);
      let ry = Math.min(y1, y2);
      let rw = Math.abs(x2 - x1);
      let rh = Math.abs(y2 - y1);
      let radius = slot.radius;

      writeString('<path d="');
      if (radius > 0.0) {
        let r = Math.min(radius, Math.min(rw / 2.0, rh / 2.0));
        writeString("M ");
        writeFloat(rx + r, 2);
        writeString(" ");
        writeFloat(ry, 2);
        writeString(" H ");
        writeFloat(rx + rw - r, 2);
        writeString(" A ");
        writeFloat(r, 2);
        writeString(" ");
        writeFloat(r, 2);
        writeString(" 0 0 1 ");
        writeFloat(rx + rw, 2);
        writeString(" ");
        writeFloat(ry + r, 2);
        writeString(" V ");
        writeFloat(ry + rh - r, 2);
        writeString(" A ");
        writeFloat(r, 2);
        writeString(" ");
        writeFloat(r, 2);
        writeString(" 0 0 1 ");
        writeFloat(rx + rw - r, 2);
        writeString(" ");
        writeFloat(ry + rh, 2);
        writeString(" H ");
        writeFloat(rx + r, 2);
        writeString(" A ");
        writeFloat(r, 2);
        writeString(" ");
        writeFloat(r, 2);
        writeString(" 0 0 1 ");
        writeFloat(rx, 2);
        writeString(" ");
        writeFloat(ry + rh - r, 2);
        writeString(" V ");
        writeFloat(ry + r, 2);
        writeString(" A ");
        writeFloat(r, 2);
        writeString(" ");
        writeFloat(r, 2);
        writeString(" 0 0 1 ");
        writeFloat(rx + r, 2);
        writeString(" ");
        writeFloat(ry, 2);
        writeString(" Z");
      } else {
        writeString("M ");
        writeFloat(rx, 2);
        writeString(" ");
        writeFloat(ry, 2);
        writeString(" H ");
        writeFloat(rx + rw, 2);
        writeString(" V ");
        writeFloat(ry + rh, 2);
        writeString(" H ");
        writeFloat(rx, 2);
        writeString(" Z");
      }
      writeString('" fill="');
      if (isSolidFill) writeColorRgb(fillColorPacked, "rgb(0,0,0)");
      else writeString("none");
      writeString('" stroke="');
      if (hasStroke) writeColorRgb(slot.strokeColor, "rgb(0,0,0)");
      else writeString("none");
      if (hasStroke) {
        writeString('" stroke-width="');
        writeFloat(strokeW, 2);
        if (dashArray != "none") {
          writeString('" stroke-dasharray="');
          writeString(dashArray);
        }
      }
      writeString('"/>');
    } else if (kind == GRAPHIC_LINE) {
      let offset = slot.pointsOffset;
      let ptCount = slot.pointsCount;
      if (ptCount == 2) {
        writeString('<line x1="');
        writeFloat(getPointX(offset), 2);
        writeString('" y1="');
        writeFloat(-getPointY(offset), 2);
        writeString('" x2="');
        writeFloat(getPointX(offset + 1), 2);
        writeString('" y2="');
        writeFloat(-getPointY(offset + 1), 2);
        writeString('" fill="none" stroke="');
        if (hasStroke) writeColorRgb(slot.strokeColor, "rgb(0,0,0)");
        else writeString("none");
        if (hasStroke) {
          writeString('" stroke-width="');
          writeFloat(strokeW, 2);
          if (dashArray != "none") {
            writeString('" stroke-dasharray="');
            writeString(dashArray);
          }
        }
        writeString('"/>');
      } else if (ptCount > 2) {
        writeString('<polyline points="');
        for (let p = 0; p < ptCount; ++p) {
          if (p > 0) writeString(" ");
          writeFloat(getPointX(offset + p), 2);
          writeString(",");
          writeFloat(-getPointY(offset + p), 2);
        }
        writeString('" fill="none" stroke="');
        if (hasStroke) writeColorRgb(slot.strokeColor, "rgb(0,0,0)");
        else writeString("none");
        if (hasStroke) {
          writeString('" stroke-width="');
          writeFloat(strokeW, 2);
          if (dashArray != "none") {
            writeString('" stroke-dasharray="');
            writeString(dashArray);
          }
        }
        writeString('"/>');
      }
    } else if (kind == GRAPHIC_POLYGON) {
      let offset = slot.pointsOffset;
      let ptCount = slot.pointsCount;
      if (ptCount >= 3) {
        writeString('<polygon points="');
        for (let p = 0; p < ptCount; ++p) {
          if (p > 0) writeString(" ");
          writeFloat(getPointX(offset + p), 2);
          writeString(",");
          writeFloat(-getPointY(offset + p), 2);
        }
        writeString('" fill="');
        if (isSolidFill) writeColorRgb(fillColorPacked, "rgb(0,0,0)");
        else writeString("none");
        writeString('" stroke="');
        if (hasStroke) writeColorRgb(slot.strokeColor, "rgb(0,0,0)");
        else writeString("none");
        if (hasStroke) {
          writeString('" stroke-width="');
          writeFloat(strokeW, 2);
          if (dashArray != "none") {
            writeString('" stroke-dasharray="');
            writeString(dashArray);
          }
        }
        writeString('"/>');
      }
    } else if (kind == GRAPHIC_ELLIPSE) {
      let x1 = slot.x1;
      let y1 = -slot.y1;
      let x2 = slot.x2;
      let y2 = -slot.y2;
      let ew = Math.abs(x2 - x1);
      let eh = Math.abs(y2 - y1);
      let rx = ew / 2.0;
      let ry = eh / 2.0;
      let cx = Math.min(x1, x2) + rx;
      let cy = Math.min(y1, y2) + ry;

      writeString('<ellipse cx="');
      writeFloat(cx, 2);
      writeString('" cy="');
      writeFloat(cy, 2);
      writeString('" rx="');
      writeFloat(rx, 2);
      writeString('" ry="');
      writeFloat(ry, 2);
      writeString('" fill="');
      if (isSolidFill) writeColorRgb(fillColorPacked, "rgb(0,0,0)");
      else writeString("none");
      writeString('" stroke="');
      if (hasStroke) writeColorRgb(slot.strokeColor, "rgb(0,0,0)");
      else writeString("none");
      if (hasStroke) {
        writeString('" stroke-width="');
        writeFloat(strokeW, 2);
        if (dashArray != "none") {
          writeString('" stroke-dasharray="');
          writeString(dashArray);
        }
      }
      writeString('"/>');
    }

    writeString("</g>");
  }

  writeString("</g></g></svg>");
  writeByte(0);

  return g_svgLen - 1;
}

// ── Public Boundary Exports ──────────────────────────────────────────────────

export function annotation_getSvgBufferPtr(): usize {
  return g_svgBuffer;
}

export function annotation_hasIcon(): u8 {
  return g_hasIcon ? 1 : 0;
}

export function annotation_hasCoordSys(): u8 {
  return g_hasCoordSys ? 1 : 0;
}

export function annotation_getPreserveAspectRatio(): u8 {
  return g_preserveAspectRatio ? 1 : 0;
}

export function annotation_getGraphicCount(): i32 {
  return g_graphicCount;
}

export function annotation_getCoordX1(): f64 { return g_coordX1; }
export function annotation_getCoordY1(): f64 { return g_coordY1; }
export function annotation_getCoordX2(): f64 { return g_coordX2; }
export function annotation_getCoordY2(): f64 { return g_coordY2; }

export function annotation_getGraphicKind(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).kind;
  return GRAPHIC_NONE;
}

export function annotation_getGraphicStroke(index: i32): i32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).strokeColor;
  return -1;
}

export function annotation_getGraphicFill(index: i32): i32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).fillColor;
  return -1;
}

export function annotation_getGraphicFillPattern(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).fillPattern;
  return FILL_NONE;
}

export function annotation_getGraphicLinePattern(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).linePattern;
  return LINE_SOLID;
}

export function annotation_getGraphicThickness(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).thickness;
  return 0.25;
}

export function annotation_getGraphicRadius(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).radius;
  return 0.0;
}

export function annotation_getGraphicSmooth(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).smooth;
  return SMOOTH_NONE;
}

export function annotation_getGraphicVisible(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).visible;
  return 1;
}

export function annotation_getGraphicRectX1(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).x1;
  return 0.0;
}

export function annotation_getGraphicRectY1(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).y1;
  return 0.0;
}

export function annotation_getGraphicRectX2(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).x2;
  return 0.0;
}

export function annotation_getGraphicRectY2(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).y2;
  return 0.0;
}

export function annotation_getGraphicOriginX(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).originX;
  return 0.0;
}

export function annotation_getGraphicOriginY(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).originY;
  return 0.0;
}

export function annotation_getGraphicRotation(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).rotation;
  return 0.0;
}

export function annotation_getGraphicPointsOffset(index: i32): i32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).pointsOffset;
  return 0;
}

export function annotation_getGraphicPointsCount(index: i32): i32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).pointsCount;
  return 0;
}

export function annotation_getPointX(ptIndex: i32): f64 {
  if (ptIndex >= 0 && ptIndex < g_totalPoints) return getPointX(ptIndex);
  return 0.0;
}

export function annotation_getPointY(ptIndex: i32): f64 {
  if (ptIndex >= 0 && ptIndex < g_totalPoints) return getPointY(ptIndex);
  return 0.0;
}

export function annotation_getGraphicTextOffset(index: i32): u32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).textOffset;
  return 0;
}

export function annotation_getGraphicTextLen(index: i32): u32 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).textLen;
  return 0;
}

export function annotation_getGraphicFontSize(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).fontSize;
  return 0.0;
}

export function annotation_getGraphicTextAlignment(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).textAlignment;
  return ALIGN_CENTER;
}

export function annotation_getGraphicArrowStart(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).arrowStart;
  return ARROW_NONE;
}

export function annotation_getGraphicArrowEnd(index: i32): u8 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).arrowEnd;
  return ARROW_NONE;
}

export function annotation_getGraphicArrowSize(index: i32): f64 {
  if (index >= 0 && index < g_graphicCount) return getSlot(index).arrowSize;
  return 0.0;
}

export function annotation_getPlacementVisible(): i32 { return g_placementVisible as i32; }
export function annotation_getPlacementIconVisible(): i32 { return g_placementIconVisible as i32; }

export function annotation_hasTransformation(): u8 { return g_hasTrans ? 1 : 0; }
export function annotation_transHasOrigin(): u8 { return g_transHasOrigin ? 1 : 0; }
export function annotation_transHasExtent(): u8 { return g_transHasExtent ? 1 : 0; }
export function annotation_transHasRotation(): u8 { return g_transHasRotation ? 1 : 0; }
export function annotation_getTransOriginX(): f64 { return g_transOriginX; }
export function annotation_getTransOriginY(): f64 { return g_transOriginY; }
export function annotation_getTransX1(): f64 { return g_transX1; }
export function annotation_getTransY1(): f64 { return g_transY1; }
export function annotation_getTransX2(): f64 { return g_transX2; }
export function annotation_getTransY2(): f64 { return g_transY2; }
export function annotation_getTransRotation(): f64 { return g_transRotation; }

export function annotation_hasIconTransformation(): u8 { return g_hasIconTrans ? 1 : 0; }
export function annotation_iconTransHasOrigin(): u8 { return g_iconTransHasOrigin ? 1 : 0; }
export function annotation_iconTransHasExtent(): u8 { return g_iconTransHasExtent ? 1 : 0; }
export function annotation_iconTransHasRotation(): u8 { return g_iconTransHasRotation ? 1 : 0; }
export function annotation_getIconTransOriginX(): f64 { return g_iconTransOriginX; }
export function annotation_getIconTransOriginY(): f64 { return g_iconTransOriginY; }
export function annotation_getIconTransX1(): f64 { return g_iconTransX1; }
export function annotation_getIconTransY1(): f64 { return g_iconTransY1; }
export function annotation_getIconTransX2(): f64 { return g_iconTransX2; }
export function annotation_getIconTransY2(): f64 { return g_iconTransY2; }
export function annotation_getIconTransRotation(): f64 { return g_iconTransRotation; }

