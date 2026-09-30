// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  getSafePackageSource,
  LARGEST_MSL_FILE_SIZE,
  SAFE_PACKAGE_SIZE_LIMIT,
  SAFE_PACKAGE_SIZE_MULTIPLIER,
} from "../src/vfs/library-loader.js";

describe("Safe Package Size Limit", () => {
  it("should have correct constants based on MSL largest file", () => {
    assert.strictEqual(LARGEST_MSL_FILE_SIZE, 649_910);
    assert.strictEqual(SAFE_PACKAGE_SIZE_MULTIPLIER, 3);
    assert.strictEqual(SAFE_PACKAGE_SIZE_LIMIT, 649_910 * 3);
  });

  it("should not truncate files below SAFE_PACKAGE_SIZE_LIMIT", () => {
    const pkgSource = `
package MyPackage
  model M1
    Real x;
  end M1;
  model M2
    Real y;
  end M2;
end MyPackage;
`;
    const result = getSafePackageSource(pkgSource, "/lib/MyPackage/package.mo");
    assert.strictEqual(result, pkgSource);
  });

  it("should warn user in VS Code and truncate when file exceeds SAFE_PACKAGE_SIZE_LIMIT", () => {
    const notifications: { method: string; params: any }[] = [];
    const warnings: string[] = [];
    const dummyCtx: any = {
      connectionState: {
        sendNotification: (method: string, params: any) => {
          notifications.push({ method, params });
        },
      },
      logger: {
        warn: (msg: string) => warnings.push(msg),
        log: () => {},
        error: () => {},
      },
    };

    // Construct a package source exceeding SAFE_PACKAGE_SIZE_LIMIT (~1.95MB)
    const padding = " ".repeat(SAFE_PACKAGE_SIZE_LIMIT + 100);
    const hugePkg = `package HugePackage${padding}
  model NestedModel
    Real z;
  end NestedModel;
end HugePackage;`;

    const result = getSafePackageSource(hugePkg, "/lib/HugePackage/package.mo", dummyCtx);

    // Should be truncated to header + end
    assert.ok(result.includes("package HugePackage"));
    assert.ok(result.includes("end HugePackage;"));
    assert.ok(!result.includes("model NestedModel"));

    // Should have sent warning notification to VS Code
    assert.ok(
      notifications.some((n) => n.method === "window/showMessage" && n.params.type === 2),
      "Should send window/showMessage warning notification",
    );
    assert.ok(
      notifications.some(
        (n) => n.method === "modelscript/warning" && n.params.message.includes("exceeds the safe limit"),
      ),
      "Should send modelscript/warning notification",
    );
    assert.strictEqual(warnings.length, 1);
  });
});
