import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { ArenaQueryFlattener } from "../../../../languages/modelica/flattener-query.js";
import { NodeFileSystem } from "../../../core/tests/node-filesystem.js";
import { Context } from "../../src/context.js";
import { QueryEngine } from "../../src/query-engine.js";
import { simulateArena } from "../../src/simulator/core/simulate-arena.js";
import { WorkspaceIndex } from "../../src/workspace-index.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

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
  const ws = new WorkspaceIndex();
  const qe = new QueryEngine(ws);
  const ctx = new Context(fs, ws, qe);

  ctx.load(bouncingBall, "bouncing-ball.mo");

  const queryDB = ctx.queryEngine.toQueryDB();
  const flattener = new ArenaQueryFlattener(queryDB);

  const entries = ctx.queryEngine.index.byName.get("BouncingBall") || [];
  const firstId = entries[0];
  const arena = flattener.flatten(firstId);

  const resultDopri = simulateArena(arena, {
    startTime: 0,
    stopTime: 3,
    step: 0.1,
    solver: "dopri5",
  });

  const hIdx = resultDopri.states.indexOf("h");
  for (let i = 0; i < resultDopri.t.length; i++) {
    console.log(`t: ${resultDopri.t[i].toFixed(4)}, h: ${resultDopri.y[i][hIdx].toFixed(4)}`);
  }
}

main().catch(console.error);
