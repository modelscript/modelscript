import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { ArenaQueryFlattener } from "../../../../languages/modelica/flattener-query.js";
import { Context } from "../../../core/src/compiler/context.js";
import { NodeFileSystem } from "../../../core/tests/node-filesystem.js";
import { simulateArena } from "../../src/simulator/core/simulate-arena.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context._parsers.set(".mo", parser);

const bouncingBall = `
model BouncingBall
  parameter Real e = 0.8 "coefficient of restitution";
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
  const fs = new NodeFileSystem();
  const ctx = new Context(fs);

  ctx.load(bouncingBall, "bouncing-ball.mo");

  const queryDB = ctx.queryEngine.toQueryDB();
  const flattener = new ArenaQueryFlattener(queryDB);

  const entries = ctx.queryEngine.index.byName.get("BouncingBall") || [];
  const firstId = entries[0];
  const arena = flattener.flatten(firstId);
  console.log("equations in arena:", arena.eqCount);
  console.log("variables in arena:", arena.varCount);

  // Eliminate aliases
  const { eliminateArenaAliases } = await import("@modelscript/compiler");
  eliminateArenaAliases(arena);

  // Run simulation
  const resultDopri = simulateArena(arena, {
    startTime: 0,
    stopTime: 5,
    step: 0.05,
    solver: "dopri5",
  });

  const hIdx = resultDopri.states.indexOf("h");
  if (hIdx !== -1) {
    const bounces = resultDopri.y.filter((y) => y[hIdx] <= 0).length;
    console.log(`[simulateArena] Found ${bounces} bounces with dopri5, states:`, resultDopri.states);
  } else {
    console.log("[simulateArena] h state missing!");
  }
}

main().catch(console.error);
