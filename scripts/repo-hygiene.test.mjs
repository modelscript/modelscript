// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { checkFile } from "./lint-filenames.ts";
import { getExpectedMetadata } from "./lint-package-manifests.ts";
import { analyzeFileContent } from "./lint-type-safety-ratchet.ts";
import { isIncludedByFilesWhitelist } from "./verify-pack-install.ts";

// 1. Type-safety ratchet AST/regex analyzer
{
  const source = `
    // SPDX-License-Identifier: AGPL-3.0-or-later
    export function demo(x: any, y: Record<string, any>): Promise<any> {
      // Ignored comment with : any inside a line comment should not count
      /* Multi-line block comment with : any and as any
         should also be ignored */
      // @ts-expect-error -- intentional narrowing test
      const z = x as any;
      return Promise.resolve([z, y]);
    }
  `;
  const stats = analyzeFileContent(source);
  assert.strictEqual(stats.explicitAny, 4);
  assert.strictEqual(stats.tsComments, 1);
}

// 2. Package maturity metadata classification
{
  assert.deepStrictEqual(getExpectedMetadata("packages/runtime"), {
    tier: "stable",
    category: "core",
  });
  assert.deepStrictEqual(getExpectedMetadata("apps/cli"), {
    tier: "stable",
    category: "app",
  });
  assert.deepStrictEqual(getExpectedMetadata("packages/examples/rc-circuit"), {
    tier: "stable",
    category: "example",
  });
  assert.deepStrictEqual(getExpectedMetadata("languages/modelica"), {
    tier: "stable",
    category: "language",
  });
  assert.deepStrictEqual(getExpectedMetadata("languages/simulink"), {
    tier: "beta",
    category: "language",
  });
  assert.deepStrictEqual(getExpectedMetadata("languages/touchstone"), {
    tier: "preview",
    category: "language",
  });
  // Windows path separator normalization
  assert.deepStrictEqual(getExpectedMetadata("languages\\modelica"), {
    tier: "stable",
    category: "language",
  });
}

// 3. Cross-OS filename hygiene checks
{
  assert.deepStrictEqual(checkFile("packages/lsp/src/services/hover-service.ts"), []);
  const badLsp = checkFile("packages\\lsp\\src\\services\\hoverService.ts");
  assert.strictEqual(badLsp.length, 1);
  assert.strictEqual(badLsp[0].rule, "kebab-case-lsp-services-utils");

  const badTest = checkFile("packages/runtime/tests/test-foo.test.ts");
  assert.strictEqual(badTest.length, 1);
  assert.strictEqual(badTest[0].rule, "no-redundant-test-prefix");
}

// 4. Publishable files whitelist globstar matching
{
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/index.js", ["dist"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/main.js", ["dist/**/*.js"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/nested/sub/file.js", ["dist/**/*.js"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./src/index.ts", ["dist"]), false);
  assert.strictEqual(isIncludedByFilesWhitelist("README.md", ["dist"]), true);
}

console.log("All repo-hygiene unit tests passed!");
