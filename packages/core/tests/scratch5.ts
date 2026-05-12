import { NodeFileSystem } from "../../../apps/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";
const ctx = new Context(new NodeFileSystem());
ctx.load("class WhenStat Real x; equation der(x) = 2.0 * x; end WhenStat;");
const dae = ctx.flattenDAE("WhenStat", { canonicalizeEquations: true });
console.log(dae.equations[0].toString());
