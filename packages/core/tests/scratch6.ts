import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";
const ctx = new Context(new NodeFileSystem());
ctx.load(
  "class WhenStat Real x(start = 1.0); Real y1; parameter Real y2 = 5.0; Real y3; equation der(x) = 2.0 * x; algorithm when x > 2.0 then y1 := sin(x); y3 := 2.0 * x + pre(y1) + y2; end when; end WhenStat;",
);
const dae = ctx.flattenDAE("WhenStat", { canonicalizeEquations: true });
console.log(dae.equations[0].toString());
