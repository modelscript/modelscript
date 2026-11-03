// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Compose Modal Multi-Level Blur & Stacking Hierarchy", () => {
  const stylesPath = path.resolve(__dirname, "../src/components/compose-modal/styles.ts");
  const confirmModalPath = path.resolve(__dirname, "../src/components/compose-modal/ConfirmSaveModal.tsx");
  const composeModalPath = path.resolve(__dirname, "../src/components/compose-modal/ComposeModal.tsx");

  const stylesSrc = fs.readFileSync(stylesPath, "utf-8");
  const confirmModalSrc = fs.readFileSync(confirmModalPath, "utf-8");
  const composeModalSrc = fs.readFileSync(composeModalPath, "utf-8");

  it("defines primary overlay with blur and Level 1 z-index (9999)", () => {
    assert.ok(stylesSrc.includes("export const Overlay = styled.div"), "Overlay should be exported");
    assert.ok(stylesSrc.includes("z-index: 9999;"), "Primary Overlay must have z-index: 9999");
    assert.ok(
      stylesSrc.includes("backdrop-filter: blur(4px);"),
      "Primary Overlay must have backdrop-filter: blur(4px)",
    );
    assert.ok(
      stylesSrc.includes("-webkit-backdrop-filter: blur(4px);"),
      "Primary Overlay must have -webkit-backdrop-filter for WebKit support",
    );
  });

  it("defines secondary NestedOverlay with Level 2 blur (8px) and higher z-index (10001)", () => {
    assert.ok(stylesSrc.includes("export const NestedOverlay = styled.div"), "NestedOverlay should be exported");
    assert.ok(stylesSrc.includes("z-index: 10001;"), "NestedOverlay must have z-index: 10001 (above primary modal)");
    assert.ok(stylesSrc.includes("backdrop-filter: blur(8px);"), "NestedOverlay must have Level 2 blur(8px)");
    assert.ok(
      stylesSrc.includes("-webkit-backdrop-filter: blur(8px);"),
      "NestedOverlay must have -webkit-backdrop-filter for WebKit support",
    );
  });

  it("ConfirmSaveModal renders NestedOverlay and ConfirmModalPanel above the compose modal", () => {
    assert.ok(
      confirmModalSrc.includes("<NestedOverlay onClick={onCancel}>"),
      "ConfirmSaveModal must use NestedOverlay so it sits above the compose modal",
    );
    assert.ok(
      !confirmModalSrc.includes("zIndex: 1100"),
      "ConfirmSaveModal must NOT have low zIndex: 1100 which traps it below the compose blur",
    );
    assert.ok(
      confirmModalSrc.includes("<ConfirmModalPanel"),
      "ConfirmSaveModal must use ConfirmModalPanel with elevation and smooth pop-in",
    );
  });

  it("ConfirmSaveModal integrates useFocusTrap with Escape key dismissal and dialog ARIA attributes", () => {
    assert.ok(confirmModalSrc.includes("useFocusTrap"), "ConfirmSaveModal must use useFocusTrap hook");
    assert.ok(confirmModalSrc.includes("onEscape: onCancel"), "Escape key must invoke onCancel to return to compose");
    assert.ok(confirmModalSrc.includes('role="dialog"'), 'ConfirmModalPanel must have role="dialog"');
    assert.ok(confirmModalSrc.includes('aria-modal="true"'), 'ConfirmModalPanel must have aria-modal="true"');
    assert.ok(
      confirmModalSrc.includes('aria-labelledby="confirm-save-title"'),
      "ConfirmModalPanel must reference the dialog title",
    );
  });

  it("ComposeModal handles Escape key to prompt confirm_save when changes are unsaved", () => {
    assert.ok(composeModalSrc.includes('e.key === "Escape"'), "ComposeModal must listen for Escape key");
    assert.ok(composeModalSrc.includes("handleCloseClick"), "Escape key in compose view must invoke handleCloseClick");
  });
});
