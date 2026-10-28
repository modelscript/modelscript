// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { detectCyclesInAdjacencyMap } from "./check-nx-cycles.js";
import { getWorkspaceDirs, getWorkspacePackages, shouldExcludeRepoPath } from "./lib/workspaces.ts";
import { checkFile } from "./lint-filenames.ts";
import { generateDockerfileManifestCopies, getExpectedMetadata } from "./lint-package-manifests.ts";
import { analyzeFileContent } from "./lint-type-safety-ratchet.ts";
import { runRepoDoctor, runRepoDoctorAsync } from "./repo-doctor.ts";
import { CORE_PACK_TARGETS, ESM_IMPORT_TARGETS, isIncludedByFilesWhitelist } from "./verify-pack-install.ts";

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

// 4. Publishable files whitelist globstar matching & core SDK pack/ESM targets
{
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/index.js", ["dist"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/main.js", ["dist/**/*.js"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./dist/nested/sub/file.js", ["dist/**/*.js"]), true);
  assert.strictEqual(isIncludedByFilesWhitelist("./src/index.ts", ["dist"]), false);
  assert.strictEqual(isIncludedByFilesWhitelist("README.md", ["dist"]), true);

  for (const sdkPkg of [
    "packages/dsl",
    "packages/runtime",
    "packages/simulate",
    "packages/cad",
    "packages/exchange",
    "packages/mcp",
    "packages/diagram",
    "packages/lsp",
    "languages/modelica",
  ]) {
    assert.ok(CORE_PACK_TARGETS.includes(sdkPkg), `Expected CORE_PACK_TARGETS to include ${sdkPkg}`);
    assert.ok(ESM_IMPORT_TARGETS.includes(sdkPkg), `Expected ESM_IMPORT_TARGETS to include ${sdkPkg}`);
  }
  assert.ok(CORE_PACK_TARGETS.includes("apps/cli"), "Expected CORE_PACK_TARGETS to include apps/cli");
}

// 5. Shared workspace discovery & exclusion helpers
{
  const allPackages = getWorkspacePackages();
  const noExamplePackages = getWorkspacePackages({ excludeExamples: true, excludeIdeGithubFs: true });
  assert.ok(allPackages.length > noExamplePackages.length);
  const dirs = getWorkspaceDirs();
  assert.ok(dirs.includes("packages/runtime"));
  assert.ok(dirs.includes("languages/modelica"));
  assert.ok(dirs.includes("ee"));
  assert.strictEqual(shouldExcludeRepoPath("languages/modelica/src-gen/bindings.js"), true);
  assert.strictEqual(shouldExcludeRepoPath("packages/runtime/src/index.ts"), false);

  const dockerCopies = generateDockerfileManifestCopies(allPackages);
  assert.ok(dockerCopies.includes("COPY packages/runtime/package.json packages/runtime/"));
  assert.ok(dockerCopies.includes("COPY languages/modelica/package.json languages/modelica/"));
}

// 6. Directed graph cycle detector & fast in-process repo-doctor
{
  const acyclic = new Map([
    ["a", ["b", "c"]],
    ["b", ["c"]],
    ["c", []],
  ]);
  assert.deepStrictEqual(detectCyclesInAdjacencyMap(acyclic), []);

  const cyclic = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["a"]],
  ]);
  const detected = detectCyclesInAdjacencyMap(cyclic);
  assert.strictEqual(detected.length, 1);
  assert.deepStrictEqual(detected[0], ["a", "b", "c", "a"]);

  const doctorRes = runRepoDoctor({ skipLockfile: true, skipCycles: true });
  assert.strictEqual(doctorRes.passed, true);
  assert.strictEqual(doctorRes.results.length, 4);

  const asyncDoctorRes = await runRepoDoctorAsync({ skipLockfile: true, skipCycles: true });
  assert.strictEqual(asyncDoctorRes.passed, true);
  assert.strictEqual(asyncDoctorRes.results.length, 4);
}

console.log("All repo-hygiene unit tests passed!");
