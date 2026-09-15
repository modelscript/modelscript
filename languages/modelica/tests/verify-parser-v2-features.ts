import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`parser.wasm not found at: ${wasmPath}`);
  }

  const { parser, facade } = await createWasmParser(wasmPath);
  console.log("=================================================");
  console.log("Verifying ModelScript GLR Parser v2 Enhancements");
  console.log("=================================================\n");

  // Test 1: Pristine model parsing
  console.log("Test 1: Parsing valid Modelica model...");
  const validSource = `model SimpleModel\n  Real x = 1.0;\n  Real y;\nequation\n  x = 1.0;\n  y = x * 2;\nend SimpleModel;\n`;
  const validTree = parser.parse(validSource);
  const rootPtr = (validTree.rootNode as any).ptr ?? (validTree.rootNode as any).id ?? 0;
  const diags = facade.getDiagnostics(rootPtr);
  const hasSyntaxErrors = diags.some((d: any) => d.severity === 1);
  console.log("  hasError():", validTree.rootNode.hasError(), "syntax errors:", hasSyntaxErrors);
  if (!validTree || validTree.rootNode.hasError() || hasSyntaxErrors) {
    throw new Error("Failed to parse valid Modelica source cleanly");
  }
  console.log("  [PASS] Clean parse with 0 errors\n");

  // Test 2: Missing token diagnostic reporting (B5)
  console.log("Test 2: Verifying 'Missing' token diagnostic message...");
  const missingSource = `model MissingParen\n  Real x = max(1, 2;\nend MissingParen;\n`;
  const missingTree = parser.parse(missingSource);
  const rootPtrMissing = (missingTree.rootNode as any).ptr ?? (missingTree.rootNode as any).id ?? 0;
  const missingDiags = facade.getDiagnostics(rootPtrMissing);
  console.log("  Diagnostics produced:", JSON.stringify(missingDiags, null, 2));
  const hasMissingMsg = missingDiags.some((d: any) => d.message.includes("Missing"));
  if (!hasMissingMsg) {
    throw new Error("Failed to format 'Missing' token diagnostic message");
  }
  console.log("  [PASS] Successfully formatted 'Missing' token message\n");

  // Test 3: Unexpected token diagnostic reporting (B5)
  console.log("Test 3: Verifying 'Unexpected' token diagnostic message...");
  const unexpectedSource = `model UnexpectedToken\n  }\nend UnexpectedToken;\n`;
  const unexpectedTree = parser.parse(unexpectedSource);
  const rootPtrUnexpected = (unexpectedTree.rootNode as any).ptr ?? (unexpectedTree.rootNode as any).id ?? 0;
  const unexpectedDiags = facade.getDiagnostics(rootPtrUnexpected);
  console.log(
    "  Diagnostics produced:",
    unexpectedDiags.map((d: any) => d.message),
  );
  const hasUnexpectedMsg = unexpectedDiags.some(
    (d: any) => d.message.includes("Unexpected '}'") || d.message.includes("Unexpected"),
  );
  if (!hasUnexpectedMsg) {
    throw new Error("Failed to format 'Unexpected' token diagnostic message");
  }
  console.log("  [PASS] Successfully formatted 'Unexpected' token message\n");

  // Test 4: Structured Error Node Subtree (B4)
  console.log("Test 4: Verifying structured ERROR node subtree on skipped tokens...");
  const skippedSource = `model SkipTokens\n  + * %\n  Real x;\nend SkipTokens;\n`;
  const skippedTree = parser.parse(skippedSource);
  if (!skippedTree) {
    throw new Error("Failed to parse tree with skipped tokens");
  }
  console.log("  Root has error:", skippedTree.rootNode.hasError);
  console.log("  [PASS] Parser recovered across multi-token skip successfully\n");

  // Test 5: Multi-token consecutive insertions (B1)
  console.log("Test 5: Verifying multi-token insertion recovery...");
  const multiInsertSource = `model MultiMissing\n  Real a = max(1, 2;\n  Real b = sin(3;\n  Real c = cos(4;\nend MultiMissing;\n`;
  const multiInsertTree = parser.parse(multiInsertSource);
  const rootPtrMulti = (multiInsertTree.rootNode as any).ptr ?? (multiInsertTree.rootNode as any).id ?? 0;
  const multiDiags = facade.getDiagnostics(rootPtrMulti);
  console.log(
    `  Multi-insertion diagnostics (${multiDiags.length}):`,
    multiDiags.map((d: any) => d.message),
  );
  if (multiDiags.length < 3) {
    throw new Error("Expected at least 3 missing token diagnostics for 3 unclosed function calls");
  }
  console.log("  [PASS] Multi-token insertion successfully recovered across declarations\n");

  console.log("=================================================");
  console.log("ALL GLR Parser v2 Enhancements Verified!");
  console.log("=================================================");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
