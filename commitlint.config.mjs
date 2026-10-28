// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getSubdirNames(relDir) {
  const dirPath = path.join(__dirname, relDir);
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

const dynamicScopes = [...getSubdirNames("packages"), ...getSubdirNames("languages"), ...getSubdirNames("apps")];

const allScopes = Array.from(
  new Set(["compiler", "ide-client", "ci", "deps", "repo", "release", "docker", "ee", ...dynamicScopes]),
).sort();

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"],
    ],
    "scope-enum": [1, "always", allScopes],
    "subject-case": [0],
  },
};
