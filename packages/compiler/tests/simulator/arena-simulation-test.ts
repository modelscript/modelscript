import { simulateArena } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../../core/tests/node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const src = `
model BouncingBall
  Real h(start = 1.0);
  Real v(start = 0.0);
  parameter Real g = 9.81;
  parameter Real e = 0.7;
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
`;

for (const solver of ["rk4", "dopri5"] as const) {
  const ctx = new Context(new NodeFileSystem());
  ctx.load(src);
  const dae = ctx.flattenDAE("BouncingBall");
  if (!dae) {
    process.exit(1);
  }

  console.log(`\n=== ${solver.toUpperCase()} ===`);
  const result = simulateArena(dae.arena, {
    startTime: 0,
    stopTime: 3,
    step: 0.01,
    solver,
  });

  const hIdx = result.states.indexOf("h");
  const vIdx = result.states.indexOf("v");
  const h = result.y.map((r) => r[hIdx] ?? 0);
  const v = result.y.map((r) => r[vIdx] ?? 0);

  console.log(`time points: ${result.t.length}`);

  const bounces = v.reduce((c, vi, i) => {
    if (i === 0) return c;
    const prev = v[i - 1] ?? 0;
    return prev < 0 && vi > 0 ? c + 1 : c;
  }, 0);
  console.log(`bounces: ${bounces} ${bounces >= 5 ? "✅" : "❌"}`);

  // Find min h using a loop to avoid stack overflow
  let minH = Infinity;
  for (const hi of h) {
    if (hi < minH) minH = hi;
  }
  console.log(`min(h): ${minH.toFixed(6)} ${minH >= -0.01 ? "✅" : "⚠️"}`);

  // Show event points
  const events: string[] = [];
  for (let i = 1; i < result.t.length; i++) {
    const tCurr = result.t[i] ?? 0;
    const tPrev = result.t[i - 1] ?? 0;
    if (Math.abs(tCurr - tPrev) < 1e-10) {
      events.push(`t=${tCurr.toFixed(4)} h=${h[i]?.toFixed(6)} v=${v[i]?.toFixed(4)}`);
    }
  }
  console.log(`event points: ${events.length}`);
  for (const ev of events) console.log(`  ${ev}`);

  console.log("--- Trajectory (every 0.3s) ---");
  for (let i = 0; i < result.t.length; i++) {
    const t = result.t[i] ?? 0;
    if (Math.abs(t % 0.3) < 0.005 || i === 0 || i === result.t.length - 1) {
      console.log(`  t=${t.toFixed(3)} h=${h[i]?.toFixed(4)} v=${v[i]?.toFixed(4)}`);
    }
  }
}
