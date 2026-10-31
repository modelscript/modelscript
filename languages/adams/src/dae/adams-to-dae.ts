// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Direct Linear-Memory DAE Arena Lowering for MSC Adams Models.
 *
 * Emits 6-DOF descriptor differential-algebraic equations directly into ModelScript's
 * WebAssembly Struct-of-Arrays DAEBuilder without intermediate AST wrappers:
 *   1. 6-DOF translational (x,y,z,vx,vy,vz) and rotational (phi,theta,psi,wx,wy,wz) states
 *   2. 3D marker offset lever arms: r_P = r_B + s_P + theta_B x s_P, v_P = v_B + omega_B x s_P
 *   3. Constitutive spring-damper (SPRINGDAMPER), bushing, and FUNCTION-driven (SFORCE/VFORCE/GFORCE) forces
 *   4. Adams FUNCTION= expression compiler (TIME, STEP, SHF, POLY, DX/DY/DZ/DM, VX/VY/VZ, SIN/COS, degree 'D')
 *   5. Exact Newton-Euler momentum balance with applied moment arms and joint reaction multipliers:
 *        m * der(v) = sum(F) + F_gravity + F_constraint
 *        I * der(omega) = sum(s x F) + sum(Tau) + Tau_constraint
 *   6. Translational + rotational kinematic joint constraints (SPHERICAL, REVOLUTE, UNIVERSAL,
 *      CYLINDRICAL, TRANSLATIONAL, PLANAR, FIXED, SCREW) in both Baumgarte and Lagrange multiplier modes.
 */

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import type { AdamsDataset, AdamsJoint, AdamsMarker, Vector3D } from "../types.js";

export interface AdamsDaeOptions {
  /** Constraint stabilization method: "baumgarte" | "algebraic". Default: "baumgarte". */
  stabilization?: "baumgarte" | "algebraic" | undefined;
  /** Baumgarte natural frequency omega_n in rad/s. Default: 50.0. */
  baumgarteOmega?: number | undefined;
  /** Baumgarte alpha parameter (optional alias). */
  baumgarteAlpha?: number | undefined;
  /** Baumgarte beta parameter (optional alias). */
  baumgarteBeta?: number | undefined;
  /** Gravitational acceleration in m/s^2. Default: 9.80665 along -Z. */
  gravity?: number | undefined;
}

export interface JointConstraintSpec {
  transAxes: ("x" | "y" | "z")[];
  rotAxes: ("phi" | "theta" | "psi")[];
}

/**
 * Returns the constrained translational and rotational axes for each canonical Adams joint type.
 */
export function getJointConstraintSpec(joint: AdamsJoint): JointConstraintSpec {
  switch (joint.type) {
    case "SPHERICAL":
      // 3 translational constraints (3 DOF remaining)
      return { transAxes: ["x", "y", "z"], rotAxes: [] };
    case "UNIVERSAL":
      // 3 translational + 1 rotational constraint (2 DOF remaining)
      return { transAxes: ["x", "y", "z"], rotAxes: ["psi"] };
    case "REVOLUTE":
      // 3 translational + 2 rotational constraints (1 rotational DOF about Z remaining)
      return { transAxes: ["x", "y", "z"], rotAxes: ["phi", "theta"] };
    case "CYLINDRICAL":
      // 2 translational (perp to Z) + 2 rotational constraints (2 DOF: Z trans + Z rot remaining)
      return { transAxes: ["x", "y"], rotAxes: ["phi", "theta"] };
    case "TRANSLATIONAL":
      // 2 translational (perp to Z) + 3 rotational constraints (1 translational DOF along Z remaining)
      return { transAxes: ["x", "y"], rotAxes: ["phi", "theta", "psi"] };
    case "PLANAR":
      // 1 translational (along Z) + 2 rotational constraints (3 planar DOF remaining)
      return { transAxes: ["z"], rotAxes: ["phi", "theta"] };
    case "FIXED":
      // 3 translational + 3 rotational constraints (0 DOF remaining)
      return { transAxes: ["x", "y", "z"], rotAxes: ["phi", "theta", "psi"] };
    case "SCREW":
      // 2 translational + 2 rotational + 1 helical coupling (represented as 5 constraints)
      return { transAxes: ["x", "y", "z"], rotAxes: ["phi", "theta"] };
    default:
      return { transAxes: ["x", "y", "z"], rotAxes: [] };
  }
}

interface MarkerKinematicsHelpers {
  isPartGround: (pId: string | number) => boolean;
  markerPosExpr: (marker: AdamsMarker, axis: "x" | "y" | "z") => number;
  markerVelExpr: (marker: AdamsMarker, axis: "x" | "y" | "z") => number;
  markerAngleExpr: (marker: AdamsMarker, axis: "phi" | "theta" | "psi") => number;
  markerOmegaExpr: (marker: AdamsMarker, axis: "wx" | "wy" | "wz") => number;
}

