// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function decodeHexIntArray(hex: string, length: number): Int32Array {
  const result = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = parseInt(hex.substring(i * 8, (i + 1) * 8), 16) | 0;
  }
  return result;
}

const parserTsPath = path.resolve(__dirname, "../as-gen/parser.ts");
const content = fs.readFileSync(parserTsPath, "utf-8");

const offsetsMatch = content.match(/export const action_offsets: usize = decodeHexIntArray\("([^"]+)",\s*(\d+)\);/);
const dataMatch = content.match(/export const action_data: usize = decodeHexIntArray\("([^"]+)",\s*(\d+)\);/);

if (!offsetsMatch || !dataMatch) {
  console.error("Could not find action_offsets or action_data in parser.ts");
  process.exit(1);
}

const actionOffsets = decodeHexIntArray(offsetsMatch[1], parseInt(offsetsMatch[2], 10));
const actionData = decodeHexIntArray(dataMatch[1], parseInt(dataMatch[2], 10));

const stateId = 492;
const offset = actionOffsets[stateId];
console.log(`State ${stateId} action offset: ${offset}`);

const actionCount = actionData[offset];
console.log(`State ${stateId} has ${actionCount} symbol entries:`);

import { generateParser } from "../../../packages/dsl/src/codegen/parser/parser.js";
import { modelicaLanguage } from "../src/language.js";

const { grammar, table } = generateParser(modelicaLanguage);
const symNames: string[] = [];
for (const [sym, id] of grammar.symToInt.entries()) {
  symNames[id] = sym;
}

console.log(`Symbol 11 is: "${symNames[11]}"`);
console.log(`Symbol 264 is: "${symNames[264]}"`);
for (const p of grammar.productions) {
  if (p.left === symNames[264]) {
    console.log(`  Prod ${p.id}: ${p.left} -> ${p.right.join(" ")} (len: ${p.right.length})`);
  }
}
const prod210 = grammar.productions.find((p) => p.id === 210);
console.log(`Production 210 is: ${prod210?.left} -> ${prod210?.right.join(" ")}`);

console.log("State 280 GOTOs:");
const gotos280 = table.gotoTable.get(280);
if (gotos280) {
  for (const [sym, target] of gotos280.entries()) {
    console.log(`  GOTO on ${sym} -> State ${target}`);
  }
}

let idx = offset + 1;
for (let j = 0; j < actionCount; j++) {
  const sym = actionData[idx++];
  const actCount = actionData[idx++];
  const acts = [];
  for (let a = 0; a < actCount; a++) {
    const aType = actionData[idx++];
    const aTarget = actionData[idx++];
    const targetDesc =
      aType === 1
        ? `prod ${aTarget}: ${grammar.productions.find((p) => p.id === aTarget)?.left} -> ${grammar.productions.find((p) => p.id === aTarget)?.right.join(" ")}`
        : `state ${aTarget}`;
    acts.push({ type: aType === 0 ? "SHIFT" : aType === 1 ? "REDUCE" : "ACCEPT", target: aTarget, targetDesc });
  }
  console.log(`  Symbol ${sym} (${symNames[sym]}):`, acts);
}
