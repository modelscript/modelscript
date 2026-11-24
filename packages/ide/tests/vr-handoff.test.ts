// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  deserializeCanvasDocument,
  serializeCanvasDocument,
} from "@modelscript/canvas";
import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { CanvasEditorProvider } from "../src/canvas-editor-provider.js";
import { handleOpenInVrWebviewMessage, withVrHandoffProvider } from "../src/controllers/custom-editors-controller.js";
import { GCodeEditorProvider } from "../src/gcode-editor-provider.js";
import {
  DEFAULT_MAX_VR_BOARD_BYTES,
  DEFAULT_VR_HOST_URL,
  VR_HANDOFF_BROADCAST_CHANNEL,
  buildExternalVrRotundaUrl,
  decodeVrBoardFromHash,
  encodeUtf8Base64Url,
  normalizeVrEnvironment,
  openExternalVrRotunda,
  publishVrHandoffToBroadcastChannel,
  resolveVrHostBaseUrl,
} from "../src/vr-handoff.js";

function createMockWebviewPanel() {
  const messageListeners: Array<(msg: Record<string, unknown>) => unknown> = [];
  const disposeListeners: Array<() => void> = [];
  const postedMessages: unknown[] = [];

  const panel = {
    webview: {
      options: {} as vscode.WebviewOptions,
      cspSource: "vscode-webview://mock",
      asWebviewUri: (u: vscode.Uri) => u,
      postMessage: async (msg: unknown) => {
        postedMessages.push(msg);
        return true;
      },
      onDidReceiveMessage: (listener: (msg: Record<string, unknown>) => unknown) => {
        messageListeners.push(listener);
        return new vscode.Disposable(() => {
          const idx = messageListeners.indexOf(listener);
          if (idx >= 0) messageListeners.splice(idx, 1);
        });
      },
      html: "",
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return new vscode.Disposable(() => {
        const idx = disposeListeners.indexOf(listener);
        if (idx >= 0) disposeListeners.splice(idx, 1);
      });
    },
    reveal: () => {},
    dispose: () => {
      for (const fn of [...disposeListeners]) fn();
    },
  };

  return {
    panel: panel as unknown as vscode.WebviewPanel,
    postedMessages,
    emitMessage: async (msg: Record<string, unknown>) => {
      for (const listener of [...messageListeners]) {
        await listener(msg);
      }
    },
  };
}

function createMockTextDocument(uriStr: string, content: string): vscode.TextDocument {
  const uri = vscode.Uri.parse(uriStr);
  return {
    uri,
    getText: () => content,
    positionAt: (offset: number) => new vscode.Position(0, offset),
    lineCount: content.split("\n").length,
    lineAt: (line: number) => ({
      text: content.split("\n")[line] ?? "",
      range: new vscode.Range(line, 0, line, (content.split("\n")[line] ?? "").length),
    }),
  } as unknown as vscode.TextDocument;
}

