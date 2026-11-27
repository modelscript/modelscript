// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { resolveExpectedSha256, resolveUpdateUrl, verifySha256 } from "../src/download-vscode.js";

describe("download-vscode SHA-256 verification and commit pinning", () => {
  it("resolves latest update URL by default and pinned commit URL when VSCODE_WEB_COMMIT is set", () => {
    assert.strictEqual(
      resolveUpdateUrl(),
      "https://update.code.visualstudio.com/api/update/web-standalone/stable/latest",
    );

    const commit = "0123456789abcdef0123456789abcdef01234567";
    assert.strictEqual(
      resolveUpdateUrl(commit),
      `https://update.code.visualstudio.com/api/versions/commit:${commit}/web-standalone/stable`,
    );

    assert.throws(() => resolveUpdateUrl("../bad-commit"), /Invalid VSCODE_WEB_COMMIT/);
    assert.throws(() => resolveUpdateUrl("abc"), /Invalid VSCODE_WEB_COMMIT/);
  });

  it("resolves expected SHA-256 from API metadata or VSCODE_WEB_SHA256 override", () => {
    const apiHash = "A".repeat(64);
    const overrideHash = "b".repeat(64);

    assert.strictEqual(resolveExpectedSha256({ sha256hash: apiHash }), "a".repeat(64));
    assert.strictEqual(resolveExpectedSha256({ sha256hash: apiHash }, overrideHash), overrideHash);
    assert.strictEqual(resolveExpectedSha256({}, overrideHash), overrideHash);

    assert.throws(() => resolveExpectedSha256({}), /did not include sha256hash/);
    assert.throws(() => resolveExpectedSha256({ sha256hash: "not-a-hash" }), /Invalid sha256hash/);
    assert.throws(() => resolveExpectedSha256({ sha256hash: apiHash }, "short"), /Invalid VSCODE_WEB_SHA256/);
  });

  it("verifies tarball buffer SHA-256 digest and throws loudly on mismatch", () => {
    const payload = Buffer.from("vscode-web-tarball-content", "utf8");
    const expected = createHash("sha256").update(payload).digest("hex");

    assert.strictEqual(verifySha256(payload, expected.toUpperCase()), expected);

    const wrongHash = "0".repeat(64);
    assert.throws(() => verifySha256(payload, wrongHash), /SHA-256 checksum mismatch/);
  });
});
