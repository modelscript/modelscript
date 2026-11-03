// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeSnippetDiagnostics,
  extractPrimaryConstructInfo,
  formatLanguageFileHeader,
  inferSnippetFilename,
  parseLanguageFileHeader,
  resolveSnippetFilename,
} from "../src/components/compose/snippet-diagnostics";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Compose Code Snippet Modal UI/UX & Compiler Diagnostics", () => {
  it("detects Modelica start/end identifier mismatch (M2005) for 'model X ... end x;' and provides a 1-click quick fix", () => {
    const code = "model X\n\nend x;";
    const diags = analyzeSnippetDiagnostics(code, "modelica");
    assert.equal(diags.length, 1);
    const diag = diags[0]!;
    assert.equal(diag.code, "M2005");
    assert.equal(diag.severity, "error");
    assert.ok(
      diag.message.includes("The identifier at start and end are different ('X' vs 'x')."),
      `Unexpected message: ${diag.message}`,
    );
    assert.equal(diag.startLineNumber, 3);
    assert.equal(diag.startColumn, 5);
    assert.ok(diag.quickFix, "Expected a quickFix for M2005 identifier mismatch");
    assert.equal(diag.quickFix.replacementCode, "model X\n\nend X;");
    assert.equal(analyzeSnippetDiagnostics(diag.quickFix.replacementCode, "modelica").length, 0);
  });

  it("detects unclosed Modelica class definitions (M1002) and provides a quick fix to append end statement", () => {
    const code = "model DampedOscillator\n  parameter Real k = 10.0;";
    const diags = analyzeSnippetDiagnostics(code, "modelica");
    assert.ok(diags.some((d) => d.code === "M1002"));
    const m1002 = diags.find((d) => d.code === "M1002")!;
    assert.ok(m1002.quickFix);
    assert.ok(m1002.quickFix.replacementCode.includes("end DampedOscillator;"));
    assert.equal(analyzeSnippetDiagnostics(m1002.quickFix.replacementCode, "modelica").length, 0);
  });

  it("detects Modelica variable binding type mismatches (M3001) while allowing Integer-to-Real coercion", () => {
    const validCoercion = "model Valid\n  parameter Real R = 100;\nend Valid;";
    assert.equal(analyzeSnippetDiagnostics(validCoercion, "modelica").length, 0);

    const invalidBinding = 'model Invalid\n  Real x = "not_a_number";\n  Integer n = 3.14;\nend Invalid;';
    const diags = analyzeSnippetDiagnostics(invalidBinding, "modelica");
    const m3001s = diags.filter((d) => d.code === "M3001");
    assert.equal(m3001s.length, 2);
    assert.ok(m3001s[0]!.message.includes("expected subtype of Real, got type String"));
    assert.ok(m3001s[1]!.message.includes("expected subtype of Integer, got type Real"));
  });

  it("detects empty array constructors (M1003) and JSON syntax errors", () => {
    const emptyArr = "model Arr\n  Real x[0] = {};\nend Arr;";
    const diags = analyzeSnippetDiagnostics(emptyArr, "modelica");
    assert.ok(diags.some((d) => d.code === "M1003"));

    const badJson = '{\n  "solver": "CVODE",\n}';
    const jsonDiags = analyzeSnippetDiagnostics(badJson, "json");
    assert.equal(jsonDiags.length, 1);
    assert.equal(jsonDiags[0]!.code, "JSON001");
  });

  it("infers filenames from construct declarations and appends missing extensions", () => {
    const code = "model X\n  Real y;\nend X;";
    assert.deepEqual(extractPrimaryConstructInfo(code, "modelica"), { kind: "model", name: "X" });
    assert.equal(inferSnippetFilename(code, "modelica", "mo"), "X.mo");
    assert.equal(resolveSnippetFilename("", code, "modelica", "mo"), "X.mo");
    assert.equal(resolveSnippetFilename("Model1", code, "modelica", "mo"), "Model1.mo");
    assert.equal(resolveSnippetFilename("Custom.mo", code, "modelica", "mo"), "Custom.mo");
  });

  it("formats and parses language-appropriate file comment headers without corrupting JSON", () => {
    assert.equal(formatLanguageFileHeader("Oscillator.mo", "modelica"), "// File: Oscillator.mo\n");
    assert.equal(formatLanguageFileHeader("sim.py", "python"), "# File: sim.py\n");
    assert.equal(formatLanguageFileHeader("run.sh", "bash"), "# File: run.sh\n");
    assert.equal(formatLanguageFileHeader("system.ssp", "ssp"), "<!-- File: system.ssp -->\n");
    assert.equal(formatLanguageFileHeader("config.json", "json"), "");

    assert.deepEqual(parseLanguageFileHeader("# File: sim.py\nimport math"), {
      filename: "sim.py",
      body: "import math",
    });
    assert.deepEqual(parseLanguageFileHeader("// File: Oscillator.mo\nmodel Oscillator\nend Oscillator;"), {
      filename: "Oscillator.mo",
      body: "model Oscillator\nend Oscillator;",
    });
  });

  it("renders Monaco + WASM LSP editor, live diagnostics bar, and unambiguous embed mode selector in ComposeCodeSnippetModal", () => {
    const modalPath = path.resolve(__dirname, "../src/components/compose/ComposeCodeSnippetModal.tsx");
    const modalSrc = fs.readFileSync(modalPath, "utf-8");

    assert.ok(
      modalSrc.includes("LazyCodeEditor"),
      "ComposeCodeSnippetModal must use Monaco/LSP LazyCodeEditor instead of a plain un-highlighted textarea",
    );
    assert.ok(
      !modalSrc.includes('background: "rgba(0, 0, 0, 0.3)"'),
      "ComposeCodeSnippetModal must not hardcode dark-only rgba(0, 0, 0, 0.3) input background in light mode",
    );
    assert.ok(
      modalSrc.includes('data-testid="snippet-diagnostics-bar"'),
      "ComposeCodeSnippetModal must render a live compiler & typecheck diagnostics bar",
    );
    assert.ok(
      modalSrc.includes('data-testid="snippet-quick-fix-btn"'),
      "ComposeCodeSnippetModal must render one-click quick fix actions for fixable compiler errors",
    );
    assert.ok(
      modalSrc.includes('data-testid="snippet-embed-mode-selector"') &&
        modalSrc.includes('data-testid="embed-mode-markdown"') &&
        modalSrc.includes('data-testid="embed-mode-artifact"'),
      "ComposeCodeSnippetModal must provide a clear Embed Mode selector distinguishing Inline Code Block from Interactive Model Card",
    );
    assert.ok(
      modalSrc.includes('data-testid="snippet-cancel-btn"') && modalSrc.includes('data-testid="snippet-submit-btn"'),
      "ComposeCodeSnippetModal must render aligned Cancel and primary Submit buttons",
    );
  });
});
