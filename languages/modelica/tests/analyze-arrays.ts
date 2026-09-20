import * as fs from "fs";

const data = JSON.parse(fs.readFileSync("ctrf/ctrf-testsuite-report.json", "utf-8"));
const tests = data.results.tests;

const failed = tests.filter((t: any) => t.status === "failed");
console.log(`Total failed: ${failed.length}`);

const categories: Record<string, string[]> = {
  "Flattening returned null": [],
  "Diagnostic mismatch": [],
  "Output mismatch": [],
  Other: [],
};

for (const t of failed) {
  const msg = t.message || "";
  if (msg.includes("Flattening returned null")) {
    categories["Flattening returned null"].push(`${t.name}:\n${msg}`);
  } else if (msg.includes("Diagnostic mismatch")) {
    categories["Diagnostic mismatch"].push(t.name);
  } else if (msg.includes("Output mismatch")) {
    categories["Output mismatch"].push(t.name);
  } else {
    categories["Other"].push(`${t.name}: ${msg.slice(0, 100)}`);
  }
}

for (const [cat, list] of Object.entries(categories)) {
  console.log(`\n=== ${cat} (${list.length}) ===`);
  list.forEach((item) => console.log(`  - ${item}`));
}
