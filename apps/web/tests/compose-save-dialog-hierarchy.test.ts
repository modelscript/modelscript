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

  it("Inline ComposeBox in Home tab intercepts tab navigation when unsaved text is present and shows ConfirmSaveModal", () => {
    const composeBoxPath = path.resolve(__dirname, "../src/components/ComposeBox.tsx");
    const composeBoxSrc = fs.readFileSync(composeBoxPath, "utf-8");

    assert.ok(
      composeBoxSrc.includes("UNSAFE_NavigationContext"),
      "ComposeBox must subscribe to UNSAFE_NavigationContext to intercept route/tab transitions",
    );
    assert.ok(
      composeBoxSrc.includes("hasUnsavedChanges") && composeBoxSrc.includes("setShowConfirmSave(true)"),
      "ComposeBox must check hasUnsavedChanges and show ConfirmSaveModal before navigating away",
    );
    assert.ok(
      composeBoxSrc.includes("<ConfirmSaveModal") &&
        composeBoxSrc.includes("onSave={commitDraftAndNavigate}") &&
        composeBoxSrc.includes("onDiscard={discardAndNavigate}") &&
        composeBoxSrc.includes("onCancel={cancelConfirmSave}"),
      "ComposeBox must render ConfirmSaveModal with Save, Discard, and Cancel handlers",
    );
    assert.ok(
      composeBoxSrc.includes("upsertDraft("),
      "ComposeBox must persist unsaved content via upsertDraft when Save is clicked",
    );
  });

  it("ComposeAttachedArtifact provides in-place Full Screen modal and does not auto-draft posts on attach", () => {
    const attachedArtifactPath = path.resolve(__dirname, "../src/components/compose/ComposeAttachedArtifact.tsx");
    const attachedArtifactSrc = fs.readFileSync(attachedArtifactPath, "utf-8");
    const composeBoxPath = path.resolve(__dirname, "../src/components/ComposeBox.tsx");
    const composeBoxSrc = fs.readFileSync(composeBoxPath, "utf-8");

    // 1. Must offer Full Screen instead of "Edit in Playground" navigation
    assert.ok(
      attachedArtifactSrc.includes("<span>Full Screen</span>"),
      "ComposeAttachedArtifact must provide a 'Full Screen' button",
    );
    assert.ok(
      !attachedArtifactSrc.includes("Edit in Playground"),
      "ComposeAttachedArtifact must NOT have 'Edit in Playground' button that triggers route navigation and save dialogs",
    );
    assert.ok(
      attachedArtifactSrc.includes("isFullScreen={isFullScreen}") &&
        attachedArtifactSrc.includes("onFullScreenChange={setIsFullScreen}"),
      "ComposeAttachedArtifact must wire isFullScreen state to ArtifactViewCard for in-modal expansion",
    );

    // 2. Draft Post button in light mode must be theme-adaptive and not hardcoded black
    assert.ok(
      !attachedArtifactSrc.includes("rgba(0, 0, 0, 0.82)"),
      "Draft post button must not use hardcoded black rgba(0, 0, 0, 0.82) in light mode",
    );
    assert.ok(attachedArtifactSrc.includes("isDark ?"), "Buttons must adapt colors dynamically based on theme mode");

    // 3. ComposeBox must NOT automatically trigger handleAiDraft on artifact attachment
    assert.ok(
      !composeBoxSrc.includes("void handleAiDraft(artifactId, null)"),
      "ComposeBox must NOT automatically draft posts on artifact attachment",
    );
  });

  it("interactive runtime flow: typing in Home ComposeBox and clicking Explore tab opens Save post modal, preserves text on cancel, saves draft on Save, and navigates on Discard", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
      url: "https://ansatz.social/home",
    });

    const prevWindow = (globalThis as any).window;
    const prevDocument = (globalThis as any).document;
    const prevDocumentCtor = (globalThis as any).Document;
    const prevDocumentFragment = (globalThis as any).DocumentFragment;
    const prevLocalStorage = (globalThis as any).localStorage;
    const prevActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).Document = dom.window.Document;
    (globalThis as any).DocumentFragment = dom.window.DocumentFragment;
    (globalThis as any).Element = dom.window.Element;
    (globalThis as any).HTMLElement = dom.window.HTMLElement;
    (globalThis as any).HTMLHeadingElement = dom.window.HTMLHeadingElement;
    (globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
    (globalThis as any).HTMLDivElement = dom.window.HTMLDivElement;
    (globalThis as any).HTMLAnchorElement = dom.window.HTMLAnchorElement;
    (globalThis as any).HTMLSpanElement = dom.window.HTMLSpanElement;
    (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
    (globalThis as any).SVGElement = dom.window.SVGElement;
    (globalThis as any).Node = dom.window.Node;
    (globalThis as any).Event = dom.window.Event;
    (globalThis as any).CustomEvent = dom.window.CustomEvent;
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    (globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;
    (globalThis as any).localStorage = dom.window.localStorage;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };
    (globalThis as any).requestAnimationFrame = dom.window.requestAnimationFrame;
    (globalThis as any).cancelAnimationFrame = () => {};

    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { MemoryRouter, Routes, Route, Link } = await import("react-router-dom");
    const { default: ComposeBox } = await import("../src/components/ComposeBox.js");
    const { getDrafts } = await import("../src/components/compose-modal/drafts.js");

    dom.window.localStorage.clear();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);

    try {
      const AppHarness = () =>
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/home"] },
          React.createElement(
            "nav",
            null,
            React.createElement(Link, { to: "/home", "data-testid": "tab-home" }, "Home"),
            React.createElement(Link, { to: "/explore", "data-testid": "tab-explore" }, "Explore"),
          ),
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: "/home",
              element: React.createElement(
                "div",
                { "data-testid": "page-home" },
                React.createElement(ComposeBox, null),
              ),
            }),
            React.createElement(Route, {
              path: "/explore",
              element: React.createElement("div", { "data-testid": "page-explore" }, "Explore Page"),
            }),
          ),
        );

      await act(async () => {
        root.render(React.createElement(AppHarness));
      });

      // 1. Type into the Home tab's new post input box
      const textarea = dom.window.document.querySelector("textarea") as HTMLTextAreaElement;
      assert.ok(textarea, "Home tab should render ComposeBox textarea");

      const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
      await act(async () => {
        nativeSetter?.call(textarea, "Drafting a new Modelica thermal simulation post");
        textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      assert.equal(textarea.value, "Drafting a new Modelica thermal simulation post");

      // 2. Click on the Explore tab
      const exploreTab = dom.window.document.querySelector('[data-testid="tab-explore"]') as HTMLElement;
      await act(async () => {
        exploreTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });

      // Verify we are STILL on /home, text is NOT deleted, and ConfirmSaveModal ("Save post?") is shown
      assert.ok(
        dom.window.document.querySelector('[data-testid="page-home"]'),
        "Must remain on Home tab when unsaved changes exist",
      );
      assert.equal(
        (dom.window.document.querySelector("textarea") as HTMLTextAreaElement).value,
        "Drafting a new Modelica thermal simulation post",
        "Typed text must not be deleted when clicking Explore tab",
      );
      const modalDialog = dom.window.document.querySelector('[role="dialog"][aria-labelledby="confirm-save-title"]');
      assert.ok(modalDialog, "ConfirmSaveModal dialog must be displayed");
      assert.ok(modalDialog.textContent?.includes("Save post?"), "Modal must display 'Save post?' heading");

      // 3. Cancel the modal via Escape key -> stays on Home with text intact
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      assert.equal(
        dom.window.document.querySelector('[role="dialog"][aria-labelledby="confirm-save-title"]'),
        null,
        "ConfirmSaveModal should close on Escape",
      );
      assert.equal(
        (dom.window.document.querySelector("textarea") as HTMLTextAreaElement).value,
        "Drafting a new Modelica thermal simulation post",
        "Typed text must still be preserved after cancelling modal",
      );

      // 4. Click Explore tab again and click "Save" -> saves draft and navigates to /explore
      await act(async () => {
        exploreTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });
      const saveBtn = Array.from(dom.window.document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Save",
      );
      assert.ok(saveBtn, "ConfirmSaveModal must render Save button");
      await act(async () => {
        saveBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });

      assert.ok(
        dom.window.document.querySelector('[data-testid="page-explore"]'),
        "Clicking Save must complete navigation to Explore tab",
      );
      const savedDrafts = getDrafts();
      assert.equal(savedDrafts.length, 1, "One draft should be saved in localStorage");
      assert.equal(savedDrafts[0]?.content, "Drafting a new Modelica thermal simulation post");

      // 5. Navigate back to Home, type new text, click Explore, and click "Discard"
      const homeTab = dom.window.document.querySelector('[data-testid="tab-home"]') as HTMLElement;
      await act(async () => {
        homeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });
      const textarea2 = dom.window.document.querySelector("textarea") as HTMLTextAreaElement;
      await act(async () => {
        nativeSetter?.call(textarea2, "Temporary text to discard");
        textarea2.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => {
        exploreTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });
      const discardBtn = Array.from(dom.window.document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Discard",
      );
      assert.ok(discardBtn, "ConfirmSaveModal must render Discard button");
      await act(async () => {
        discardBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });

      assert.ok(
        dom.window.document.querySelector('[data-testid="page-explore"]'),
        "Clicking Discard must complete navigation to Explore tab",
      );
      assert.equal(getDrafts().length, 1, "Discarded post must not be added to saved drafts");

      await act(async () => {
        root.unmount();
      });
    } finally {
      (globalThis as any).window = prevWindow;
      (globalThis as any).document = prevDocument;
      (globalThis as any).Document = prevDocumentCtor;
      (globalThis as any).DocumentFragment = prevDocumentFragment;
      (globalThis as any).localStorage = prevLocalStorage;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    }
  });
});
