// SPDX-License-Identifier: AGPL-3.0-or-later

process.on("message", (data) => {
  const mode = data.mode || "success";

  if (mode === "hang") {
    // Hang indefinitely without output
    setInterval(() => {}, 60000);
    return;
  }

  if (mode === "stalled-inactivity") {
    // Hang without output for long enough to trigger inactivity watchdog
    setInterval(() => {}, 60000);
    return;
  }

  if (mode === "crash") {
    process.send?.({ type: "error", error: "Simulated worker crash" });
    process.exit(1);
  }

  if (mode === "oom") {
    if (!data.skipSvg) {
      // Simulate Out of Memory via SIGABRT / code 134
      process.stderr.write(
        "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\n",
      );
      process.exit(134);
    } else {
      // Succeeded in degraded mode!
      process.send?.({ type: "complete", classesProcessed: 10 });
      process.exit(0);
    }
  }

  if (mode === "slow-progress") {
    // Immediately report initial progress upon worker startup
    let processed = 10;
    process.send?.({ type: "progress", classesProcessed: processed });
    const interval = setInterval(() => {
      processed += 10;
      process.send?.({ type: "progress", classesProcessed: processed });
      if (processed >= 40) {
        clearInterval(interval);
        process.send?.({ type: "complete", classesProcessed: processed });
        process.exit(0);
      }
    }, 150);
    return;
  }

  if (mode === "success") {
    process.send?.({ type: "progress", classesProcessed: 20 });
    process.send?.({ type: "complete", classesProcessed: 42 });
    process.exit(0);
  }
});