function createMarkerKinematicsHelpers(dae: DAEBuilder, dataset: AdamsDataset): MarkerKinematicsHelpers {
  const isPartGround = (pId: string | number): boolean => {
    const part = dataset.parts.get(pId);
    return !part || part.isGround || String(pId).toUpperCase() === "GROUND";
  };

  /**
   * 3D marker global position with rotational lever arm:
   *   r_P = r_B + s_P + theta_B x s_P
   * where theta_B = (phi, theta, psi):
   *   x_P = x_B + s_x + (theta * s_z - psi * s_y)
   *   y_P = y_B + s_y + (psi * s_x - phi * s_z)
   *   z_P = z_B + s_z + (phi * s_y - theta * s_x)
   */
  const markerPosExpr = (marker: AdamsMarker, axis: "x" | "y" | "z"): number => {
    const bId = String(marker.partId);
    const s = marker.position;
    if (isPartGround(marker.partId)) {
      return dae.addRealLiteral(s[axis]);
    }
    let expr =
      s[axis] === 0
        ? dae.addNameExpr(`${bId}.${axis}`)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bId}.${axis}`), dae.addRealLiteral(s[axis]));

    // Add 3D rotational lever arm terms (theta_B x s_P) when marker offset is non-zero
    if (axis === "x") {
      if (s.z !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.theta`), dae.addRealLiteral(s.z));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.y !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.psi`), dae.addRealLiteral(s.y));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    } else if (axis === "y") {
      if (s.x !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.psi`), dae.addRealLiteral(s.x));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.z !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.phi`), dae.addRealLiteral(s.z));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    } else {
      if (s.y !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.phi`), dae.addRealLiteral(s.y));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.x !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.theta`), dae.addRealLiteral(s.x));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    }
    return expr;
  };

  /**
   * 3D marker global velocity with angular velocity lever arm:
   *   v_P = v_B + omega_B x s_P
   */
  const markerVelExpr = (marker: AdamsMarker, axis: "x" | "y" | "z"): number => {
    const bId = String(marker.partId);
    const s = marker.position;
    if (isPartGround(marker.partId)) {
      return dae.addRealLiteral(0.0);
    }
    let expr = dae.addNameExpr(`${bId}.v${axis}`);
    if (axis === "x") {
      if (s.z !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.z));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.y !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.y));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    } else if (axis === "y") {
      if (s.x !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.x));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.z !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.z));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    } else {
      if (s.y !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.y));
        expr = dae.addBinaryExpr(BinOp.Add, expr, term);
      }
      if (s.x !== 0) {
        const term = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.x));
        expr = dae.addBinaryExpr(BinOp.Sub, expr, term);
      }
    }
    return expr;
  };

  const markerAngleExpr = (marker: AdamsMarker, axis: "phi" | "theta" | "psi"): number => {
    const bId = String(marker.partId);
    const orientOffset =
      axis === "phi" ? marker.orientation.x : axis === "theta" ? marker.orientation.y : marker.orientation.z;
    if (isPartGround(marker.partId)) {
      return dae.addRealLiteral(orientOffset);
    }
    return orientOffset === 0
      ? dae.addNameExpr(`${bId}.${axis}`)
      : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bId}.${axis}`), dae.addRealLiteral(orientOffset));
  };

  const markerOmegaExpr = (marker: AdamsMarker, axis: "wx" | "wy" | "wz"): number => {
    const bId = String(marker.partId);
    if (isPartGround(marker.partId)) {
      return dae.addRealLiteral(0.0);
    }
    return dae.addNameExpr(`${bId}.${axis}`);
  };

  return {
    isPartGround,
    markerPosExpr,
    markerVelExpr,
    markerAngleExpr,
    markerOmegaExpr,
  };
}

// ============================================================================
// Adams FUNCTION= Expression Parser & DAE Arena Compiler
// ============================================================================

type Token =
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

function tokenizeAdamsExpr(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    if (!ch) {
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      tokens.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    // Number literal (with optional scientific notation E/e and Adams degree suffix D/d)
    const nextChar = src[i + 1];
    if (/[0-9]/.test(ch) || (ch === "." && nextChar && /[0-9]/.test(nextChar))) {
      let numStr = "";
      while (i < n) {
        const c = src[i];
        if (!c || !/[0-9.]/.test(c)) break;
        numStr += c;
        i++;
      }
      if (i < n && (src[i] === "e" || src[i] === "E")) {
        numStr += src[i] ?? "";
        i++;
        if (i < n && (src[i] === "+" || src[i] === "-")) {
          numStr += src[i] ?? "";
          i++;
        }
        while (i < n) {
          const c = src[i];
          if (!c || !/[0-9]/.test(c)) break;
          numStr += c;
          i++;
        }
      }
      let val = Number.parseFloat(numStr);
      if (!Number.isFinite(val)) val = 0.0;
      // Check for Adams degree suffix 'D' or 'd'
      const afterD = src[i + 1];
      if (i < n && (src[i] === "D" || src[i] === "d") && (!afterD || !/[A-Za-z0-9_]/.test(afterD))) {
        val = (val * Math.PI) / 180.0;
        i++;
      }
      tokens.push({ kind: "number", value: val });
      continue;
    }
    // Identifier
    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < n) {
        const c = src[i];
        if (!c || !/[A-Za-z0-9_.]/.test(c)) break;
        id += c;
        i++;
      }
      tokens.push({ kind: "ident", value: id.toUpperCase() });
      continue;
    }
    // Skip unrecognized character
    i++;
  }
  return tokens;
}

/**
 * Compiles an Adams `FUNCTION = ...` string directly into `DAEBuilder` expression arena nodes.
 *
 * Supported functions and intrinsics:
 * - `TIME` -> `time`
 * - `STEP(x, x0, h0, x1, h1)` -> smooth cubic step `h0 + (h1 - h0) * u^2 * (3 - 2*u)` where `u = max(0, min(1, (x - x0)/(x1 - x0)))`
 * - `SHF(x, x0, a, w, phi, b)` -> simple harmonic `a * sin(w * (x - x0) - phi) + b`
 * - `POLY(x, x0, a0, a1, a2, ...)` -> polynomial `a0 + a1*(x - x0) + a2*(x - x0)^2 + ...`
 * - `DX(i[, j])`, `DY(i[, j])`, `DZ(i[, j])`, `DM(i[, j])` -> marker relative displacements
 * - `VX(i[, j])`, `VY(i[, j])`, `VZ(i[, j])`, `VM(i[, j])` -> marker relative velocities
 * - `PHI(i[, j])`, `THETA(i[, j])`, `PSI(i[, j])`, `WX(i[, j])`, `WY(i[, j])`, `WZ(i[, j])`
 * - Standard math calls: `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN`, `EXP`, `LOG`, `SQRT`, `ABS`
 */
