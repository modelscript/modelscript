// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Package Ingestion Log Modal & Accessibility UX Suite", () => {
  const packageDetailPageSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/PackageDetailPage.tsx"),
    "utf-8",
  );
  const packageHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/package/components/PackageHeader.tsx"),
    "utf-8",
  );
  const terminalViewerSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/terminal/TerminalLogViewer.tsx"),
    "utf-8",
  );
  const terminalStylesSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/terminal/styles.ts"),
    "utf-8",
  );
  const classDetailHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/class-detail/components/ClassDetailHeader.tsx"),
    "utf-8",
  );

  describe("1. Logs Not Shown by Default (No Unclosable Sidebar)", () => {
    it("ensures logsModalOpen is false by default in PackageDetailPage", () => {
      assert.ok(
        packageDetailPageSrc.includes("const [logsModalOpen, setLogsModalOpen] = useState(false);"),
        "logsModalOpen must initialize to false so terminal logs are never shown by default",
      );
    });

    it("verifies TerminalLogViewer is removed from direct PageWrap flex row children", () => {
      // In the old broken code, TerminalLogViewer was a direct child inside PageWrap.
      // Now, it is conditionally rendered inside LogsModalOverlay only when logsModalOpen is true.
      assert.ok(
        packageDetailPageSrc.includes("{logsModalOpen && name && version && ("),
        "TerminalLogViewer must only be mounted when logsModalOpen is true",
      );
      assert.ok(
        packageDetailPageSrc.includes("<LogsModalOverlay"),
        "TerminalLogViewer must be wrapped in a dedicated modal overlay",
      );
      assert.ok(
        packageDetailPageSrc.includes("<LogsModalContainer>"),
        "TerminalLogViewer must be wrapped in a centered modal container",
      );
    });

    it("verifies clicking the overlay backdrop closes the modal", () => {
      assert.ok(
        packageDetailPageSrc.includes("if (e.target === e.currentTarget) {") &&
          packageDetailPageSrc.includes("setLogsModalOpen(false);"),
        "Backdrop clicks must dismiss the logs modal",
      );
    });
  });

  describe("2. Easily Accessible Log Entry Points in UI", () => {
    it("renders Flash danger banner with 'View Ingestion Logs' button when jobStatus === 'failed'", () => {
      assert.ok(packageHeaderSrc.includes('jobStatus === "failed"'), "PackageHeader must check for failed jobStatus");
      assert.ok(
        packageHeaderSrc.includes("Background ingestion and symbol indexing failed for this release."),
        "PackageHeader must display descriptive failure message in danger banner",
      );
      assert.ok(
        packageHeaderSrc.includes("View Ingestion Logs"),
        "PackageHeader must provide a direct 'View Ingestion Logs' button in failure banner",
      );
      assert.ok(
        packageHeaderSrc.includes("onOpenLogs"),
        "PackageHeader banner button must trigger onOpenLogs callback",
      );
    });

    it("renders Flash warning banner with 'View Live Logs' button when jobStatus is pending/running", () => {
      assert.ok(
        packageHeaderSrc.includes('jobStatus === "pending" || jobStatus === "running"'),
        "PackageHeader must check for pending/running jobStatus",
      );
      assert.ok(
        packageHeaderSrc.includes("Background ingestion and indexing is currently in progress…"),
        "PackageHeader must display live status in warning banner",
      );
      assert.ok(
        packageHeaderSrc.includes("View Live Logs"),
        "PackageHeader must provide a 'View Live Logs' button in warning banner",
      );
    });

    it("renders dedicated 'Logs' action button in header bar with status badge", () => {
      assert.ok(
        packageHeaderSrc.includes("leadingVisual={TerminalIcon}"),
        "PackageHeader must render a button with TerminalIcon",
      );
      assert.ok(
        packageHeaderSrc.includes("Failed"),
        "PackageHeader must show 'Failed' label on Logs button when failed",
      );
      assert.ok(packageHeaderSrc.includes("Live"), "PackageHeader must show 'Live' label on Logs button when running");
    });

    it("allows accessing logs from ClassDetailHeader status badge", () => {
      assert.ok(classDetailHeaderSrc.includes("onOpenLogs"), "ClassDetailHeader must accept onOpenLogs callback");
      assert.ok(
        classDetailHeaderSrc.includes("Ingestion Failed"),
        "ClassDetailHeader must render Ingestion Failed label when job failed",
      );
      assert.ok(
        classDetailHeaderSrc.includes('cursor: onOpenLogs ? "pointer" : "default"'),
        "ClassDetailHeader must set cursor pointer when onOpenLogs is provided",
      );
    });
  });

  describe("3. Terminal Log Viewer Close & Modal Ergonomics", () => {
    it("provides onClose prop on TerminalLogViewer", () => {
      assert.ok(
        terminalViewerSrc.includes("onClose?: (() => void) | undefined;"),
        "TerminalLogViewerProps must declare onClose callback",
      );
    });

    it("wires red window dot to onClose callback", () => {
      assert.ok(
        terminalViewerSrc.includes('$color="#ff5f56"') && terminalViewerSrc.includes("onClick={onClose}"),
        "Red dot in macOS window chrome must trigger onClose",
      );
    });

    it("wires header close button to onClose callback with Escape shortcut hint", () => {
      assert.ok(
        terminalViewerSrc.includes('onClick={onClose} title="Close logs (Esc)"'),
        "Header close button must call onClose",
      );
    });

    it("registers Escape key event listener to close modal", () => {
      assert.ok(
        terminalViewerSrc.includes('e.key === "Escape"') && terminalViewerSrc.includes("onClose();"),
        "Escape key press must invoke onClose()",
      );
    });

    it("supports $isModal prop in styles for proper height containment", () => {
      assert.ok(
        terminalStylesSrc.includes("$isModal?: boolean | undefined;"),
        "TerminalScrollArea must support $isModal prop",
      );
      assert.ok(
        terminalStylesSrc.includes("calc(82vh - 65px)"),
        "TerminalScrollArea must size dynamically when inside modal",
      );
    });
  });
});
