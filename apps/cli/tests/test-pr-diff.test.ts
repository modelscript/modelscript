// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

describe("Visual PR Diff CLI Suite", () => {
  const cliPath = path.resolve(import.meta.dirname, "../dist/main.js");
  const testSysml = path.resolve(import.meta.dirname, "../../../languages/sysml2/test_doc.sysml");
  const outDir = path.resolve(import.meta.dirname, "scratch_pr_diff");

  test.before(() => {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  });

  test.after(() => {
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("1. msc diff generates valid standalone visual-html file", () => {
    const outFile = path.join(outDir, "diff.html");
    const cmd = `node "${cliPath}" diff "${testSysml}" "${testSysml}" --format visual-html --output "${outFile}"`;
    const out = execSync(cmd, { encoding: "utf-8" });

    assert.ok(out.includes("Visual Diff HTML generated"), "Should log successful generation message");
    assert.ok(fs.existsSync(outFile), "Output HTML file must exist on disk");

    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("<!DOCTYPE html>"), "Must be a valid HTML5 document");
    assert.ok(content.includes("Unified Overlay"), "Must have Unified view switcher");
    assert.ok(content.includes("Side-by-Side"), "Must have Side-by-Side view switcher");
    assert.ok(content.includes("<svg"), "Must embed vector SVG diagram");
  });

  test("2. msc diff generates valid standalone visual-svg file", () => {
    const outFile = path.join(outDir, "diff.svg");
    const cmd = `node "${cliPath}" diff "${testSysml}" "${testSysml}" --format visual-svg --output "${outFile}"`;
    const out = execSync(cmd, { encoding: "utf-8" });

    assert.ok(out.includes("Visual Diff SVG generated"), "Should log successful SVG generation message");
    assert.ok(fs.existsSync(outFile), "Output SVG file must exist on disk");

    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.startsWith("<?xml"), "Must start with XML declaration");
    assert.ok(content.includes("<svg"), "Must have SVG root element");
  });

  test("3. msc diff generates GitHub PR review comment markdown", () => {
    const outFile = path.join(outDir, "pr-comment.md");
    const cmd = `node "${cliPath}" diff "${testSysml}" "${testSysml}" --format pr-comment --output "${outFile}"`;
    execSync(cmd, { encoding: "utf-8" });

    assert.ok(fs.existsSync(outFile), "PR comment file must exist on disk");
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("ModelScript Visual Diff:"), "Must contain summary title");
    assert.ok(content.includes("| Added | Deleted | Modified |"), "Must contain markdown metrics table");
  });

  test("4. msc pr-diff --help prints comprehensive documentation", () => {
    const cmd = `node "${cliPath}" pr-diff --help`;
    const out = execSync(cmd, { encoding: "utf-8" });

    assert.ok(out.includes("Compute visual and semantic pull request diff"), "Should describe pr-diff command");
    assert.ok(out.includes("--base"), "Should document --base option");
    assert.ok(out.includes("--head"), "Should document --head option");
    assert.ok(out.includes("visual-html"), "Should document visual-html choice");
  });
});