export function compileAdamsFunctionToDae(exprStr: string, dae: DAEBuilder, dataset: AdamsDataset): number {
  const trimmed = exprStr.trim();
  if (!trimmed) return dae.addRealLiteral(0.0);

  const tokens = tokenizeAdamsExpr(trimmed);
  if (tokens.length === 0) return dae.addRealLiteral(0.0);

  const helpers = createMarkerKinematicsHelpers(dae, dataset);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  const resolveMarker = (idToken: number | string): AdamsMarker | undefined => {
    const direct = dataset.markers.get(idToken);
    if (direct) return direct;
    const asNum = typeof idToken === "string" ? Number(idToken) : idToken;
    if (!Number.isNaN(asNum)) {
      const byNum = dataset.markers.get(asNum);
      if (byNum) return byNum;
    }
    return dataset.markers.get(String(idToken));
  };

  const parseRawArgToken = (): string | number => {
    const tok = peek();
    if (!tok) return 0;
    if (tok.kind === "number") {
      consume();
      return Math.trunc(tok.value);
    }
    if (tok.kind === "ident") {
      consume();
      return tok.value;
    }
    return 0;
  };

  const parseExpr = (): number => parseAddSub();

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (pos < tokens.length) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
        consume();
        const right = parseMulDiv();
        left = dae.addBinaryExpr(tok.value === "+" ? BinOp.Add : BinOp.Sub, left, right);
      } else {
        break;
      }
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePow();
    while (pos < tokens.length) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
        consume();
        const right = parsePow();
        left = dae.addBinaryExpr(tok.value === "*" ? BinOp.Mul : BinOp.Div, left, right);
      } else {
        break;
      }
    }
    return left;
  };

  const parsePow = (): number => {
    let left = parseUnary();
    const tok = peek();
    if (tok && tok.kind === "op" && tok.value === "^") {
      consume();
      const right = parsePow();
      left = dae.addBinaryExpr(BinOp.Pow, left, right);
    }
    return left;
  };

  const parseUnary = (): number => {
    const tok = peek();
    if (tok && tok.kind === "op" && tok.value === "+") {
      consume();
      return parseUnary();
    }
    if (tok && tok.kind === "op" && tok.value === "-") {
      consume();
      const operand = parseUnary();
      return dae.addUnaryExpr(UnaryOp.Negate, operand);
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) return dae.addRealLiteral(0.0);

    if (tok.kind === "number") {
      consume();
      return dae.addRealLiteral(tok.value);
    }

    if (tok.kind === "lparen") {
      consume();
      const inner = parseExpr();
      if (peek()?.kind === "rparen") consume();
      return inner;
    }

    if (tok.kind === "ident") {
      consume();
      const name = tok.value;

      if (name === "TIME" || name === "T") {
        return dae.addNameExpr("time");
      }
      if (name === "PI") {
        return dae.addRealLiteral(Math.PI);
      }
      if (name === "DTOR") {
        return dae.addRealLiteral(Math.PI / 180.0);
      }
      if (name === "RTOD") {
        return dae.addRealLiteral(180.0 / Math.PI);
      }

      // Check for function call
      if (peek()?.kind === "lparen") {
        // Kinematic marker inquiry functions: DX, DY, DZ, DM, VX, VY, VZ, VM, PHI, THETA, PSI, WX, WY, WZ
        const KIN_FUNCS = new Set([
          "DX",
          "DY",
          "DZ",
          "DM",
          "VX",
          "VY",
          "VZ",
          "VM",
          "PHI",
          "THETA",
          "PSI",
          "WX",
          "WY",
          "WZ",
        ]);
        if (KIN_FUNCS.has(name)) {
          consume(); // '('
          const idI = parseRawArgToken();
          let idJ: string | number | undefined;
          if (peek()?.kind === "comma") {
            consume();
            idJ = parseRawArgToken();
          }
          // Skip optional 3rd reference marker argument if present
          while (peek() && peek()?.kind !== "rparen") {
            consume();
          }
          if (peek()?.kind === "rparen") consume();

          const mI = resolveMarker(idI);
          const mJ = idJ !== undefined ? resolveMarker(idJ) : undefined;

          const getDisp = (axis: "x" | "y" | "z"): number => {
            const pI = mI ? helpers.markerPosExpr(mI, axis) : dae.addRealLiteral(0.0);
            const pJ = mJ ? helpers.markerPosExpr(mJ, axis) : dae.addRealLiteral(0.0);
            return mJ ? dae.addBinaryExpr(BinOp.Sub, pI, pJ) : pI;
          };

          const getVel = (axis: "x" | "y" | "z"): number => {
            const vI = mI ? helpers.markerVelExpr(mI, axis) : dae.addRealLiteral(0.0);
            const vJ = mJ ? helpers.markerVelExpr(mJ, axis) : dae.addRealLiteral(0.0);
            return mJ ? dae.addBinaryExpr(BinOp.Sub, vI, vJ) : vI;
          };

          if (name === "DX") return getDisp("x");
          if (name === "DY") return getDisp("y");
          if (name === "DZ") return getDisp("z");
          if (name === "DM") {
            const dx = getDisp("x");
            const dy = getDisp("y");
            const dz = getDisp("z");
            const sumSq = dae.addBinaryExpr(
              BinOp.Add,
              dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Mul, dx, dx), dae.addBinaryExpr(BinOp.Mul, dy, dy)),
              dae.addBinaryExpr(BinOp.Mul, dz, dz),
            );
            return dae.addCallExpr("sqrt", [sumSq]);
          }
          if (name === "VX") return getVel("x");
          if (name === "VY") return getVel("y");
          if (name === "VZ") return getVel("z");
          if (name === "VM") {
            const vx = getVel("x");
            const vy = getVel("y");
            const vz = getVel("z");
            const sumSq = dae.addBinaryExpr(
              BinOp.Add,
              dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Mul, vx, vx), dae.addBinaryExpr(BinOp.Mul, vy, vy)),
              dae.addBinaryExpr(BinOp.Mul, vz, vz),
            );
            return dae.addCallExpr("sqrt", [sumSq]);
          }
          if (name === "PHI" || name === "THETA" || name === "PSI") {
            const axis = name.toLowerCase() as "phi" | "theta" | "psi";
            const aI = mI ? helpers.markerAngleExpr(mI, axis) : dae.addRealLiteral(0.0);
            const aJ = mJ ? helpers.markerAngleExpr(mJ, axis) : dae.addRealLiteral(0.0);
            return mJ ? dae.addBinaryExpr(BinOp.Sub, aI, aJ) : aI;
          }
          if (name === "WX" || name === "WY" || name === "WZ") {
            const axis = name.toLowerCase() as "wx" | "wy" | "wz";
            const wI = mI ? helpers.markerOmegaExpr(mI, axis) : dae.addRealLiteral(0.0);
            const wJ = mJ ? helpers.markerOmegaExpr(mJ, axis) : dae.addRealLiteral(0.0);
            return mJ ? dae.addBinaryExpr(BinOp.Sub, wI, wJ) : wI;
          }
        }

        // General expression arguments
        consume(); // '('
        const args: number[] = [];
        if (peek()?.kind !== "rparen") {
          args.push(parseExpr());
          while (peek()?.kind === "comma") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek()?.kind === "rparen") consume();

        // STEP(x, x0, h0, x1, h1) -> h0 + (h1 - h0) * u^2 * (3 - 2*u), u = max(0, min(1, (x - x0)/(x1 - x0)))
        if ((name === "STEP" || name === "STEP5") && args.length >= 5) {
          const [x, x0, h0, x1, h1] = args as [number, number, number, number, number];
          const num = dae.addBinaryExpr(BinOp.Sub, x, x0);
          const den = dae.addBinaryExpr(BinOp.Sub, x1, x0);
          const ratio = dae.addBinaryExpr(BinOp.Div, num, den);
          const clamped1 = dae.addCallExpr("min", [dae.addRealLiteral(1.0), ratio]);
          const u = dae.addCallExpr("max", [dae.addRealLiteral(0.0), clamped1]);
          const u2 = dae.addBinaryExpr(BinOp.Mul, u, u);
          const threeMinus2u = dae.addBinaryExpr(
            BinOp.Sub,
            dae.addRealLiteral(3.0),
            dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), u),
          );
          const smooth = dae.addBinaryExpr(BinOp.Mul, u2, threeMinus2u);
          const dh = dae.addBinaryExpr(BinOp.Sub, h1, h0);
          return dae.addBinaryExpr(BinOp.Add, h0, dae.addBinaryExpr(BinOp.Mul, dh, smooth));
        }

        // SHF(x, x0, a, w, phi, b) -> a * sin(w * (x - x0) - phi) + b
        if (name === "SHF" && args.length >= 6) {
          const [x, x0, a, w, phi, b] = args as [number, number, number, number, number, number];
          const dx = dae.addBinaryExpr(BinOp.Sub, x, x0);
          const wDx = dae.addBinaryExpr(BinOp.Mul, w, dx);
          const phase = dae.addBinaryExpr(BinOp.Sub, wDx, phi);
          const sinTerm = dae.addCallExpr("sin", [phase]);
          const scaled = dae.addBinaryExpr(BinOp.Mul, a, sinTerm);
          return dae.addBinaryExpr(BinOp.Add, scaled, b);
        }

        // POLY(x, x0, a0, a1, a2, ...) -> a0 + a1*(x - x0) + a2*(x - x0)^2 + ...
        if (name === "POLY" && args.length >= 3) {
          const x = args[0] ?? 0;
          const x0 = args[1] ?? 0;
          const dx = dae.addBinaryExpr(BinOp.Sub, x, x0);
          let sum = args[2] ?? 0;
          let dxPow = dx;
          for (let k = 3; k < args.length; k++) {
            const ak = args[k] ?? 0;
            const term = dae.addBinaryExpr(BinOp.Mul, ak, dxPow);
            sum = dae.addBinaryExpr(BinOp.Add, sum, term);
            if (k + 1 < args.length) {
              dxPow = dae.addBinaryExpr(BinOp.Mul, dxPow, dx);
            }
          }
          return sum;
        }

        const lowerFunc = name.toLowerCase();
        return dae.addCallExpr(lowerFunc, args);
      }

      return dae.addNameExpr(name.toLowerCase());
    }

    consume();
    return dae.addRealLiteral(0.0);
  };

  return parseExpr();
}

