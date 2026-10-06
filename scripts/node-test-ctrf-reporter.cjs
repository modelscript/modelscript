// SPDX-License-Identifier: AGPL-3.0-or-later

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

  const suiteErrors = new Map();

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
      if (isSuite) {
        if (type === "test:fail") {
          const suitePath = suiteStack.slice(0, data.nesting + 1).filter(Boolean).join(" > ") || data.name;
          const err = data.details?.error;
          let errMsg = err?.message || "Suite failed";
          if (err?.cause) {
            const causeMsg = err.cause?.message || String(err.cause);
            if (causeMsg && !errMsg.includes(causeMsg)) {
              errMsg = `${errMsg} (${causeMsg})`;
            }
          }
          let errTrace = err?.stack || "";
          if (err?.cause?.stack && !errTrace.includes(err.cause.stack)) {
            errTrace = `${err.cause.stack}\n\n${errTrace}`;
          }
          const suiteErr = {
            message: errMsg,
            trace: errTrace,
          };
          suiteErrors.set(suitePath, suiteErr);

          // Retroactively enrich any child tests under this suite that were cancelled
          let matchedChildCount = 0;
          for (const t of tests) {
            if (t.suite === suitePath || t.suite.startsWith(suitePath + " > ")) {
              matchedChildCount++;
              if (t.status === "failed" && t.message.includes("test did not finish before its parent and was cancelled")) {
                t.message = `Parent suite '${suitePath}' failed: ${suiteErr.message}`;
                if (suiteErr.trace) t.trace = `${suiteErr.trace}\n\n${t.trace}`;
              }
            }
          }

          // If no child tests exist at all, record a failure for the suite setup
          if (matchedChildCount === 0 && data.name) {
            tests.push({
              name: `${data.name} (suite setup)`,
              status: "failed",
              duration: Math.round(data.details?.duration_ms ?? 0),
              filePath: data.file ? path.relative(process.cwd(), data.file) : "",
              suite: suitePath,
              type: "unit",
              retries: 0,
              flaky: false,
              message: suiteErr.message,
              trace: suiteErr.trace,
            });
          }
        }
      } else if (data.name) {
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
          let msg = err?.message || "Test failed";
          if (err?.cause) {
            const causeMsg = err.cause?.message || String(err.cause);
            if (causeMsg && !msg.includes(causeMsg)) {
              msg = `${msg} (${causeMsg})`;
            }
          }
          let trace = err?.stack || "";
          if (err?.cause?.stack && !trace.includes(err.cause.stack)) {
            trace = `${err.cause.stack}\n\n${trace}`;
          }

          // Check if a parent suite error was already recorded
          const parentErr = suiteErrors.get(suitePath);
          if (parentErr && msg.includes("test did not finish before its parent and was cancelled")) {
            msg = `Parent suite '${suitePath}' failed: ${parentErr.message}`;
            if (parentErr.trace) trace = `${parentErr.trace}\n\n${trace}`;
          }

          testEntry.message = msg;
          testEntry.trace = trace;
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

    if (packageName && packageName !== "node-test") {
      const pkgSafeName = packageName.replace(/[@/]/g, "-").replace(/^-+/, "");
      const namedPath = path.join(outputDir, `ctrf-${pkgSafeName}.json`);
      if (namedPath !== outputPath) {
        fs.writeFileSync(namedPath, JSON.stringify(ctrfReport, null, 2), "utf-8");
      }
    }
  } catch (err) {
    console.error("[ctrf-reporter] Failed to write CTRF report:", err);
  }
};
