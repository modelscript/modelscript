// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimpackBody, SimpackJoint, SimpackMarker, SimpackModel } from "../types.js";
import { evaluateMathExpr } from "./expr-eval.js";

export function tokenizeSimpackLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  let parenDepth = 0;

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

    if (ch === "#" || ch === "!") {
      break;
    }

    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      current += ch;
      continue;
    }

    if (parenDepth === 0 && /\s/.test(ch)) {
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
 * Parses classic SIMPACK ASCII card decks (.sim, .mbs).
 * Supports parameter definitions (set <param> = <expr>) and mathematical expressions.
 */
export function parseSimDeck(source: string, defaultName: string = "SimpackModel"): SimpackModel {
  const model: SimpackModel = {
    name: defaultName,
    bodies: new Map<string, SimpackBody>(),
    markers: new Map<string, SimpackMarker>(),
    joints: new Map<string, SimpackJoint>(),
    forces: new Map(),
  };

  const scope = new Map<string, number>();
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("$") || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const tokens = tokenizeSimpackLine(line);
    const cmd = tokens[0]?.toLowerCase();
    if (!cmd) continue;

    // Parameter definition: set <name> = <expr> OR <name> = <expr>
    if ((cmd === "set" || cmd === "$set") && tokens.length >= 3) {
      const pName = tokens[1]!;
      const exprStr = tokens[2] === "=" ? tokens.slice(3).join(" ") : tokens.slice(2).join(" ");
      const val = evaluateMathExpr(exprStr, scope);
      scope.set(pName, val);
      continue;
    }
    if (tokens.length >= 3 && tokens[1] === "=") {
      const pName = tokens[0]!;
      const exprStr = tokens.slice(2).join(" ");
      const val = evaluateMathExpr(exprStr, scope);
      scope.set(pName, val);
      continue;
    }

    // $BODY <id> <name> <mass> <ixx> <iyy> <izz>
    if ((cmd === "body" || cmd === "$body") && tokens.length >= 6) {
      const id = tokens[1] ?? `b_${model.bodies.size + 1}`;
      const name = tokens[2] ?? id;
      const mass = evaluateMathExpr(tokens[3], scope, 1.0);
      const ixx = evaluateMathExpr(tokens[4], scope, mass * 0.1);
      const iyy = evaluateMathExpr(tokens[5], scope, mass * 0.1);
      const izz = evaluateMathExpr(tokens[6], scope, mass * 0.1);

      model.bodies.set(id, {
        id,
        name,
        mass,
        inertia: { ixx, iyy, izz },
        markerId: `m_${id}`,
      });
    }

    // $MARKER <id> <body> <x> <y> <z>
    else if ((cmd === "marker" || cmd === "$marker") && tokens.length >= 6) {
      const id = tokens[1] ?? `m_${model.markers.size + 1}`;
      const bodyId = tokens[2] ?? "$inertial";
      const x = evaluateMathExpr(tokens[3], scope, 0);
      const y = evaluateMathExpr(tokens[4], scope, 0);
      const z = evaluateMathExpr(tokens[5], scope, 0);

      model.markers.set(id, {
        id,
        name: id,
        bodyId,
        position: { x, y, z },
        orientation: { x: 0, y: 0, z: 0 },
      });
    }

    // $JOINT <id> <type> <fromMarker> <toMarker>
    else if ((cmd === "joint" || cmd === "$joint") && tokens.length >= 5) {
      const id = tokens[1] ?? `j_${model.joints.size + 1}`;
      const type = (tokens[2]?.toLowerCase() ?? "revolute") as SimpackJoint["type"];
      const fromMarker = tokens[3] ?? "";
      const toMarker = tokens[4] ?? "";

      model.joints.set(id, {
        id,
        name: id,
        type,
        fromMarker,
        toMarker,
        dofCount: type === "revolute" ? 1 : 6,
      });
    }

    // $FORCE <id> <markerA> <markerB> <kx> <ky> <kz> <cx> <cy> <cz>
    else if (
      (cmd === "force" ||
        cmd === "$force" ||
        cmd === "spring" ||
        cmd === "$spring" ||
        cmd === "bushing" ||
        cmd === "$bushing") &&
      tokens.length >= 4
    ) {
      const id = tokens[1] ?? `force_${model.forces.size + 1}`;
      const markerA = tokens[2] ?? "";
      const markerB = tokens[3] ?? "";
      const kx = evaluateMathExpr(tokens[4], scope, 0);
      const ky = evaluateMathExpr(tokens[5], scope, 0);
      const kz = evaluateMathExpr(tokens[6], scope, 0);
      const cx = evaluateMathExpr(tokens[7], scope, 0);
      const cy = evaluateMathExpr(tokens[8], scope, 0);
      const cz = evaluateMathExpr(tokens[9], scope, 0);

      model.forces.set(id, {
        id,
        name: id,
        type: "spring_damper",
        markerA,
        markerB,
        stiffness: { x: kx, y: ky, z: kz },
        damping: { x: cx, y: cy, z: cz },
      });
    }
  }

  return model;
}
