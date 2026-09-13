import assert from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "scratch_diff_test");
fs.mkdirSync(dir, { recursive: true });

const fileOld = path.join(dir, "MotorOld.mo");
const fileNew = path.join(dir, "MotorNew.mo");

// Baseline Modelica model
fs.writeFileSync(
  fileOld,
  `model Motor
  parameter Real R = 10;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
equation
  p.v - n.v = R * p.i;
end Motor;`,
);

// Modified Modelica model:
// - R variability updated (parameter -> continuous)
// - Added component C1
// - Deleted NegativePin n (Breaking)
fs.writeFileSync(
  fileNew,
  `model Motor
  Real R = 10;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Real C1;
equation
  p.v = R * p.i;
end Motor;`,
);

console.log("Testing msc diff with terminal output...");
const outTerminal = execSync(`node apps/cli/dist/main.js diff ${fileOld} ${fileNew}`, { encoding: "utf8" });
console.log(outTerminal);

assert.ok(outTerminal.includes("+ [INSERT]"));
assert.ok(outTerminal.includes("- [DELETE]"));
assert.ok(outTerminal.includes("BREAKING"));

console.log("Testing msc diff with JSON output...");
const outJsonStr = execSync(`node apps/cli/dist/main.js diff ${fileOld} ${fileNew} --format json`, {
  encoding: "utf8",
});
const outJson = JSON.parse(outJsonStr);

assert.strictEqual(outJson.summary.inserted, 1);
assert.strictEqual(outJson.summary.deleted, 1);
assert.strictEqual(outJson.summary.breaking, 1);
assert.strictEqual(outJson.changes.length >= 2, true);

console.log("Testing msc diff --breaking-only exit code...");
let exitCode = 0;
try {
  execSync(`node apps/cli/dist/main.js diff ${fileOld} ${fileNew} --breaking-only`, { stdio: "pipe" });
} catch (e: any) {
  exitCode = e.status;
}
assert.strictEqual(exitCode, 1); // Should exit with code 1 due to breaking changes

// Cleanup scratch test files
fs.rmSync(dir, { recursive: true, force: true });

console.log("All CLI Semantic Diff integration tests passed!");
