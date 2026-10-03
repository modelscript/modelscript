// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Regression test: grammar-declared comment tokens (OWL2 `#…`) are "extras" that the
 * parser skips. When a comment is preceded by whitespace, skipping must resume from the
 * token start reported by the lexer, otherwise the lexer restarts inside the comment
 * and the rest of the document is corrupted.
 */

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

const base = `Prefix(: = <http://example.org/e#>)
Ontology(
  Declaration(Class(:A))
COMMENT  Declaration(Class(:B))
)`;

function parseInfo(src: string): { hasError: boolean; text: string } {
  const root: any = parser.parse(src)!.rootNode;
  const hasError = typeof root.hasError === "function" ? root.hasError() : !!root.hasError;
  return { hasError, text: String(root.toString()) };
}

describe("OWL2 comment extras", () => {
  const reference = parseInfo(base.replace("COMMENT", ""));

  it("parses the reference document without errors", () => {
    assert.strictEqual(reference.hasError, false);
  });

  for (const [label, comment] of [
    ["comment at column 0", "#abcdef\n"],
    ["comment after 1 space", " #abcdef\n"],
    ["comment after 3 spaces containing a keyword", "   #xyz Class\n"],
    ["two consecutive comments", "  # one\n  # two\n"],
  ] as const) {
    it(label, () => {
      const info = parseInfo(base.replace("COMMENT", comment));
      assert.strictEqual(info.hasError, false, "tree must not contain errors");
      assert.strictEqual(info.text, reference.text, "comment must not change the tree");
    });
  }

  it("incremental edit after a comment matches fresh parse", () => {
    const oldSrc = base.replace("COMMENT", "  # note\n");
    const newSrc = oldSrc.replace(":B", ":Bee");
    const at = oldSrc.indexOf(":B") + 2;
    const oldTree = parser.parse(oldSrc);
    const inc: any = parser.parse(newSrc, oldTree, at, at, at + 2)!.rootNode;
    const fresh: any = parser.parse(newSrc)!.rootNode;
    assert.strictEqual(String(inc.toString()), String(fresh.toString()));
  });
});
