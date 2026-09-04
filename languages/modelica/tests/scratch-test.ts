import { createWasmParser } from "@modelscript/modelica/parser";
import fs from "fs";
import { fileURLToPath } from "node:url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
  const wasmParser = await createWasmParser(wasmPath);
  const { parser } = wasmParser;

  const testFile = path.resolve(__dirname, "../testsuite/OpenModelica/flattening/modelica/equations/LotkaVolterra.mo");
  const code = fs.readFileSync(testFile, "utf-8");
  const tree = parser.parse(code);

  const facade = wasmParser.facade;
  const exports = facade.exports;
  const numElements = exports.lsp_getDiagnostics(tree.rootNode.id);
  const dirPtr = exports.lsp_getBinaryBuffer();
  const memory = new Uint32Array(exports.memory.buffer);
  console.log("numElements:", numElements);
  for (let i = 0; i < numElements * 7; i += 7) {
    const startByte = memory[(dirPtr >> 2) + i];
    const endByte = memory[(dirPtr >> 2) + i + 1];
    const lintId = memory[(dirPtr >> 2) + i + 2];
    const arg0 = memory[(dirPtr >> 2) + i + 3];
    const arg1 = memory[(dirPtr >> 2) + i + 4];
    console.log(`Diag ${i / 7}: start=${startByte}, end=${endByte}, lintId=${lintId}, arg0=${arg0}, arg1=${arg1}`);
    if (arg0) {
      console.log(`  arg0 type=${exports.getNodeType(arg0)} len=${exports.getNodeByteLength(arg0)}`);
    }
  }
}

main().catch(console.error);
