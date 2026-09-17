import { createWasmParser } from "@modelscript/dsl";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  const { parser } = await createWasmParser(sysmlWasm);

  const testCases = [
    "attribute def Real;",
    "abstract attribute def Real;",
    "package P { attribute def Real; }",
    "package P { abstract attribute def Real; }",
    "package P { attribute def Time :> Real; }",
    "package P { abstract attribute def Time :> Real; }",
    "package P { part def Engine { attribute power : Real; } }",
  ];

  for (const tc of testCases) {
    const tree = parser.parse(tc);
    const hasErr = tree.rootNode.hasError;
    const str = tree.rootNode.toString();
    console.log(`\n--- Test: ${tc} ---`);
    console.log("hasError:", hasErr);
    console.log("CST:", str.length > 200 ? str.slice(0, 200) + "..." : str);
  }
}

main().catch(console.error);
