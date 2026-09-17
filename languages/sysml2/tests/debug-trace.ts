import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const bindingsPath = path.resolve(__dirname, "../src-gen/bindings.js");

async function main() {
  const bytes = fs.readFileSync(wasmPath);
  const wasmModule = await WebAssembly.instantiate(bytes, {
    env: { abort: () => {} },
    parser: { logInt: () => {} },
    engine: { debugLog: () => {} },
    host: { runHostQuery: () => 0 },
  });
  const exports = wasmModule.instance.exports as any;
  const mem = new Uint32Array(exports.memory.buffer);

  const actionOffsetsPtr = exports.action_offsets.value / 4;
  const actionDataPtr = exports.action_data.value / 4;
  const gotoOffsetsPtr = exports.goto_offsets.value / 4;
  const gotoDataPtr = exports.goto_data.value / 4;

  function getGoto(state: number, nonTerminal: number) {
    const offset = mem[gotoOffsetsPtr + state];
    const count = mem[gotoDataPtr + offset];
    let idx = gotoDataPtr + offset + 1;
    for (let i = 0; i < count; i++) {
      const sym = mem[idx];
      const targetState = mem[idx + 1];
      if (sym === nonTerminal) return targetState;
      idx += 2;
    }
    return -1;
  }

  function getActions(state: number, token: number) {
    const offset = mem[actionOffsetsPtr + state];
    const count = mem[actionDataPtr + offset];
    let idx = actionDataPtr + offset + 1;
    const actions: { type: number; target: number }[] = [];
    for (let i = 0; i < count; i++) {
      const sym = mem[idx];
      const actCount = mem[idx + 1];
      if (sym === token || sym === 0) {
        for (let j = 0; j < actCount; j++) {
          const actType = mem[idx + 2 + j * 2];
          const actTarget = mem[idx + 2 + j * 2 + 1];
          actions.push({ type: actType, target: actTarget });
        }
        if (sym === token) break;
      }
      idx += 2 + actCount * 2;
    }
    return actions;
  }

  // lhs=488 is __usage_modifier*
  const nextState = getGoto(11, 488);
  console.log("Goto(11, 488 (__usage_modifier*)): state", nextState);
  console.log("Actions in state", nextState, "for token 74 ('abstract'):", getActions(nextState, 74));
  console.log("Actions in state", nextState, "for token 83 ('attribute'):", getActions(nextState, 83));
}

main().catch(console.error);