describe("VR Handoff & Spatial Canvas WebXR Integration", () => {
  describe("buildExternalVrRotundaUrl & resolveVrHostBaseUrl", () => {
    it("builds default Ansatz /canvas WebXR VR URL with dark-lab environment", () => {
      const url = buildExternalVrRotundaUrl();
      assert.strictEqual(url, `${DEFAULT_VR_HOST_URL}/canvas?mode=webxr-vr&env=dark-lab`);
    });

    it("supports explicit baseUrl, trailing-slash normalization, environment, artifactUri, title, kind, and model index", () => {
      const url = buildExternalVrRotundaUrl({
        baseUrl: "https://vr.example.internal///",
        environment: "warehouse",
        artifactUri: "file:///workspace/actuator.step",
        title: "Robotic Actuator",
        kind: "step",
        activeModelIndex: 2,
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.origin, "https://vr.example.internal");
      assert.strictEqual(parsed.pathname, "/canvas");
      assert.strictEqual(parsed.searchParams.get("mode"), "webxr-vr");
      assert.strictEqual(parsed.searchParams.get("env"), "warehouse");
      assert.strictEqual(parsed.searchParams.get("artifact"), "file:///workspace/actuator.step");
      assert.strictEqual(parsed.searchParams.get("title"), "Robotic Actuator");
      assert.strictEqual(parsed.searchParams.get("kind"), "step");
      assert.strictEqual(parsed.searchParams.get("model"), "2");
      assert.strictEqual(parsed.hash, "");
    });

    it("supports render-artifact route with optional artifactId", () => {
      const urlWithId = buildExternalVrRotundaUrl({
        baseUrl: "https://ansatz.social",
        route: "render-artifact",
        artifactId: 42,
        environment: "passthrough",
      });
      const parsed = new URL(urlWithId);
      assert.strictEqual(parsed.pathname, "/render-artifact/42");
      assert.strictEqual(parsed.searchParams.get("mode"), "webxr-vr");
      assert.strictEqual(parsed.searchParams.get("env"), "passthrough");
    });

    it("reads modelscript.vrHostUrl and falls back to modelscript.ansatzUrl from VS Code configuration", () => {
      const origGetConfig = vscode.workspace.getConfiguration;
      try {
        (vscode.workspace as unknown as { getConfiguration: typeof origGetConfig }).getConfiguration = ((
          section?: string,
        ) => ({
          get: <T>(key: string): T | undefined => {
            if (section === "modelscript" && key === "vrHostUrl") {
              return "https://vr-lab.corp.local/" as unknown as T;
            }
            return undefined;
          },
          inspect: () => undefined,
          has: () => false,
          update: async () => {},
        })) as unknown as typeof origGetConfig;

        assert.strictEqual(resolveVrHostBaseUrl(), "https://vr-lab.corp.local");

        (vscode.workspace as unknown as { getConfiguration: typeof origGetConfig }).getConfiguration = ((
          section?: string,
        ) => ({
          get: <T>(key: string): T | undefined => {
            if (section === "modelscript" && key === "ansatzUrl") {
              return "https://ansatz.corp.local/" as unknown as T;
            }
            return undefined;
          },
          inspect: () => undefined,
          has: () => false,
          update: async () => {},
        })) as unknown as typeof origGetConfig;

        assert.strictEqual(resolveVrHostBaseUrl(), "https://ansatz.corp.local");
      } finally {
        (vscode.workspace as unknown as { getConfiguration: typeof origGetConfig }).getConfiguration = origGetConfig;
      }
    });

    it("normalizes unknown environments safely to dark-lab", () => {
      assert.strictEqual(normalizeVrEnvironment("OUTDOORS"), "outdoors");
      assert.strictEqual(normalizeVrEnvironment("office"), "office");
      assert.strictEqual(normalizeVrEnvironment("unknown-room"), "dark-lab");
      assert.strictEqual(normalizeVrEnvironment(undefined), "dark-lab");
    });
  });

  describe("decodeVrBoardFromHash (UTF-8 round-trips & oversized board safety)", () => {
    it("round-trips a canonical .mscanvas board through #vrBoard hash fragment without leaking into query params", () => {
      const board = createCanonicalPolyglotDemoBoard();
      const serialized = serializeCanvasDocument(board);
      const url = buildExternalVrRotundaUrl({
        environment: "dark-lab",
        boardJson: serialized,
        title: board.name,
      });

      const parsed = new URL(url);
      assert.ok(!parsed.search.includes("vrBoard"), "board payload must never appear in query string");
      assert.ok(parsed.hash.startsWith("#vrBoard="), "board payload must be placed in #vrBoard hash fragment");
      const encodedValue = parsed.hash.slice("#vrBoard=".length);
      assert.ok(
        !encodedValue.includes("+") && !encodedValue.includes("/") && !encodedValue.includes("="),
        "must be unpadded base64url",
      );

      const decoded = decodeVrBoardFromHash(parsed.hash);
      assert.strictEqual(decoded, serialized);
      const roundTripped = deserializeCanvasDocument(decoded!);
      assert.strictEqual(roundTripped.id, board.id);
      assert.strictEqual(roundTripped.name, board.name);
    });

    it("round-trips multi-byte Unicode / UTF-8 strings (Greek math, CJK, accented Latin, emojis)", () => {
      const unicodeBoard = JSON.stringify({
        id: "unicode-board-Ω",
        title: "Modèle Thermique — 热力学仿真 🚀🥽 (ΔT ≤ 15 K, π ≈ 3.14159, μm)",
        notes: 'Line 1\nLine 2\t"quoted" & café',
      });
      const url = buildExternalVrRotundaUrl({ boardJson: unicodeBoard });
      const parsed = new URL(url);

      assert.strictEqual(decodeVrBoardFromHash(parsed.hash), unicodeBoard);
      // Also accepts raw fragment without '#' and full URL
      assert.strictEqual(decodeVrBoardFromHash(parsed.hash.slice(1)), unicodeBoard);
      assert.strictEqual(decodeVrBoardFromHash(url), unicodeBoard);
      // Also extracts from multi-parameter hash fragment
      assert.strictEqual(
        decodeVrBoardFromHash(`#view=rotunda&vrBoard=${encodeUtf8Base64Url(unicodeBoard)}&z=1`),
        unicodeBoard,
      );
    });

    it("safely omits oversized board payloads exceeding maxBoardBytes and default cap", () => {
      const hugeBoard = JSON.stringify({
        id: "huge-mesh-board",
        padding: "A".repeat(DEFAULT_MAX_VR_BOARD_BYTES + 4096),
      });
      const url = buildExternalVrRotundaUrl({ boardJson: hugeBoard, title: "Huge Assembly" });
      const parsed = new URL(url);

      assert.strictEqual(parsed.hash, "", "oversized board must be omitted from hash fragment");
      assert.strictEqual(parsed.searchParams.get("boardOmitted"), "1");
      assert.strictEqual(decodeVrBoardFromHash(parsed.hash), null);
      assert.ok(url.length < 512, "resulting URL must remain compact");

      // Custom lower maxBoardBytes limit
      const mediumBoard = JSON.stringify({ id: "medium", data: "x".repeat(512) });
      const cappedUrl = buildExternalVrRotundaUrl({ boardJson: mediumBoard, maxBoardBytes: 128 });
      const cappedParsed = new URL(cappedUrl);
      assert.strictEqual(cappedParsed.hash, "");
      assert.strictEqual(cappedParsed.searchParams.get("boardOmitted"), "1");
    });

    it("returns null for empty, missing, malformed base64, or invalid UTF-8 hash payloads", () => {
      assert.strictEqual(decodeVrBoardFromHash(""), null);
      assert.strictEqual(decodeVrBoardFromHash("#foo=bar"), null);
      assert.strictEqual(decodeVrBoardFromHash("#vrBoard="), null);
      assert.strictEqual(decodeVrBoardFromHash("#vrBoard=!!!not-valid-base64!!!"), null);
      // 0xFF 0xFE is invalid UTF-8 (base64url "__4")
      assert.strictEqual(decodeVrBoardFromHash("#vrBoard=__4"), null);
    });
  });

  describe("openExternalVrRotunda", () => {
    it("opens external browser URL via vscode.env.openExternal and displays an informative notification", async () => {
      const openedUris: vscode.Uri[] = [];
      const infoMessages: string[] = [];

      const origOpenExternal = vscode.env.openExternal;
      const origShowInfo = vscode.window.showInformationMessage;
      try {
        (vscode.env as unknown as { openExternal: (u: vscode.Uri) => Promise<boolean> }).openExternal = async (
          uri: vscode.Uri,
        ) => {
          openedUris.push(uri);
          return true;
        };
        (
          vscode.window as unknown as { showInformationMessage: (msg: string) => Promise<undefined> }
        ).showInformationMessage = async (msg: string) => {
          infoMessages.push(msg);
          return undefined;
        };

        const board = createCanonicalPolyglotDemoBoard();
        const result = await openExternalVrRotunda({
          baseUrl: "https://ansatz.social",
          environment: "office",
          title: "Actuator Twin",
          boardJson: serializeCanvasDocument(board),
        });

        assert.strictEqual(result, true);
        assert.strictEqual(openedUris.length, 1);
        const launched = openedUris[0]!.toString(true);
        assert.ok(launched.startsWith("https://ansatz.social/canvas?mode=webxr-vr&env=office"));
        assert.ok(launched.includes("#vrBoard="));
        assert.strictEqual(decodeVrBoardFromHash(launched), serializeCanvasDocument(board));
        assert.strictEqual(infoMessages.length, 1);
        assert.ok(infoMessages[0]!.includes("Actuator Twin"));
        assert.ok(infoMessages[0]!.includes("office"));
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
        (vscode.window as unknown as { showInformationMessage: typeof origShowInfo }).showInformationMessage =
          origShowInfo;
      }
    });

    it("returns false and surfaces warning when openExternal throws", async () => {
      const warnings: string[] = [];
      const origOpenExternal = vscode.env.openExternal;
      const origShowWarning = vscode.window.showWarningMessage;
      try {
        (vscode.env as unknown as { openExternal: () => Promise<boolean> }).openExternal = async () => {
          throw new Error("Browser blocked popup");
        };
        (vscode.window as unknown as { showWarningMessage: (msg: string) => Promise<undefined> }).showWarningMessage =
          async (msg: string) => {
            warnings.push(msg);
            return undefined;
          };

        const ok = await openExternalVrRotunda({ title: "Broken Launch" });
        assert.strictEqual(ok, false);
        assert.strictEqual(warnings.length, 1);
        assert.ok(warnings[0]!.includes("Browser blocked popup"));
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
        (vscode.window as unknown as { showWarningMessage: typeof origShowWarning }).showWarningMessage =
          origShowWarning;
      }
    });
  });

  describe("CanvasEditorProvider & Custom Editor VR Handoff", () => {
    it("triggers openExternalVrRotunda on surfaceModeChanged(webxr-vr) and openInVr with serialized .mscanvas board", async () => {
      const openedUris: vscode.Uri[] = [];
      const origOpenExternal = vscode.env.openExternal;
      try {
        (vscode.env as unknown as { openExternal: (u: vscode.Uri) => Promise<boolean> }).openExternal = async (
          uri: vscode.Uri,
        ) => {
          openedUris.push(uri);
          return true;
        };

        const board = createCanonicalPolyglotDemoBoard();
        board.name = "Electro-Thermal Servo Board";
        const serialized = serializeCanvasDocument(board);
        const doc = createMockTextDocument("file:///workspace/servo.mscanvas", serialized);
        const { panel, emitMessage } = createMockWebviewPanel();

        const provider = new CanvasEditorProvider({
          extensionUri: vscode.Uri.file("/ext"),
        } as unknown as vscode.ExtensionContext);

        await provider.resolveCustomTextEditor(
          doc,
          panel,
          new vscode.CancellationTokenSource().token as unknown as vscode.CancellationToken,
        );

        // Switching to spatial-3d runs inline and should NOT open an external browser tab
        await emitMessage({ type: "surfaceModeChanged", mode: "spatial-3d" });
        assert.strictEqual(openedUris.length, 0);

        // Switching to webxr-vr MUST open external browser tab with serialized board in #vrBoard
        await emitMessage({ type: "surfaceModeChanged", mode: "webxr-vr", environment: "warehouse" });
        assert.strictEqual(openedUris.length, 1);
        const firstUrl = openedUris[0]!.toString(true);
        assert.ok(firstUrl.includes("mode=webxr-vr"));
        assert.ok(firstUrl.includes("env=warehouse"));
        assert.strictEqual(decodeVrBoardFromHash(firstUrl), serialized);

        // Direct openInVr message with custom document override & environment
        const updatedBoard = { ...board, name: "Updated Board Name" };
        await emitMessage({
          type: "openInVr",
          environment: "passthrough",
          activeModelIndex: 1,
          document: updatedBoard,
        });
        assert.strictEqual(openedUris.length, 2);
        const secondUrl = openedUris[1]!.toString(true);
        assert.ok(secondUrl.includes("env=passthrough"));
        assert.ok(secondUrl.includes("model=1"));
        assert.strictEqual(decodeVrBoardFromHash(secondUrl), serializeCanvasDocument(updatedBoard));

        panel.dispose();
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
      }
    });

    it("handles openInVr from STEP/CAD/FEA/CFD/GCode/Multibody custom editors exactly once via withVrHandoffProvider", async () => {
      const openedUris: vscode.Uri[] = [];
      const origOpenExternal = vscode.env.openExternal;
      try {
        (vscode.env as unknown as { openExternal: (u: vscode.Uri) => Promise<boolean> }).openExternal = async (
          uri: vscode.Uri,
        ) => {
          openedUris.push(uri);
          return true;
        };

        // Test GCodeEditorProvider wrapped in withVrHandoffProvider (must remain idempotent — 1 call, not 2!)
        const gcodeProvider = withVrHandoffProvider(
          new GCodeEditorProvider({ extensionUri: vscode.Uri.file("/ext") } as unknown as vscode.ExtensionContext),
          "gcode",
        );
        const gcodeDoc = createMockTextDocument("file:///workspace/bracket.gcode", "G0 X0 Y0 Z0\nG1 X10 Y10 F600");
        const { panel, emitMessage } = createMockWebviewPanel();

        await gcodeProvider.resolveCustomTextEditor(
          gcodeDoc,
          panel,
          new vscode.CancellationTokenSource().token as unknown as vscode.CancellationToken,
        );

        await emitMessage({ type: "openInVr", environment: "warehouse" });
        assert.strictEqual(openedUris.length, 1, "idempotent VR listener must open external tab exactly once");
        const gcodeUrl = new URL(openedUris[0]!.toString(true));
        assert.strictEqual(gcodeUrl.searchParams.get("env"), "warehouse");
        assert.strictEqual(gcodeUrl.searchParams.get("kind"), "gcode");
        assert.strictEqual(gcodeUrl.searchParams.get("artifact"), "file:///workspace/bracket.gcode");
        assert.strictEqual(gcodeUrl.searchParams.get("title"), "bracket.gcode");

        // Test direct handleOpenInVrWebviewMessage for FEA/CFD/Multibody payloads & non-VR message ignore
        const ignored = await handleOpenInVrWebviewMessage({ type: "ready" });
        assert.strictEqual(ignored, false);
        assert.strictEqual(openedUris.length, 1);

        const handledFea = await handleOpenInVrWebviewMessage(
          { type: "openInVr", environment: "dark-lab", kind: "fea", title: "Cantilever Stress Mesh" },
          { artifactUri: "file:///workspace/cantilever.inp" },
        );
        assert.strictEqual(handledFea, true);
        assert.strictEqual(openedUris.length, 2);
        const feaUrl = new URL(openedUris[1]!.toString(true));
        assert.strictEqual(feaUrl.searchParams.get("kind"), "fea");
        assert.strictEqual(feaUrl.searchParams.get("title"), "Cantilever Stress Mesh");
        assert.strictEqual(feaUrl.searchParams.get("artifact"), "file:///workspace/cantilever.inp");

        panel.dispose();
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
      }
    });
  });

  describe("BroadcastChannel Local-File Relay & handoffId URL Generation", () => {
    function installMockBroadcastChannel() {
      const channelsByName = new Map<string, Set<MockBroadcastChannel>>();

      class MockBroadcastChannel {
        public readonly name: string;
        public closed = false;
        public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
        public readonly posted: unknown[] = [];

        constructor(name: string) {
          this.name = name;
          let set = channelsByName.get(name);
          if (!set) {
            set = new Set();
            channelsByName.set(name, set);
          }
          set.add(this);
        }

        public postMessage(data: unknown): void {
          if (this.closed) {
            throw new Error("BroadcastChannel is closed");
          }
          this.posted.push(data);
          const peers = channelsByName.get(this.name);
          if (!peers) return;
          for (const peer of [...peers]) {
            if (peer !== this && !peer.closed && typeof peer.onmessage === "function") {
              peer.onmessage({ data } as MessageEvent<unknown>);
            }
          }
        }

        public close(): void {
          this.closed = true;
          channelsByName.get(this.name)?.delete(this);
        }
      }

      const globalObj = globalThis as unknown as { BroadcastChannel?: unknown };
      const origBroadcastChannel = globalObj.BroadcastChannel;
      globalObj.BroadcastChannel = MockBroadcastChannel;

      return {
        MockBroadcastChannel,
        channelsByName,
        restore: () => {
          for (const set of channelsByName.values()) {
            for (const ch of [...set]) {
              ch.close();
            }
          }
          channelsByName.clear();
          globalObj.BroadcastChannel = origBroadcastChannel;
        },
      };
    }

    it("attaches handoffId query parameter in buildExternalVrRotundaUrl when provided", () => {
      const url = buildExternalVrRotundaUrl({
        baseUrl: "https://ansatz.social",
        environment: "warehouse",
        handoffId: "vr-local-step-123",
        kind: "step",
        title: "unsaved-bracket.step",
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.pathname, "/canvas");
      assert.strictEqual(parsed.searchParams.get("mode"), "webxr-vr");
      assert.strictEqual(parsed.searchParams.get("env"), "warehouse");
      assert.strictEqual(parsed.searchParams.get("handoffId"), "vr-local-step-123");
      assert.strictEqual(parsed.searchParams.get("kind"), "step");
      assert.strictEqual(parsed.searchParams.get("title"), "unsaved-bracket.step");
    });

    it("publishes unsaved local file payloads on modelscript-vr-handoff BroadcastChannel and auto-cleans up", async () => {
      const mockEnv = installMockBroadcastChannel();
      try {
        assert.strictEqual(VR_HANDOFF_BROADCAST_CHANNEL, "modelscript-vr-handoff");

        const cleanup = publishVrHandoffToBroadcastChannel(
          {
            handoffId: "handoff-step-42",
            fileContent: "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;",
            languageId: "step",
            artifactUri: "untitled:Untitled-1.step",
            title: "Untitled-1.step",
            kind: "step",
            environment: "dark-lab",
          },
          { ttlMs: 40 },
        );

        const activeChannels = mockEnv.channelsByName.get(VR_HANDOFF_BROADCAST_CHANNEL);
        assert.strictEqual(activeChannels?.size, 1, "publisher must open the modelscript-vr-handoff channel");

        const receiver = new mockEnv.MockBroadcastChannel(VR_HANDOFF_BROADCAST_CHANNEL);
        const receivedPayloads: Array<Record<string, unknown>> = [];
        receiver.onmessage = (ev) => {
          if (ev.data && typeof ev.data === "object") {
            receivedPayloads.push(ev.data as Record<string, unknown>);
          }
        };

        // Mismatched handoffId or unrelated message type must be ignored
        receiver.postMessage({ type: "vr-handoff-request", handoffId: "other-id" });
        receiver.postMessage({ type: "other-event", handoffId: "handoff-step-42" });
        assert.strictEqual(receivedPayloads.length, 0);

        // Matching vr-handoff-request must trigger vr-handoff-payload response
        receiver.postMessage({ type: "vr-handoff-request", handoffId: "handoff-step-42" });
        assert.strictEqual(receivedPayloads.length, 1);
        assert.strictEqual(receivedPayloads[0]!["type"], "vr-handoff-payload");
        assert.strictEqual(receivedPayloads[0]!["handoffId"], "handoff-step-42");
        assert.strictEqual(receivedPayloads[0]!["languageId"], "step");
        assert.strictEqual(
          receivedPayloads[0]!["fileContent"],
          "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;",
        );
        assert.strictEqual(receivedPayloads[0]!["title"], "Untitled-1.step");
        assert.strictEqual(receivedPayloads[0]!["kind"], "step");

        // Wait for TTL auto-cleanup to close the publisher channel
        await new Promise((resolve) => setTimeout(resolve, 75));
        assert.strictEqual(
          mockEnv.channelsByName.get(VR_HANDOFF_BROADCAST_CHANNEL)?.size,
          1,
          "only receiver remains open",
        );
        receiver.postMessage({ type: "vr-handoff-request", handoffId: "handoff-step-42" });
        assert.strictEqual(receivedPayloads.length, 1, "expired publisher must no longer reply");

        cleanup();
        receiver.close();
      } finally {
        mockEnv.restore();
      }
    });

    it("degrades safely to a no-op when BroadcastChannel is unavailable", () => {
      const globalObj = globalThis as unknown as { BroadcastChannel?: unknown };
      const origBroadcastChannel = globalObj.BroadcastChannel;
      try {
        globalObj.BroadcastChannel = undefined;
        const cleanup = publishVrHandoffToBroadcastChannel({
          handoffId: "no-bc-id",
          fileContent: "model Pendulum end Pendulum;",
          languageId: "modelica",
        });
        assert.strictEqual(typeof cleanup, "function");
        cleanup();
      } finally {
        globalObj.BroadcastChannel = origBroadcastChannel;
      }
    });

    it("openExternalVrRotunda generates handoffId, publishes via BroadcastChannel, and keeps #vrBoard hash fallback", async () => {
      const mockEnv = installMockBroadcastChannel();
      const openedUris: vscode.Uri[] = [];
      const origOpenExternal = vscode.env.openExternal;
      try {
        (vscode.env as unknown as { openExternal: (u: vscode.Uri) => Promise<boolean> }).openExternal = async (
          uri: vscode.Uri,
        ) => {
          openedUris.push(uri);
          return true;
        };

        const board = createCanonicalPolyglotDemoBoard();
        const serializedBoard = serializeCanvasDocument(board);
        const moSource =
          "model ThermalActuator\n  Real T(start = 300);\nequation\n  der(T) = -0.1 * (T - 293.15);\nend ThermalActuator;";

        const ok = await openExternalVrRotunda({
          baseUrl: "https://ansatz.social",
          environment: "outdoors",
          boardJson: serializedBoard,
          fileContent: moSource,
          languageId: "modelica",
          title: "ThermalActuator.mo",
          kind: "cad",
          silent: true,
        });

        assert.strictEqual(ok, true);
        assert.strictEqual(openedUris.length, 1);
        const launchedUrl = openedUris[0]!.toString(true);
        const parsed = new URL(launchedUrl);
        const handoffId = parsed.searchParams.get("handoffId");

        assert.ok(handoffId && handoffId.length > 0, "handoffId must be generated and attached to query params");
        assert.ok(parsed.hash.startsWith("#vrBoard="), "#vrBoard hash fallback must be preserved");
        assert.strictEqual(decodeVrBoardFromHash(launchedUrl), serializedBoard);

        // Simulate the newly opened /canvas?handoffId=... tab pinging the BroadcastChannel
        const receiver = new mockEnv.MockBroadcastChannel(VR_HANDOFF_BROADCAST_CHANNEL);
        const replies: Array<Record<string, unknown>> = [];
        receiver.onmessage = (ev) => {
          if (ev.data && typeof ev.data === "object") {
            replies.push(ev.data as Record<string, unknown>);
          }
        };
        receiver.postMessage({ type: "vr-handoff-request", handoffId });

        assert.strictEqual(replies.length, 1);
        assert.strictEqual(replies[0]!["type"], "vr-handoff-payload");
        assert.strictEqual(replies[0]!["handoffId"], handoffId);
        assert.strictEqual(replies[0]!["fileContent"], moSource);
        assert.strictEqual(replies[0]!["languageId"], "modelica");
        assert.strictEqual(replies[0]!["boardJson"], serializedBoard);
        assert.strictEqual(replies[0]!["environment"], "outdoors");
        receiver.close();
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
        mockEnv.restore();
      }
    });

    it("handleOpenInVrWebviewMessage forwards fileContent & languageId from STEP/FEA/GCode/CAD webview messages", async () => {
      const mockEnv = installMockBroadcastChannel();
      const openedUris: vscode.Uri[] = [];
      const origOpenExternal = vscode.env.openExternal;
      try {
        (vscode.env as unknown as { openExternal: (u: vscode.Uri) => Promise<boolean> }).openExternal = async (
          uri: vscode.Uri,
        ) => {
          openedUris.push(uri);
          return true;
        };

        const inpDeck = "*NODE\n1, 0.0, 0.0, 0.0\n2, 1.0, 0.0, 0.0\n*ELEMENT, TYPE=C3D8";
        const handled = await handleOpenInVrWebviewMessage(
          {
            type: "openInVr",
            environment: "dark-lab",
            kind: "fea",
            title: "bracket.inp",
            fileContent: inpDeck,
            languageId: "fea",
          },
          { artifactUri: "file:///workspace/bracket.inp" },
        );

        assert.strictEqual(handled, true);
        assert.strictEqual(openedUris.length, 1);
        const parsed = new URL(openedUris[0]!.toString(true));
        const handoffId = parsed.searchParams.get("handoffId");
        assert.ok(handoffId && handoffId.length > 0, "handoffId must be present when fileContent is forwarded");

        const receiver = new mockEnv.MockBroadcastChannel(VR_HANDOFF_BROADCAST_CHANNEL);
        const replies: Array<Record<string, unknown>> = [];
        receiver.onmessage = (ev) => {
          if (ev.data && typeof ev.data === "object") {
            replies.push(ev.data as Record<string, unknown>);
          }
        };
        receiver.postMessage({ type: "vr-handoff-request", handoffId });

        assert.strictEqual(replies.length, 1);
        assert.strictEqual(replies[0]!["type"], "vr-handoff-payload");
        assert.strictEqual(replies[0]!["fileContent"], inpDeck);
        assert.strictEqual(replies[0]!["languageId"], "fea");
        assert.strictEqual(replies[0]!["kind"], "fea");
        assert.strictEqual(replies[0]!["artifactUri"], "file:///workspace/bracket.inp");
        receiver.close();
      } finally {
        (vscode.env as unknown as { openExternal: typeof origOpenExternal }).openExternal = origOpenExternal;
        mockEnv.restore();
      }
    });
  });
});
