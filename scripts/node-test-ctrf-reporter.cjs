// scripts/node-test-ctrf-reporter.cjs
// Zero-dependency Common Test Report Format (CTRF) reporter for Node.js native test runner (node:test)
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function* ctrfReporter(source) {
  const startTime = Date.now();
  const tests = [];
  const suiteStack = [];

  let packageName = "node-test";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
    if (pkg.name) packageName = pkg.name;
  } catch {}

  for await (const event of source) {
    const { type, data } = event;

    if (type === "test:start") {
      if (data && data.name) {
        suiteStack[data.nesting] = data.name;
        suiteStack.length = data.nesting + 1;
      }
    } else if (type === "test:pass" || type === "test:fail") {
      if (!data) continue;

      // In node:test, suites have details.type === 'suite'
      const isSuite = data.details?.type === "suite";
      if (!isSuite && data.name) {
        const duration = Math.round(data.details?.duration_ms ?? 0);
        const suitePath = suiteStack.slice(0, data.nesting).filter(Boolean).join(" > ");
        const filePath = data.file ? path.relative(process.cwd(), data.file) : "";

        let status = "passed";
        if (type === "test:fail") {
          status = "failed";
        } else if (data.skip) {
          status = "skipped";
        } else if (data.todo) {
          status = "pending";
        }

        const testEntry = {
          name: data.name,
          status,
          duration,
          filePath,
          suite: suitePath,
          type: "unit",
          retries: 0,
          flaky: false,
        };

        if (status === "failed") {
          const err = data.details?.error;
          testEntry.message = err?.message || "Test failed";
          testEntry.trace = err?.stack || "";
        }

        tests.push(testEntry);
      }
    }
  }

  const stopTime = Date.now();
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const pending = tests.filter((t) => t.status === "pending").length;

  const ctrfReport = {
    results: {
      tool: {
        name: packageName,
      },
      summary: {
        tests: tests.length,
        passed,
        failed,
        pending,
        skipped,
        other: 0,
        start: startTime,
        stop: stopTime,
      },
      tests,
    },
  };

  const outputDir = process.env.CTRF_OUTPUT_DIR
    ? path.resolve(process.env.CTRF_OUTPUT_DIR)
    : path.resolve(process.cwd(), "ctrf");
  const outputPath = process.env.CTRF_OUTPUT_PATH
    ? path.resolve(process.env.CTRF_OUTPUT_PATH)
    : path.join(outputDir, "ctrf-report.json");

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(ctrfReport, null, 2), "utf-8");
  } catch (err) {
    console.error("[ctrf-reporter] Failed to write CTRF report:", err);
  }
};
