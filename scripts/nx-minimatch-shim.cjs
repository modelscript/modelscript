// SPDX-License-Identifier: AGPL-3.0-or-later

// Compatibility shim for Nx 22 with minimatch v11+:
// minimatch v11 replaced RegExp generation (`makeRe`) with @isaacs/nonrecursive-glob-match.
// Nx 22 calls `minimatch.makeRe(pattern, options).test(item)` in `find-matching-projects.js`
// and `repository-git-tags.js`. This shim provides a compatible `.test(item)` object.
const m = require("minimatch");
if (m && typeof m.minimatch === "function" && !m.minimatch.makeRe) {
  m.minimatch.makeRe = (pattern, options) => ({
    test: (item) => m.minimatch(String(item), pattern, options),
  });
}
