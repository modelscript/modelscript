// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSysmlSource } from "../src/formatter.js";

describe("SysML v2 / KerML Document Formatter", () => {
  it("formats unaligned SysML v2 source with accurate indentation and token spacing", () => {
    const unformatted = `
package MySystem{
private import ScalarValues::*;
part def Motor{
attribute mass:Real=0.5[kg];
in port p:PowerPort;
assert constraint{mass<=1.0}
}
}
    `.trim();

    const formatted = formatSysmlSource(unformatted, { tabSize: 2 });
    const expected = `
package MySystem {
  private import ScalarValues::*;
  part def Motor {
    attribute mass : Real = 0.5 [kg];
    in port p : PowerPort;
    assert constraint { mass<=1.0 }
  }
}
    `.trim();

    assert.equal(formatted, expected);
  });

  it("preserves multi-line block comments and inline comments without altering brace depth", () => {
    const codeWithComments = `
package Commented {
  /*
   * This is a multi-line comment containing { braces }
   */
  part def Component {
    attribute x : Real = 1.0; // inline comment with { brace
  }
}
    `.trim();

    const formatted = formatSysmlSource(codeWithComments, { tabSize: 2 });
    assert.ok(formatted.includes("* This is a multi-line comment containing { braces }"));
    assert.ok(formatted.includes("attribute x : Real = 1.0; // inline comment with { brace"));
    assert.ok(formatted.endsWith("}"));
  });

  it("supports range formatting for targeted edits", () => {
    const source = [
      "package RangeTest {",
      "part def A {",
      "attribute a : Real = 1.0;",
      "}",
      "part def B {",
      "attribute b : Real = 2.0;",
      "}",
      "}",
    ].join("\n");

    // Only format lines 4-6 (part def B)
    const formatted = formatSysmlSource(source, {
      tabSize: 4,
      startLine: 4,
      endLine: 6,
    });

    const lines = formatted.split("\n");
    // lines 1-3 should remain with original indentation
    assert.equal(lines[1], "part def A {");
    assert.equal(lines[2], "attribute a : Real = 1.0;");
  });
});
