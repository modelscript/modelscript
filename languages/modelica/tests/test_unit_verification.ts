import assert from "node:assert";
import { performance } from "node:perf_hooks";
import { checkEquationUnits, parseUnit, unitsCompatible } from "../src/units.js";

console.log("================================================================================");
console.log("ModelScript Physical Unit & Dimensional Consistency Verification Benchmark");
console.log("================================================================================");

interface UnitTestCase {
  name: string;
  unitA: string;
  unitB: string;
  expectedCompatible: boolean;
  category: "Base SI" | "Derived Electrical" | "Mechanical/Thermal" | "Cross-Domain Incompatible";
}

const testCases: UnitTestCase[] = [
  // 1. Compatible Base & Derived Units
  {
    name: "Voltage Equivalence (V vs W/A)",
    unitA: "V",
    unitB: "W/A",
    expectedCompatible: true,
    category: "Derived Electrical",
  },
  {
    name: "Power Equivalence (W vs J/s)",
    unitA: "W",
    unitB: "J/s",
    expectedCompatible: true,
    category: "Mechanical/Thermal",
  },
  {
    name: "Force from Mass * Acceleration (N vs kg.m/s2)",
    unitA: "N",
    unitB: "kg.m/s2",
    expectedCompatible: true,
    category: "Mechanical/Thermal",
  },
  {
    name: "Ohm's Law Resistance (Ohm vs V/A)",
    unitA: "Ohm",
    unitB: "V/A",
    expectedCompatible: true,
    category: "Derived Electrical",
  },
  { name: "Frequency (Hz vs 1/s)", unitA: "Hz", unitB: "1/s", expectedCompatible: true, category: "Base SI" },

  // 2. Cross-Domain Incompatible Conflicts
  {
    name: "Electrical Potential vs Power (V vs W)",
    unitA: "V",
    unitB: "W",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
  {
    name: "Mechanical Force vs Pressure (N vs Pa)",
    unitA: "N",
    unitB: "Pa",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
  {
    name: "Angular Velocity vs Frequency (rad/s vs Hz)",
    unitA: "rad/s",
    unitB: "Hz",
    expectedCompatible: true,
    category: "Mechanical/Thermal",
  },
  {
    name: "Torque vs Electrical Current (N.m vs A)",
    unitA: "N.m",
    unitB: "A",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
  {
    name: "Velocity vs Acceleration (m/s vs m/s2)",
    unitA: "m/s",
    unitB: "m/s2",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
  {
    name: "Thermal Resistance vs Heat Flux (K/W vs W/m2)",
    unitA: "K/W",
    unitB: "W/m2",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
  {
    name: "Battery Pack Potential vs Temperature (V vs K)",
    unitA: "V",
    unitB: "K",
    expectedCompatible: false,
    category: "Cross-Domain Incompatible",
  },
];

let totalEvalTime = 0;
let passedCount = 0;
const iterations = 10000;

console.log("\n1. Unit Dimensional Compatibility Evaluation:");
console.log("--------------------------------------------------------------------------------");
console.log("Test Name                                      | Unit A  | Unit B    | Status  | Result");
console.log("--------------------------------------------------------------------------------");

for (const tc of testCases) {
  const uA = parseUnit(tc.unitA);
  const uB = parseUnit(tc.unitB);
  assert.ok(uA, `Failed to parse unit: ${tc.unitA}`);
  assert.ok(uB, `Failed to parse unit: ${tc.unitB}`);

  const t0 = performance.now();
  const isCompat = unitsCompatible(uA, uB);
  const dt = performance.now() - t0;
  totalEvalTime += dt;

  const check = checkEquationUnits(uA, uB);
  const testPassed = isCompat === tc.expectedCompatible;
  if (testPassed) passedCount++;

  const statusStr = isCompat ? "MATCH" : "CONFLICT";
  const passStr = testPassed ? "PASSED" : "FAILED";
  console.log(
    `${tc.name.padEnd(46)} | ${tc.unitA.padEnd(7)} | ${tc.unitB.padEnd(9)} | ${statusStr.padEnd(7)} | ${passStr}`,
  );
  if (!isCompat) {
    console.log(`    ↳ Diagnostic: "${check.message}"`);
  }
}

console.log("--------------------------------------------------------------------------------");
console.log(`Summary: ${passedCount}/${testCases.length} unit validation rules passed.`);

// Benchmark throughput
const tStart = performance.now();
for (let i = 0; i < iterations; i++) {
  for (const tc of testCases) {
    const uA = parseUnit(tc.unitA);
    const uB = parseUnit(tc.unitB);
    if (uA && uB) {
      unitsCompatible(uA, uB);
    }
  }
}
const tTotal = performance.now() - tStart;
const totalChecks = iterations * testCases.length;
const checksPerSec = Math.round(totalChecks / (tTotal / 1000));

console.log(`\n2. Performance & Throughput:`);
console.log(`  Total Checks: ${totalChecks.toLocaleString()} evaluations in ${tTotal.toFixed(2)} ms`);
console.log(`  Throughput:   ${checksPerSec.toLocaleString()} unit dimensional checks/second`);
console.log(`  Mean Latency: ${((tTotal / totalChecks) * 1000).toFixed(3)} μs per dimensional consistency check`);
console.log("================================================================================");
