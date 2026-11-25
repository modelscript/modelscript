// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../src");

describe("@modelscript/design-tokens", () => {
  it("ships required CSS token sheets with --ms-* custom properties", () => {
    for (const file of ["tokens.css", "tokens-web.css", "tokens-vscode.css", "components.css"]) {
      const fullPath = path.join(SRC_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Expected stylesheet ${file} to exist`);
      const css = fs.readFileSync(fullPath, "utf-8");
      assert.ok(css.length > 0, `Expected ${file} to be non-empty`);
    }

    const tokensCss = fs.readFileSync(path.join(SRC_DIR, "tokens.css"), "utf-8");
    assert.match(tokensCss, /--ms-/);
  });
});