/**
 * Numerically evaluates an Adams `FUNCTION = ...` string at a given time and marker state.
 */
export function evaluateAdamsFunction(
  exprStr: string,
  context?: {
    time?: number | undefined;
    markerPositions?: Map<string | number, Vector3D> | undefined;
    markerVelocities?: Map<string | number, Vector3D> | undefined;
  },
): number {
  const tokens = tokenizeAdamsExpr(exprStr.trim());
  if (tokens.length === 0) return 0.0;
  const timeVal = context?.time ?? 0.0;
  const mPos = context?.markerPositions ?? new Map<string | number, Vector3D>();
  const mVel = context?.markerVelocities ?? new Map<string | number, Vector3D>();

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  const getMarkerVec = (map: Map<string | number, Vector3D>, id: number | string): Vector3D => {
    return map.get(id) ?? map.get(Number(id)) ?? map.get(String(id)) ?? { x: 0, y: 0, z: 0 };
  };

  const parseExpr = (): number => {
    let left = parseMulDiv();
    while (pos < tokens.length) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
        consume();
        const right = parseMulDiv();
        left = tok.value === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePow();
    while (pos < tokens.length) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
        consume();
        const right = parsePow();
        left = tok.value === "*" ? left * right : right !== 0 ? left / right : 0;
      } else {
        break;
      }
    }
    return left;
  };

  const parsePow = (): number => {
    let left = parseUnary();
    const tok = peek();
    if (tok && tok.kind === "op" && tok.value === "^") {
      consume();
      const right = parsePow();
      left = Math.pow(left, right);
    }
    return left;
  };

  const parseUnary = (): number => {
    const tok = peek();
    if (tok && tok.kind === "op" && tok.value === "+") {
      consume();
      return parseUnary();
    }
    if (tok && tok.kind === "op" && tok.value === "-") {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) return 0.0;
    if (tok.kind === "number") {
      consume();
      return tok.value;
    }
    if (tok.kind === "lparen") {
      consume();
      const val = parseExpr();
      if (peek()?.kind === "rparen") consume();
      return val;
    }
    if (tok.kind === "ident") {
      consume();
      const name = tok.value;
      if (name === "TIME" || name === "T") return timeVal;
      if (name === "PI") return Math.PI;
      if (name === "DTOR") return Math.PI / 180.0;
      if (name === "RTOD") return 180.0 / Math.PI;

      if (peek()?.kind === "lparen") {
        consume(); // '('
        const args: number[] = [];
        if (peek()?.kind !== "rparen") {
          args.push(parseExpr());
          while (peek()?.kind === "comma") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek()?.kind === "rparen") consume();

        if (name === "SIN") return Math.sin(args[0] ?? 0);
        if (name === "COS") return Math.cos(args[0] ?? 0);
        if (name === "TAN") return Math.tan(args[0] ?? 0);
        if (name === "ASIN") return Math.asin(args[0] ?? 0);
        if (name === "ACOS") return Math.acos(args[0] ?? 0);
        if (name === "ATAN") return Math.atan(args[0] ?? 0);
        if (name === "EXP") return Math.exp(args[0] ?? 0);
        if (name === "LOG") return Math.log(args[0] ?? 1);
        if (name === "SQRT") return Math.sqrt(Math.max(0, args[0] ?? 0));
        if (name === "ABS") return Math.abs(args[0] ?? 0);
        if (name === "STEP" && args.length >= 5) {
          const [x, x0, h0, x1, h1] = args as [number, number, number, number, number];
          if (x <= x0) return h0;
          if (x >= x1) return h1;
          const u = (x - x0) / (x1 - x0);
          return h0 + (h1 - h0) * u * u * (3.0 - 2.0 * u);
        }
        if (name === "SHF" && args.length >= 6) {
          const [x, x0, a, w, phi, b] = args as [number, number, number, number, number, number];
          return a * Math.sin(w * (x - x0) - phi) + b;
        }
        if (name === "POLY" && args.length >= 3) {
          const x = args[0] ?? 0;
          const x0 = args[1] ?? 0;
          const dx = x - x0;
          let sum = 0;
          for (let k = 2; k < args.length; k++) {
            sum += (args[k] ?? 0) * Math.pow(dx, k - 2);
          }
          return sum;
        }
        if (name === "DX" || name === "DY" || name === "DZ" || name === "DM") {
          const pI = getMarkerVec(mPos, args[0] ?? 0);
          const pJ = args.length >= 2 ? getMarkerVec(mPos, args[1] ?? 0) : { x: 0, y: 0, z: 0 };
          const dx = pI.x - pJ.x;
          const dy = pI.y - pJ.y;
          const dz = pI.z - pJ.z;
          if (name === "DX") return dx;
          if (name === "DY") return dy;
          if (name === "DZ") return dz;
          return Math.hypot(dx, dy, dz);
        }
        if (name === "VX" || name === "VY" || name === "VZ" || name === "VM") {
          const vI = getMarkerVec(mVel, args[0] ?? 0);
          const vJ = args.length >= 2 ? getMarkerVec(mVel, args[1] ?? 0) : { x: 0, y: 0, z: 0 };
          const vx = vI.x - vJ.x;
          const vy = vI.y - vJ.y;
          const vz = vI.z - vJ.z;
          if (name === "VX") return vx;
          if (name === "VY") return vy;
          if (name === "VZ") return vz;
          return Math.hypot(vx, vy, vz);
        }
      }
      return 0.0;
    }
    consume();
    return 0.0;
  };

  return parseExpr();
}

