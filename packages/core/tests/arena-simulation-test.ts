import Modelica from "@modelscript/modelica/parser";
import { simulateArena } from "@modelscript/simulator";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../../apps/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";

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

const ctx = new Context(new NodeFileSystem());
ctx.load(src);
const dae = ctx.flattenDAE("BouncingBall");
if (!dae) {
  process.exit(1);
}

const result = simulateArena(dae.arena, {
  startTime: 0,
  stopTime: 3,
  step: 0.001,
  solver: "rk4",
});

const hIdx = result.states.indexOf("h");
const vIdx = result.states.indexOf("v");
const h = result.y.map((r) => r[hIdx] ?? 0);
const v = result.y.map((r) => r[vIdx] ?? 0);

console.log(`h(0)=${h[0]?.toFixed(4)} ✅`);
console.log(`v(0)=${v[0]?.toFixed(4)} ✅`);

const bounces = v.reduce((c, vi, i) => {
  if (i === 0) return c;
  const prev = v[i - 1] ?? 0;
  return (prev < 0 && vi > 0) || (prev > 0 && vi < 0) ? c + 1 : c;
}, 0);
console.log(`bounces: ${bounces} ${bounces >= 6 ? "✅" : "❌"}`);

const minH = Math.min(...h);
console.log(`min(h): ${minH.toFixed(6)} ${minH >= -0.05 ? "✅" : "⚠️ (expected with fixed-step)"}`);

console.log("\n--- Trajectory ---");
for (let i = 0; i < result.t.length; i += 300) {
  console.log(`  t=${result.t[i]?.toFixed(3)} h=${h[i]?.toFixed(4)} v=${v[i]?.toFixed(4)}`);
}
