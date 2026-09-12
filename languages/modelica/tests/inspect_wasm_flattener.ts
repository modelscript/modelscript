import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

const src = `
model Simple
  Real x;
  Real y;
equation
  x = 10;
  y = 2 * x;
end Simple;
`;

const tree = parser.parse(src);
function getMem32(): Uint32Array {
  return new Uint32Array(facade.wasmMemory.buffer);
}
function getInBuf(): number {
  return facade.exports.getInputBuffer();
}

// Simulate loc functions
function locPtr(loc: bigint): number {
  return Number(loc & 0xffffffffn);
}
function locOffset(loc: bigint): number {
  return Number(loc >> 32n);
}
function locMake(ptr: number, offset: number): bigint {
  return (BigInt(offset) << 32n) | BigInt(ptr);
}
function locPad(loc: bigint): number {
  const p = locPtr(loc);
  if (p === 0) return 0;
  const w0 = getMem32()[p / 4];
  return w0 >> 22;
}
function locLen(loc: bigint): number {
  const p = locPtr(loc);
  if (p === 0) return 0;
  const w1 = getMem32()[(p + 4) / 4];
  return w1 & 0x7fffff;
}
function locType(loc: bigint): number {
  const p = locPtr(loc);
  if (p === 0) return 0;
  const w0 = getMem32()[p / 4];
  return w0 & 0x3ff;
}
function locFirstChild(loc: bigint): bigint {
  const p = locPtr(loc);
  if (p === 0) return 0n;
  const ch = getMem32()[(p + 12) / 4];
  if (ch === 0) return 0n;
  return locMake(ch, locOffset(loc));
}
function locNextSibling(loc: bigint): bigint {
  const p = locPtr(loc);
  if (p === 0) return 0n;
  const next = getMem32()[(p + 16) / 4];
  if (next === 0) return 0n;
  const nextPad = getMem32()[next / 4] >> 22;
  const offset = locOffset(loc) + locLen(loc) + nextPad;
  return locMake(next, offset);
}
function locText(loc: bigint): string {
  const start = locOffset(loc);
  const len = locLen(loc);
  return new TextDecoder("utf-16le").decode(new Uint8Array(facade.wasmMemory.buffer, getInBuf() + start, len));
}

// Find class
function findClass(loc: bigint, targetName: string): bigint {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === 106) {
      // class_definition
      console.log("Found class_definition:", locText(ch).slice(0, 30));
      return ch;
    }
    const found = findClass(ch, targetName);
    if (found !== 0n) return found;
    ch = locNextSibling(ch);
  }
  return 0n;
}

const rootLoc = locMake(tree.rootNode.ptr, 0);
const classLoc = findClass(rootLoc, "Simple");
console.log("Found class at loc:", classLoc.toString(16));
console.log("Class full text:\n" + locText(classLoc));

// Find components in classLoc
function findComponents(loc: bigint): void {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === 128) {
      // component_clause
      console.log("Component clause text:", locText(ch));
      // find identifier inside
      let decl = locFirstChild(ch);
      while (decl !== 0n) {
        if (locType(decl) === 130) {
          // component_list
          console.log("  Comp list text:", locText(decl));
        }
        decl = locNextSibling(decl);
      }
    }
    findComponents(ch);
    ch = locNextSibling(ch);
  }
}
findComponents(classLoc);

function locFindChild(loc: bigint, type: number): bigint {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === type) return ch;
    ch = locNextSibling(ch);
  }
  return 0n;
}

function locFindDescendant(loc: bigint, type: number): bigint {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === type) return ch;
    const found = locFindDescendant(ch, type);
    if (found !== 0n) return found;
    ch = locNextSibling(ch);
  }
  return 0n;
}

function collectDescendants(loc: bigint, type: number, out: bigint[] = []): bigint[] {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === type) out.push(ch);
    collectDescendants(ch, type, out);
    ch = locNextSibling(ch);
  }
  return out;
}

console.log("=== Testing WASM flattener_flatten ===");
const daePtr = facade.exports.dae_createBuilder(0, 0);
const flattenerPtr = facade.exports.flattener_create(daePtr);
console.log("Created DAE and Flattener:", { daePtr, flattenerPtr });

const classNodePtr = locPtr(classLoc);
console.log("Calling flattener_instantiateClass with classNodePtr:", classNodePtr);
const varCount = facade.exports.flattener_instantiateClass(flattenerPtr, classNodePtr, 0);
console.log("flattener_instantiateClass returned varCount:", varCount);

