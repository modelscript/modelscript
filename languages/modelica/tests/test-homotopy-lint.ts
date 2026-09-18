import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { deriveSimplification } from "../src/lints/homotopy-synthesis.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  console.log("=== Testing Homotopy Synthesis and Detection ===");

  // 1. Test deriveSimplification directly
  const pow4 = deriveSimplification("power", "T", { power: 4, startVal: 300 });
  console.log("Derived T^4 simplification:", pow4);
  if (!pow4.includes("108000000 * T")) {
    throw new Error(`Expected slope 4*300^3 = 108000000 in T^4, got: ${pow4}`);
  }

  const drag = deriveSimplification("quadratic_drag", "m_flow", { startVal: 1.5 });
  console.log("Derived quadratic drag simplification:", drag);
  if (!drag.includes("m_flow * 1.5")) {
    throw new Error(`Expected drag proxy with startVal 1.5, got: ${drag}`);
  }

  const expSimp = deriveSimplification("exp", "v", { arg: "v / Vt" });
  console.log("Derived exp simplification:", expSimp);
  if (!expSimp.includes("1.0 + (v / Vt)")) {
    throw new Error(`Expected exp proxy (1.0 + (v / Vt)), got: ${expSimp}`);
  }

  // 2. Initialize WASM Parser and Context
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  const ctx = new Context(new NodeFileSystem());

  const testModel = `
model NonlinearThermalFluid
  Real T(start=300);
  Real Q;
  Real m_flow(start=1.0);
  Real dp;
  Real v(start=0.7);
  Real i;
  Real x;
  Real u;
  parameter Real sigma = 5.67e-8;
  parameter Real k = 0.5;
  parameter Real Is = 1e-12;
  parameter Real Vt = 0.026;
  parameter Real R = 10.0;
equation
  Q = sigma * T^4;
  dp = k * m_flow * abs(m_flow);
  i = Is * (exp(v / Vt) - 1.0);
  x = homotopy(x^2, 2.0 * x - 1.0);
  u = R * i;
end NonlinearThermalFluid;
  `;

  const uri = "file:///test/NonlinearThermalFluid.mo";
  ctx.load(testModel, uri);

  // 3. Query Salsa for all lints
  const diags = await ctx.queryEngine.runAllLintsAsync(uri);
  console.log(`\nFound ${diags.length} total diagnostics from Salsa`);

  const homotopyDiags = diags.filter(
    (d) => d.code === 5010 || d.lintName === "homotopyRecommended" || d.message.includes("homotopy"),
  );

  console.log(`Found ${homotopyDiags.length} homotopy recommendation diagnostics:`);
  for (const hd of homotopyDiags) {
    console.log(` - [${hd.severity.toUpperCase()}] code=${hd.code} (${hd.startByte}-${hd.endByte}): ${hd.message}`);
  }

  if (homotopyDiags.length !== 3) {
    throw new Error(
      `Expected 3 homotopy diagnostics (T^4, m_flow*abs(m_flow), exp(v/Vt)), but found ${homotopyDiags.length}`,
    );
  }

  // Verify that all 3 expected terms are flagged
  const hasPow = homotopyDiags.some((d) => d.message.includes("T^4") || d.message.includes("T ^ 4"));
  const hasDrag = homotopyDiags.some((d) => d.message.includes("m_flow * abs(m_flow)"));
  const hasExp = homotopyDiags.some((d) => d.message.includes("exp(v / Vt)") || d.message.includes("exp"));

  if (!hasPow) throw new Error("Missing homotopy diagnostic for T^4");
  if (!hasDrag) throw new Error("Missing homotopy diagnostic for m_flow * abs(m_flow)");
  if (!hasExp) throw new Error("Missing homotopy diagnostic for exp(v / Vt)");

  // 4. Test QuickFix text replacement
  console.log("\nSimulating QuickFix on T^4 equation:");
  const powDiag = homotopyDiags.find((d) => d.message.includes("T^4") || d.message.includes("T ^ 4"))!;
  const originalTerm = testModel.substring(powDiag.startByte, powDiag.endByte);
  const quickFixText = `homotopy(${originalTerm}, ${pow4})`;
  const modifiedSource = testModel.slice(0, powDiag.startByte) + quickFixText + testModel.slice(powDiag.endByte);

  console.log("Original term:", originalTerm);
  console.log("Replaced with:", quickFixText);

  // Reload modified model and verify T^4 diagnostic disappears
  const ctx2 = new Context(new NodeFileSystem());
  ctx2.load(modifiedSource, uri);
  const diags2 = await ctx2.queryEngine.runAllLintsAsync(uri);
  const homotopyDiags2 = diags2.filter(
    (d) => d.code === 5010 || d.lintName === "homotopyRecommended" || d.message.includes("homotopy"),
  );
  console.log(`Homotopy diagnostics after applying QuickFix: ${homotopyDiags2.length}`);
  if (homotopyDiags2.length !== 2) {
    throw new Error(`Expected 2 homotopy diagnostics after fixing T^4, but got ${homotopyDiags2.length}`);
  }

  console.log("\nAll Homotopy Synthesis and QuickFix tests PASSED successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