// ============================================================================
// Main Adams DAE Lowering Pipeline
// ============================================================================

export function lowerAdamsToDae(dataset: AdamsDataset, builder?: DAEBuilder, options?: AdamsDaeOptions): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, dataset.title);
  const isBaumgarte = options?.stabilization !== "algebraic"; // Default to baumgarte for stability
  const omegaN = options?.baumgarteOmega ?? options?.baumgarteBeta ?? 50.0;
  const gravityG = options?.gravity ?? 9.80665;

  const helpers = createMarkerKinematicsHelpers(dae, dataset);
  const { isPartGround, markerPosExpr, markerVelExpr, markerAngleExpr, markerOmegaExpr } = helpers;

  // 1. Emit 6-DOF coordinates and velocities for each moving part
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);

    // Translation coordinates
    dae.addVariable(`${id}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Translation velocities
    dae.addVariable(`${id}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Rotation angles (Euler / Tait-Bryan: roll, pitch, yaw)
    dae.addVariable(`${id}.phi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.theta`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.psi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Angular velocities
    dae.addVariable(`${id}.wx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.wy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.wz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Kinematic relations: der(p) = v
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.x`)), dae.addNameExpr(`${id}.vx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.y`)), dae.addNameExpr(`${id}.vy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.z`)), dae.addNameExpr(`${id}.vz`));

    // Rotational kinematic relations: der(angle) = omega
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.phi`)), dae.addNameExpr(`${id}.wx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.theta`)), dae.addNameExpr(`${id}.wy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.psi`)), dae.addNameExpr(`${id}.wz`));
  }

  // 2. Track net forces and moments applied on each moving part
  const bodyForcesX = new Map<string, number[]>();
  const bodyForcesY = new Map<string, number[]>();
  const bodyForcesZ = new Map<string, number[]>();
  const bodyTorquesX = new Map<string, number[]>();
  const bodyTorquesY = new Map<string, number[]>();
  const bodyTorquesZ = new Map<string, number[]>();

  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);
    bodyForcesX.set(id, []);
    bodyForcesY.set(id, []);
    bodyForcesZ.set(id, []);
    bodyTorquesX.set(id, []);
    bodyTorquesY.set(id, []);
    bodyTorquesZ.set(id, []);
  }

  // Moment arm cross product helper: tau = s x F
  const buildTorque = (s: Vector3D, fx: number, fy: number, fz: number) => {
    const buildComp = (pA: number, fA: number, pB: number, fB: number) => {
      const t1 = pA !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(pA), fA) : 0;
      const t2 = pB !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(pB), fB) : 0;
      if (t1 && t2) return dae.addBinaryExpr(BinOp.Sub, t1, t2);
      if (t1) return t1;
      if (t2) return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
      return 0;
    };

    return {
      tx: buildComp(s.y, fz, s.z, fy),
      ty: buildComp(s.z, fx, s.x, fz),
      tz: buildComp(s.x, fy, s.y, fx),
    };
  };

  // 3. Lower constitutive force elements (SPRINGDAMPER / BUSHING / SFORCE / VFORCE / GFORCE)
  for (const force of dataset.forces.values()) {
    const markerA = dataset.markers.get(force.iMarkerId);
    const markerB = dataset.markers.get(force.jMarkerId);
    if (!markerA || !markerB) continue;

    const bA = String(markerA.partId);
    const bB = String(markerB.partId);
    const sA = markerA.position;
    const sB = markerB.position;
    const fId = String(force.id);

    // Intermediate force variables: fx, fy, fz
    dae.addVariable(`${fId}.fx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${fId}.fy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${fId}.fz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const fxVar = dae.addNameExpr(`${fId}.fx`);
    const fyVar = dae.addNameExpr(`${fId}.fy`);
    const fzVar = dae.addNameExpr(`${fId}.fz`);

    if (force.functionExpr && force.type !== "SPRINGDAMPER") {
      // FUNCTION-driven force (SFORCE / VFORCE / GFORCE)
      const fnExpr = compileAdamsFunctionToDae(force.functionExpr, dae, dataset);

      if (force.actionType === "ROTATIONAL") {
        // Rotational torque about Z axis; translational force components are 0
        dae.addEquation(EqKind.Simple, fxVar, dae.addRealLiteral(0.0));
        dae.addEquation(EqKind.Simple, fyVar, dae.addRealLiteral(0.0));
        dae.addEquation(EqKind.Simple, fzVar, fnExpr);

        if (!isPartGround(bA) && bodyTorquesZ.has(bA)) {
          bodyTorquesZ.get(bA)?.push(fzVar);
        }
        if (!isPartGround(bB) && bodyTorquesZ.has(bB)) {
          bodyTorquesZ.get(bB)?.push(dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fzVar));
        }
        continue;
      }

      // Compute initial line-of-action unit vector between marker A and marker B (defaulting to +Z if coincident)
      const dx0 = sA.x - sB.x;
      const dy0 = sA.y - sB.y;
      const dz0 = sA.z - sB.z;
      const len0 = Math.hypot(dx0, dy0, dz0);
      const ux = len0 > 1e-12 ? dx0 / len0 : 0.0;
      const uy = len0 > 1e-12 ? dy0 / len0 : 0.0;
      const uz = len0 > 1e-12 ? dz0 / len0 : 1.0;

      const fxRhs =
        ux === 0
          ? dae.addRealLiteral(0.0)
          : ux === 1
            ? fnExpr
            : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ux), fnExpr);
      const fyRhs =
        uy === 0
          ? dae.addRealLiteral(0.0)
          : uy === 1
            ? fnExpr
            : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(uy), fnExpr);
      const fzRhs =
        uz === 0
          ? dae.addRealLiteral(0.0)
          : uz === 1
            ? fnExpr
            : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(uz), fnExpr);

      dae.addEquation(EqKind.Simple, fxVar, fxRhs);
      dae.addEquation(EqKind.Simple, fyVar, fyRhs);
      dae.addEquation(EqKind.Simple, fzVar, fzRhs);
    } else {
      const kVal = force.stiffness ?? 1000.0;
      const cVal = force.damping ?? 50.0;

      const buildAxisTerms = (axis: "x" | "y" | "z") => {
        const rA = markerPosExpr(markerA, axis);
        const rB = markerPosExpr(markerB, axis);
        const deltaR = dae.addBinaryExpr(BinOp.Sub, rB, rA);

        const vA = markerVelExpr(markerA, axis);
        const vB = markerVelExpr(markerB, axis);
        const deltaV = dae.addBinaryExpr(BinOp.Sub, vB, vA);

        const kTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kVal), deltaR);
        const cTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), deltaV);
        let total = dae.addBinaryExpr(BinOp.Add, kTerm, cTerm);
        if (force.functionExpr && axis === "z") {
          const extraFn = compileAdamsFunctionToDae(force.functionExpr, dae, dataset);
          total = dae.addBinaryExpr(BinOp.Add, total, extraFn);
        }
        return total;
      };

      dae.addEquation(EqKind.Simple, fxVar, buildAxisTerms("x"));
      dae.addEquation(EqKind.Simple, fyVar, buildAxisTerms("y"));
      dae.addEquation(EqKind.Simple, fzVar, buildAxisTerms("z"));
    }

    // Apply on Part A (+F, +tau = sA x F)
    if (!isPartGround(bA) && bodyForcesX.has(bA)) {
      bodyForcesX.get(bA)?.push(fxVar);
      bodyForcesY.get(bA)?.push(fyVar);
      bodyForcesZ.get(bA)?.push(fzVar);

      const tA = buildTorque(sA, fxVar, fyVar, fzVar);
      if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
      if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
      if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
    }

    // Apply on Part B (-F, -tau = sB x (-F))
    if (!isPartGround(bB) && bodyForcesX.has(bB)) {
      const negFx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fxVar);
      const negFy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fyVar);
      const negFz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fzVar);

      bodyForcesX.get(bB)?.push(negFx);
      bodyForcesY.get(bB)?.push(negFy);
      bodyForcesZ.get(bB)?.push(negFz);

      const tB = buildTorque(sB, negFx, negFy, negFz);
      if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
      if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
      if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
    }
  }

  // 4. Joint constraints (translational + rotational) with 3D marker lever arms
  const rotAxisToOmega: Record<"phi" | "theta" | "psi", "wx" | "wy" | "wz"> = {
    phi: "wx",
    theta: "wy",
    psi: "wz",
  };

  if (isBaumgarte) {
    for (const joint of dataset.joints.values()) {
      const markerA = dataset.markers.get(joint.iMarkerId);
      const markerB = dataset.markers.get(joint.jMarkerId);
      if (!markerA || !markerB) continue;

      const bA = String(markerA.partId);
      const bB = String(markerB.partId);
      const isGroundA = isPartGround(bA);
      const isGroundB = isPartGround(bB);

      const partA = dataset.parts.get(markerA.partId);
      const partB = dataset.parts.get(markerB.partId);
      const mA = partA ? partA.mass : 10.0;
      const mB = partB ? partB.mass : 10.0;

      const mEff = isGroundA ? mB : isGroundB ? mA : (mA * mB) / (mA + mB);
      const kp = mEff * omegaN * omegaN;
      const kd = 2.0 * mEff * omegaN;

      const iEff = partA && !isGroundA ? partA.inertia.ixx : partB ? partB.inertia.ixx : 1.0;
      const kpRot = iEff * omegaN * omegaN;
      const kdRot = 2.0 * iEff * omegaN;

      const sA = markerA.position;
      const sB = markerB.position;
      const spec = getJointConstraintSpec(joint);

      const stabForceMap: Record<"x" | "y" | "z", number> = {
        x: dae.addRealLiteral(0.0),
        y: dae.addRealLiteral(0.0),
        z: dae.addRealLiteral(0.0),
      };

      for (const axis of spec.transAxes) {
        const posA = markerPosExpr(markerA, axis);
        const posB = markerPosExpr(markerB, axis);
        const velA = markerVelExpr(markerA, axis);
        const velB = markerVelExpr(markerB, axis);

        const deltaPos = dae.addBinaryExpr(BinOp.Sub, posB, posA);
        const deltaVel = dae.addBinaryExpr(BinOp.Sub, velB, velA);

        const fStab = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), deltaPos),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kd), deltaVel),
        );
        stabForceMap[axis] = fStab;

        if (!isGroundA) {
          if (axis === "x") bodyForcesX.get(bA)?.push(fStab);
          else if (axis === "y") bodyForcesY.get(bA)?.push(fStab);
          else bodyForcesZ.get(bA)?.push(fStab);
        }
        if (!isGroundB) {
          const negF = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStab);
          if (axis === "x") bodyForcesX.get(bB)?.push(negF);
          else if (axis === "y") bodyForcesY.get(bB)?.push(negF);
          else bodyForcesZ.get(bB)?.push(negF);
        }
      }

      // Apply lever-arm torques s x F_stab on moving bodies
      if (!isGroundA && (sA.x !== 0 || sA.y !== 0 || sA.z !== 0)) {
        const tA = buildTorque(sA, stabForceMap.x, stabForceMap.y, stabForceMap.z);
        if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
        if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
        if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
      }
      if (!isGroundB && (sB.x !== 0 || sB.y !== 0 || sB.z !== 0)) {
        const negX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForceMap.x);
        const negY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForceMap.y);
        const negZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForceMap.z);
        const tB = buildTorque(sB, negX, negY, negZ);
        if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
        if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
        if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
      }

      // Rotational stabilization torques for constrained rotational DOFs
      for (const rotAxis of spec.rotAxes) {
        const omegaAxis = rotAxisToOmega[rotAxis];
        const angA = markerAngleExpr(markerA, rotAxis);
        const angB = markerAngleExpr(markerB, rotAxis);
        const wA = markerOmegaExpr(markerA, omegaAxis);
        const wB = markerOmegaExpr(markerB, omegaAxis);

        const deltaAng = dae.addBinaryExpr(BinOp.Sub, angB, angA);
        const deltaW = dae.addBinaryExpr(BinOp.Sub, wB, wA);

        const tauStab = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kpRot), deltaAng),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kdRot), deltaW),
        );

        if (!isGroundA) {
          if (rotAxis === "phi") bodyTorquesX.get(bA)?.push(tauStab);
          else if (rotAxis === "theta") bodyTorquesY.get(bA)?.push(tauStab);
          else bodyTorquesZ.get(bA)?.push(tauStab);
        }
        if (!isGroundB) {
          const negTau = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), tauStab);
          if (rotAxis === "phi") bodyTorquesX.get(bB)?.push(negTau);
          else if (rotAxis === "theta") bodyTorquesY.get(bB)?.push(negTau);
          else bodyTorquesZ.get(bB)?.push(negTau);
        }
      }
    }
  } else {
    // Pure algebraic constraints with Lagrange multiplier reaction variables lam_${joint.id}_${k}
    for (const joint of dataset.joints.values()) {
      const markerA = dataset.markers.get(joint.iMarkerId);
      const markerB = dataset.markers.get(joint.jMarkerId);
      if (!markerA || !markerB) continue;

      const bA = String(markerA.partId);
      const bB = String(markerB.partId);
      const isGroundA = isPartGround(bA);
      const isGroundB = isPartGround(bB);
      const sA = markerA.position;
      const sB = markerB.position;
      const spec = getJointConstraintSpec(joint);

      let lamIdx = 0;
      const lamTransExprs: Record<"x" | "y" | "z", number> = {
        x: dae.addRealLiteral(0.0),
        y: dae.addRealLiteral(0.0),
        z: dae.addRealLiteral(0.0),
      };

      for (const axis of spec.transAxes) {
        const lamName = `lam_${joint.id}_${lamIdx++}`;
        dae.addVariable(lamName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        const lamExpr = dae.addNameExpr(lamName);
        lamTransExprs[axis] = lamExpr;

        // Couple Lagrange multiplier reaction force into Part A and Part B momentum balance
        if (!isGroundA) {
          if (axis === "x") bodyForcesX.get(bA)?.push(lamExpr);
          else if (axis === "y") bodyForcesY.get(bA)?.push(lamExpr);
          else bodyForcesZ.get(bA)?.push(lamExpr);
        }
        if (!isGroundB) {
          const negLam = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamExpr);
          if (axis === "x") bodyForcesX.get(bB)?.push(negLam);
          else if (axis === "y") bodyForcesY.get(bB)?.push(negLam);
          else bodyForcesZ.get(bB)?.push(negLam);
        }

        // Translational constraint equation: posA - posB = 0
        dae.addEquation(EqKind.Simple, markerPosExpr(markerA, axis), markerPosExpr(markerB, axis));
      }

      // Couple lever-arm reaction torque s x lambda into Part A and Part B
      if (!isGroundA && (sA.x !== 0 || sA.y !== 0 || sA.z !== 0)) {
        const tA = buildTorque(sA, lamTransExprs.x, lamTransExprs.y, lamTransExprs.z);
        if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
        if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
        if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
      }
      if (!isGroundB && (sB.x !== 0 || sB.y !== 0 || sB.z !== 0)) {
        const negX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.x);
        const negY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.y);
        const negZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.z);
        const tB = buildTorque(sB, negX, negY, negZ);
        if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
        if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
        if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
      }

      for (const rotAxis of spec.rotAxes) {
        const lamName = `lam_${joint.id}_${lamIdx++}`;
        dae.addVariable(lamName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        const lamExpr = dae.addNameExpr(lamName);

        // Couple rotational constraint reaction torque into Part A and Part B
        if (!isGroundA) {
          if (rotAxis === "phi") bodyTorquesX.get(bA)?.push(lamExpr);
          else if (rotAxis === "theta") bodyTorquesY.get(bA)?.push(lamExpr);
          else bodyTorquesZ.get(bA)?.push(lamExpr);
        }
        if (!isGroundB) {
          const negLam = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamExpr);
          if (rotAxis === "phi") bodyTorquesX.get(bB)?.push(negLam);
          else if (rotAxis === "theta") bodyTorquesY.get(bB)?.push(negLam);
          else bodyTorquesZ.get(bB)?.push(negLam);
        }

        // Rotational constraint equation: angleA - angleB = 0
        dae.addEquation(EqKind.Simple, markerAngleExpr(markerA, rotAxis), markerAngleExpr(markerB, rotAxis));
      }
    }
  }

  // 4b. Lower MOTION generators (FUNCTION = ...)
  for (const motion of dataset.motions.values()) {
    const mName = `motion_${motion.id}`;
    dae.addVariable(mName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const mVar = dae.addNameExpr(mName);
    const fnExpr = compileAdamsFunctionToDae(motion.functionExpr, dae, dataset);
    dae.addEquation(EqKind.Simple, mVar, fnExpr);
  }

  // 5. Formulate Newton-Euler momentum balance equations
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);
    const massExpr = dae.addRealLiteral(part.mass);

    // X-momentum: m * der(vx) = sum(Fx)
    const fxList = bodyForcesX.get(id) ?? [];
    let netFx: number = dae.addRealLiteral(0.0);
    for (const f of fxList) {
      netFx = dae.addBinaryExpr(BinOp.Add, netFx, f);
    }
    const lhsFx = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vx`)));
    dae.addEquation(EqKind.Simple, lhsFx, netFx);

    // Y-momentum: m * der(vy) = sum(Fy)
    const fyList = bodyForcesY.get(id) ?? [];
    let netFy: number = dae.addRealLiteral(0.0);
    for (const f of fyList) {
      netFy = dae.addBinaryExpr(BinOp.Add, netFy, f);
    }
    const lhsFy = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vy`)));
    dae.addEquation(EqKind.Simple, lhsFy, netFy);

    // Z-momentum: m * der(vz) = sum(Fz) - m * g
    const fzList = bodyForcesZ.get(id) ?? [];
    let netFz: number = dae.addRealLiteral(0.0);
    for (const f of fzList) {
      netFz = dae.addBinaryExpr(BinOp.Add, netFz, f);
    }
    const fGravity = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addRealLiteral(-gravityG));
    netFz = dae.addBinaryExpr(BinOp.Add, netFz, fGravity);
    const lhsFz = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vz`)));
    dae.addEquation(EqKind.Simple, lhsFz, netFz);

    // Rotational balance: I * der(omega) = sum(tau)
    const { ixx, iyy, izz } = part.inertia;

    // Tx
    const txList = bodyTorquesX.get(id) ?? [];
    let netTx: number = dae.addRealLiteral(0.0);
    for (const t of txList) {
      netTx = dae.addBinaryExpr(BinOp.Add, netTx, t);
    }
    const lhsTx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ixx), dae.addDerExpr(dae.addNameExpr(`${id}.wx`)));
    dae.addEquation(EqKind.Simple, lhsTx, netTx);

    // Ty
    const tyList = bodyTorquesY.get(id) ?? [];
    let netTy: number = dae.addRealLiteral(0.0);
    for (const t of tyList) {
      netTy = dae.addBinaryExpr(BinOp.Add, netTy, t);
    }
    const lhsTy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(iyy), dae.addDerExpr(dae.addNameExpr(`${id}.wy`)));
    dae.addEquation(EqKind.Simple, lhsTy, netTy);

    // Tz
    const tzList = bodyTorquesZ.get(id) ?? [];
    let netTz: number = dae.addRealLiteral(0.0);
    for (const t of tzList) {
      netTz = dae.addBinaryExpr(BinOp.Add, netTz, t);
    }
    const lhsTz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(izz), dae.addDerExpr(dae.addNameExpr(`${id}.wz`)));
    dae.addEquation(EqKind.Simple, lhsTz, netTz);
  }

  return dae;
}

export const compileAdamsToDae = lowerAdamsToDae;
