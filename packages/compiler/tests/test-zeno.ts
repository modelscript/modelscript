import Modelica from "@modelscript/tree-sitter-modelica";
import Parser from "tree-sitter";
import { ArenaQueryFlattener } from "../../../languages/modelica/flattener-query.js";
import { Context } from "../../core/src/compiler/context.js";
import { NodeFileSystem } from "../../core/tests/node-filesystem.js";
import { QueryEngine } from "../../salsa/src/query-engine.js";
import { simulateArena } from "../src/simulator/core/simulate-arena.js";
import { WorkspaceIndex } from "../src/workspace-index.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const bouncingBall = `
model BouncingBall
  parameter Real e = 0.8;
  parameter Real g = 9.81;
  Real h(start = 0);
  Real v(start = 0);
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 and v < 0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
`;

async function main() {
  const fs = new NodeFileSystem();
  const ws = new WorkspaceIndex();
  const qe = new QueryEngine(ws, null, null, 100);
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

  console.log(`Simulation finished with ${resultDopri.t.length} steps`);
}
main().catch(console.error);