// Test equation section directly
let eqSecLoc = 0n;
let ch = locFirstChild(classLoc);
while (ch !== 0n) {
  let found = locFindDescendant(ch, 146); // equation_section
  if (found !== 0n) {
    eqSecLoc = found;
    break;
  }
  ch = locNextSibling(ch);
}
console.log("Found eqSecLoc:", eqSecLoc.toString(16), "ptr:", locPtr(eqSecLoc));
if (eqSecLoc !== 0n) {
  console.log("eqSecLoc full text:\n" + locText(eqSecLoc));
  let eqChild = locFirstChild(eqSecLoc);
  while (eqChild !== 0n) {
    console.log(`  eqSec child [${locType(eqChild)}]: "${locText(eqChild)}"`);
    eqChild = locNextSibling(eqChild);
  }
}
console.log("Testing expandConnections...");
const expRes = facade.exports.flattener_expandConnections(flattenerPtr, 0);
console.log("expandConnections returned:", expRes);

console.log("Testing finalizeConnections...");
const finRes = facade.exports.flattener_finalizeConnections(flattenerPtr);
console.log("finalizeConnections returned:", finRes);

console.log("=== Testing Full flattener_flatten ===");
try {
  const dae2 = facade.exports.dae_createBuilder(0, 0);
  const flattener2 = facade.exports.flattener_create(dae2);
  const flatCount = facade.exports.flattener_flatten(flattener2, classNodePtr, 0);
  console.log("flattener_flatten returned flatCount:", flatCount);
  console.log("DAE2 varCount:", facade.exports.dae_getVarCount(dae2));
  console.log("DAE2 eqCount:", facade.exports.dae_getEqCount(dae2));

  for (let i = 0; i < facade.exports.dae_getVarCount(dae2); i++) {
    const nameId = facade.exports.dae_getVarNameId(dae2, i);
    const varType = facade.exports.dae_getVarType(dae2, i);
    console.log(`Var ${i}: nameId=${nameId}, type=${varType}`);
  }

  for (let i = 0; i < facade.exports.dae_getEqCount(dae2); i++) {
    const kind = facade.exports.dae_getEqKind(dae2, i);
    const lhs = facade.exports.dae_getEqLhs(dae2, i);
    const rhs = facade.exports.dae_getEqRhs(dae2, i);
    console.log(`Eq ${i}: kind=${kind}, lhs=${lhs}, rhs=${rhs}`);
  }
} catch (err) {
  console.error("Error in flattener_flatten:", err);
}

console.log("\n=== Testing Circuit with connectors and hierarchy ===");
const circuitSrc = `
connector Pin
  Real v;
  flow Real i;
end Pin;

model Resistor
  Pin p;
  Pin n;
  parameter Real R = 10;
equation
  p.v - n.v = R * p.i;
  p.i + n.i = 0;
end Resistor;

model Circuit
  Resistor r1;
  Resistor r2;
equation
  connect(r1.n, r2.p);
end Circuit;
`;

const tree2 = parser.parse(circuitSrc);
const rootLoc2 = locMake(tree2.rootNode.ptr, 0);

function findClassByName(loc: bigint, targetName: string): bigint {
  let ch = locFirstChild(loc);
  while (ch !== 0n) {
    if (locType(ch) === 106) {
      if (locText(ch).includes(targetName)) return ch;
    }
    const found = findClassByName(ch, targetName);
    if (found !== 0n) return found;
    ch = locNextSibling(ch);
  }
  return 0n;
}

const circuitClassLoc = findClassByName(rootLoc2, "Circuit");
console.log("Found Circuit class at loc:", circuitClassLoc.toString(16));

const daeCircuit = facade.exports.dae_createBuilder(0, 0);
const flattenerCircuit = facade.exports.flattener_create(daeCircuit);
const circuitFlatCount = facade.exports.flattener_flatten(
  flattenerCircuit,
  locPtr(circuitClassLoc),
  tree2.rootNode.ptr,
);
console.log("Circuit flatten returned:", circuitFlatCount);
console.log("Circuit DAE varCount:", facade.exports.dae_getVarCount(daeCircuit));
console.log("Circuit DAE eqCount:", facade.exports.dae_getEqCount(daeCircuit));

for (let i = 0; i < facade.exports.dae_getVarCount(daeCircuit); i++) {
  const nameId = facade.exports.dae_getVarNameId(daeCircuit, i);
  const varType = facade.exports.dae_getVarType(daeCircuit, i);
  const flags = facade.exports.dae_getVarFlags(daeCircuit, i);
  console.log(`Circuit Var ${i}: nameId=${nameId}, type=${varType}, flags=${flags}`);
}

for (let i = 0; i < facade.exports.dae_getEqCount(daeCircuit); i++) {
  const kind = facade.exports.dae_getEqKind(daeCircuit, i);
  const lhs = facade.exports.dae_getEqLhs(daeCircuit, i);
  const rhs = facade.exports.dae_getEqRhs(daeCircuit, i);
  console.log(`Circuit Eq ${i}: kind=${kind}, lhs=${lhs}, rhs=${rhs}`);
}
