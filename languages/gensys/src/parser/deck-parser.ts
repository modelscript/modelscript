// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GensysBody, GensysModel, SpringDamperElement, WheelsetDefinition } from "../types.js";
import { evaluateMathExpr } from "./expr-eval.js";

/**
 * Tokenizes a line into arguments, respecting single/double quotes,
 * line continuations, and inline comments (#, %, !).
 */
export function tokenizeGensysLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }

    // Inline comment indicators when not in quotes
    if (ch === "#" || ch === "%" || ch === "!") {
      break;
    }

    // Whitespace delimiter
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Robust card-deck parser for GENSYS models (.calc, .sub, .run).
 * Supports:
 * - Parameter definitions (set <param> = <expr> or <param> = <expr>)
 * - Safe arithmetic expression evaluation in arguments (+, -, *, /, ^, parentheses)
 * - Line continuations (& or \ at line endings)
 * - Quoted string arguments (e.g. paths with spaces)
 * - Inline comments
 * - Case-insensitive commands
 */
export function parseGensysDeck(source: string, name: string = "GensysModel"): GensysModel {
  const model: GensysModel = {
    name,
    subsystems: [],
    bodies: new Map<string, GensysBody>(),
    couplings: new Map<string, SpringDamperElement>(),
    wheelsets: new Map<string, WheelsetDefinition>(),
  };

  const scope = new Map<string, number>();
  const rawLines = source.split(/\r?\n/);
  const physicalStatements: string[] = [];
  let buffer = "";

  // Handle line continuations (& or \)
  for (const rawLine of rawLines) {
    // Strip inline comments outside of quotes before checking line continuations
    let lineWithoutComment = rawLine;
    let inQuote: string | null = null;
    let commentIdx = -1;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i]!;
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === "#" || ch === "%" || ch === "!") {
        commentIdx = i;
        break;
      }
    }
    if (commentIdx !== -1) {
      lineWithoutComment = rawLine.slice(0, commentIdx);
    }

    const trimmed = lineWithoutComment.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.endsWith("&") || trimmed.endsWith("\\")) {
      buffer += trimmed.slice(0, -1).trimEnd() + " ";
    } else {
      buffer += trimmed;
      physicalStatements.push(buffer);
      buffer = "";
    }
  }

  if (buffer.length > 0) {
    physicalStatements.push(buffer);
  }

  for (const stmt of physicalStatements) {
    const tokens = tokenizeGensysLine(stmt);
    if (tokens.length === 0) continue;

    const cmd = tokens[0]!.toLowerCase();

    // Parameter definition: set <name> = <expr> OR set <name> <expr>
    if ((cmd === "set" || cmd === "$set") && tokens.length >= 3) {
      const pName = tokens[1]!;
      const exprStr = tokens[2] === "=" ? tokens.slice(3).join(" ") : tokens.slice(2).join(" ");
      const val = evaluateMathExpr(exprStr, scope);
      scope.set(pName, val);
      continue;
    }

    // Direct assignment: <param> = <expr>
    if (tokens.length >= 3 && tokens[1] === "=") {
      const pName = tokens[0]!;
      const exprStr = tokens.slice(2).join(" ");
      const val = evaluateMathExpr(exprStr, scope);
      scope.set(pName, val);
      continue;
    }

    // body <name> <mass> <jx> <jy> <jz> [x y z]
    if (cmd === "body" && tokens.length >= 6) {
      const bName = tokens[1] ?? "unnamed_body";
      const mass = evaluateMathExpr(tokens[2], scope, 0);
      const jx = evaluateMathExpr(tokens[3], scope, 0);
      const jy = evaluateMathExpr(tokens[4], scope, 0);
      const jz = evaluateMathExpr(tokens[5], scope, 0);
      const x = evaluateMathExpr(tokens[6], scope, 0);
      const y = evaluateMathExpr(tokens[7], scope, 0);
      const z = evaluateMathExpr(tokens[8], scope, 0);

      model.bodies.set(bName, {
        name: bName,
        mass,
        inertia: { jx, jy, jz },
        position: { x, y, z },
      });
    }

    // wheelset <name> <mass> [jx jy jz] <gauge> <wheelRadius> <conicity> [profile_path]
    else if (cmd === "wheelset" && tokens.length >= 6) {
      const wName = tokens[1] ?? "unnamed_wheelset";
      const mass = evaluateMathExpr(tokens[2], scope, 0);
      let jx = mass * 0.1;
      let jy = mass * 0.1;
      let jz = mass * 0.1;
      let gauge = 1.435;
      let wheelRadius = 0.46;
      let conicity = 0.05;
      let profile: string | undefined;

      if (tokens.length >= 9) {
        jx = evaluateMathExpr(tokens[3], scope, jx);
        jy = evaluateMathExpr(tokens[4], scope, jy);
        jz = evaluateMathExpr(tokens[5], scope, jz);
        gauge = evaluateMathExpr(tokens[6], scope, 1.435);
        wheelRadius = evaluateMathExpr(tokens[7], scope, 0.46);
        conicity = evaluateMathExpr(tokens[8], scope, 0.05);
        profile = tokens[9];
      } else {
        gauge = evaluateMathExpr(tokens[3], scope, 1.435);
        wheelRadius = evaluateMathExpr(tokens[4], scope, 0.46);
        conicity = evaluateMathExpr(tokens[5], scope, 0.05);
        profile = tokens[6];
      }

      model.wheelsets.set(wName, {
        name: wName,
        mass,
        inertia: { jx, jy, jz },
        gauge,
        wheelRadius,
        conicity,
        profile,
      });
    }

    // spring <name> <b1> <b2> <kx> <ky> <kz> <cx> <cy> <cz>
    else if (cmd === "spring" && tokens.length >= 10) {
      const sName = tokens[1] ?? "unnamed_spring";
      const b1 = tokens[2] ?? "ground";
      const b2 = tokens[3] ?? "ground";
      const kx = evaluateMathExpr(tokens[4], scope, 0);
      const ky = evaluateMathExpr(tokens[5], scope, 0);
      const kz = evaluateMathExpr(tokens[6], scope, 0);
      const cx = evaluateMathExpr(tokens[7], scope, 0);
      const cy = evaluateMathExpr(tokens[8], scope, 0);
      const cz = evaluateMathExpr(tokens[9], scope, 0);

      model.couplings.set(sName, {
        name: sName,
        type: "linear",
        body1: b1,
        body2: b2,
        attachPoint1: { x: 0, y: 0, z: 0 },
        attachPoint2: { x: 0, y: 0, z: 0 },
        stiffness: { x: kx, y: ky, z: kz },
        damping: { x: cx, y: cy, z: cz },
      });
    }

    // sub <name>
    else if (cmd === "sub" && tokens.length >= 2 && tokens[1]) {
      model.subsystems.push(tokens[1]);
    }

    // speed <val>
    else if (cmd === "speed" && tokens.length >= 2) {
      const spd = evaluateMathExpr(tokens[1]!, scope, 0);
      model.simulationConfig = {
        speed: spd,
        tStart: model.simulationConfig?.tStart ?? 0,
        tStop: model.simulationConfig?.tStop ?? 10,
        dt: model.simulationConfig?.dt ?? 0.001,
      };
    }

    // tstart <val>
    else if (cmd === "tstart" && tokens.length >= 2) {
      const tStart = evaluateMathExpr(tokens[1]!, scope, 0);
      model.simulationConfig = {
        speed: model.simulationConfig?.speed ?? 0,
        tStart,
        tStop: model.simulationConfig?.tStop ?? 10,
        dt: model.simulationConfig?.dt ?? 0.001,
      };
    }

    // tstop <val>
    else if (cmd === "tstop" && tokens.length >= 2) {
      const tStop = evaluateMathExpr(tokens[1]!, scope, 10);
      model.simulationConfig = {
        speed: model.simulationConfig?.speed ?? 0,
        tStart: model.simulationConfig?.tStart ?? 0,
        tStop,
        dt: model.simulationConfig?.dt ?? 0.001,
      };
    }

    // dt <val>
    else if (cmd === "dt" && tokens.length >= 2) {
      const dt = evaluateMathExpr(tokens[1]!, scope, 0.001);
      model.simulationConfig = {
        speed: model.simulationConfig?.speed ?? 0,
        tStart: model.simulationConfig?.tStart ?? 0,
        tStop: model.simulationConfig?.tStop ?? 10,
        dt,
      };
    }
  }

  return model;
}
