// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  configureFileIcons,
  getAvailableFileIcons,
  getFileIconPath,
  resetFileIcons,
} from "../src/workbench/util/file-icons.js";

describe("file-icons resolution", () => {
  const originalEnvDir = process.env.MODELSCRIPT_FILE_ICONS_DIR;

  afterEach(() => {
    if (originalEnvDir === undefined) {
      delete process.env.MODELSCRIPT_FILE_ICONS_DIR;
    } else {
      process.env.MODELSCRIPT_FILE_ICONS_DIR = originalEnvDir;
    }
    resetFileIcons();
  });

  it("resolves icons from an explicit icons map via configureFileIcons", () => {
    const map = configureFileIcons({
      icons: {
        Modelica: "modelica.svg",
        spice: "spice.png",
        default: "custom-default.svg",
      },
    });

    assert.equal(map.get("modelica"), "modelica.svg");
    assert.equal(getAvailableFileIcons().get("spice"), "spice.png");
    assert.equal(getFileIconPath("Circuit.mo"), "/file-icons/modelica.svg");
    assert.equal(getFileIconPath("Filter.sp"), "/file-icons/spice.png");
    assert.equal(getFileIconPath("custom.txt", "modelica"), "/file-icons/modelica.svg");
    assert.equal(getFileIconPath("README.unknown"), "/file-icons/custom-default.svg");
  });

  it("rejects unsafe icon filenames and falls back to default.svg", () => {
    configureFileIcons({
      icons: {
        modelica: "../escape.svg",
        default: "../../evil.svg",
      },
    });

    assert.equal(getFileIconPath("Circuit.mo"), "/file-icons/default.svg");
    assert.equal(getFileIconPath("unknown.xyz"), "/file-icons/default.svg");
  });

  it("loads icons from a configured directory and prefers .svg over .png", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-file-icons-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "modelica.png"), "");
      fs.writeFileSync(path.join(tmpDir, "modelica.svg"), "<svg/>");
      fs.writeFileSync(path.join(tmpDir, "sysml2.png"), "");
      fs.writeFileSync(path.join(tmpDir, "default.svg"), "<svg/>");

      configureFileIcons({ iconsDir: tmpDir });

      assert.equal(getFileIconPath("Model.mo"), "/file-icons/modelica.svg");
      assert.equal(getFileIconPath("System.sysml"), "/file-icons/sysml2.png");
      assert.equal(getFileIconPath("Other.foo"), "/file-icons/default.svg");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads MODELSCRIPT_FILE_ICONS_DIR on resetFileIcons and degrades cleanly when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-file-icons-env-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "ampl.svg"), "<svg/>");
      fs.writeFileSync(path.join(tmpDir, "default.png"), "");

      process.env.MODELSCRIPT_FILE_ICONS_DIR = tmpDir;
      resetFileIcons();

      assert.equal(getFileIconPath("Problem.mod"), "/file-icons/ampl.svg");
      assert.equal(getFileIconPath("Circuit.mo"), "/file-icons/default.png");

      process.env.MODELSCRIPT_FILE_ICONS_DIR = path.join(tmpDir, "does-not-exist");
      resetFileIcons();

      assert.equal(getAvailableFileIcons().size, 1);
      assert.equal(getFileIconPath("Circuit.mo"), "/file-icons/default.svg");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
