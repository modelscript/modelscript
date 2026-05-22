// SPDX-License-Identifier: AGPL-3.0-or-later

import { simulateArena } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import { ArenaQueryFlattener } from "@modelscript/modelica/flattener-query";
import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../core/tests/node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const bouncingBall = `
model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1) "height of ball";
  Real v(start = 0) "velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
`;

async function main() {
  const ctx = new Context(new NodeFileSystem());
  ctx.load(bouncingBall, "bouncing-ball.mo");

  // Get the query DB and flatten using the arena pipeline
  const queryDB = ctx.queryEngine.toQueryDB();
  const flattener = new ArenaQueryFlattener(queryDB);

  const entries = ctx.queryEngine.index.byName.get("BouncingBall") || [];
  const firstId = entries[0];
  if (firstId === undefined) {
    console.error("ERROR: BouncingBall class not found in query index");
    process.exit(1);
  }

  const arena = flattener.flatten(firstId);

  console.log("=== Arena ===");
  console.log("varCount:", arena.varCount);
  console.log("eqCount:", arena.eqCount);
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    console.log(`  var[${i}] "${arena.getVarName(i)}" start=${arena.getVarStartValue(i)}`);
  }

  // Simulate using the arena pipeline
  const result = simulateArena(arena, {
    startTime: 0,
    stopTime: 3,
    step: 0.01,
    solver: "rk4",
  });

  console.log("\n=== Result ===");
  console.log("points:", result.t.length, "states:", result.states);

  const hIdx = result.states.indexOf("h");
  const vIdx = result.states.indexOf("v");
  if (hIdx < 0) {
    console.log("h not found in states!");
    return;
  }

  let bounceCount = 0;
  let prevH = result.y[0]?.[hIdx] ?? 1;
  for (let i = 1; i < result.t.length; i++) {
    const h = result.y[i]?.[hIdx] ?? 0;
    const v = vIdx >= 0 ? (result.y[i]?.[vIdx] ?? 0) : NaN;
    if ((prevH > 0 && h <= 0) || (prevH <= 0 && h > 0) || i % 50 === 0) {
      console.log(`  t=${result.t[i]?.toFixed(4)} h=${h.toFixed(6)} v=${v.toFixed(4)}`);
    }
    if (prevH > 0.001 && h <= 0.001) bounceCount++;
    prevH = h;
  }
  console.log(`\nBounce count: ${bounceCount}`);
  const lastH = result.y[result.y.length - 1]?.[hIdx] ?? 0;
  console.log(`Final h: ${lastH.toFixed(6)}`);
}

main().catch(console.error);
