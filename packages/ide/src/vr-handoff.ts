// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

/** Default public Ansatz / ModelScript Web host for external top-level WebXR sessions. */
export const DEFAULT_VR_HOST_URL = "https://ansatz.social";

/** Maximum UTF-8 byte length of `.mscanvas` JSON safely embedded in `#vrBoard=...`. */
export const DEFAULT_MAX_VR_BOARD_BYTES = 128 * 1024;

/** Maximum encoded base64url hash character length accepted by `decodeVrBoardFromHash`. */
const MAX_DECODE_HASH_CHARS = 2 * 1024 * 1024;

/** BroadcastChannel name used to relay unsaved local files and full `.mscanvas` boards to top-level `/canvas` tabs. */
export const VR_HANDOFF_BROADCAST_CHANNEL = "modelscript-vr-handoff";

/** Default lifetime (ms) before a `BroadcastChannel` VR handoff publisher automatically closes to prevent leaks. */
export const DEFAULT_VR_HANDOFF_TTL_MS = 60_000;

/** Supported Engineering Rotunda environment presets. */
export const VALID_VR_ENVIRONMENTS = ["atrium", "warehouse", "office", "outdoors", "dark-lab", "passthrough"] as const;

export type VrRotundaEnvironment = (typeof VALID_VR_ENVIRONMENTS)[number];

/**
 * Configuration options for handing off a VS Code Webview 3D / Spatial Canvas view
 * to a top-level WebXR VR/AR browser tab (bypassing VS Code's sandboxed cross-origin iframe).
 */
export interface VrHandoffOptions {
  /** Override base URL (defaults to VS Code setting `modelscript.vrHostUrl` / `modelscript.ansatzUrl` or `"https://ansatz.social"`). */
  baseUrl?: string | undefined;
  /** Target Ansatz route: `"/canvas"` (default) or `"/render-artifact"`. */
  route?: "canvas" | "render-artifact" | undefined;
  /** Optional artifact ID when launching `/render-artifact/:artifactId`. */
  artifactId?: string | number | undefined;
  /** Presentation mode query param (defaults to `"webxr-vr"`). */
  mode?: "webxr-vr" | "spatial-3d" | undefined;
  /** Initial Engineering Rotunda environment preset (defaults to `"dark-lab"`). */
  environment?: VrRotundaEnvironment | string | undefined;
  /** Serialized `.mscanvas` JSON string (or object to stringify) encoded into `#vrBoard=...` hash fragment. */
  boardJson?: string | Record<string, unknown> | undefined;
  /** Optional raw source text for unsaved local files (`.step`, `.mo`, `.inp`, `.gcode`, `.urdf`, etc.) relayed via `BroadcastChannel`. */
  fileContent?: string | undefined;
  /** Optional language identifier for `fileContent` (e.g., `"step"`, `"modelica"`, `"fea"`, `"gcode"`, `"urdf"`). */
  languageId?: string | undefined;
  /** Optional explicit handoff correlation ID attached as `?handoffId=...` for `BroadcastChannel` payload relay. */
  handoffId?: string | undefined;
  /** Optional source artifact URI or workspace path for the target model/file. */
  artifactUri?: string | undefined;
  /** Optional human-readable title for the launched scene or board. */
  title?: string | undefined;
  /** Optional 3D domain/model kind (e.g., `"step"`, `"cad"`, `"fea"`, `"cfd"`, `"gcode"`, `"multibody"`). */
  kind?: string | undefined;
  /** Optional active Orbital Carousel model index. */
  activeModelIndex?: number | undefined;
  /** Maximum UTF-8 byte size for `#vrBoard=...` payload before safely omitting it (defaults to 128 KiB). */
  maxBoardBytes?: number | undefined;
  /** Suppress the VS Code information notification toast after launching. */
  silent?: boolean | undefined;
}

/** Payload relayed over `BroadcastChannel("modelscript-vr-handoff")` to a newly opened `/canvas?handoffId=...` tab. */
export interface VrHandoffBroadcastPayload {
  handoffId: string;
  boardJson?: string | undefined;
  fileContent?: string | undefined;
  languageId?: string | undefined;
  artifactUri?: string | undefined;
  title?: string | undefined;
  kind?: string | undefined;
  environment?: VrRotundaEnvironment | undefined;
  activeModelIndex?: number | undefined;
}

export interface PublishVrHandoffOptions {
  /** Auto-cleanup lifetime in milliseconds (defaults to 60,000 ms). */
  ttlMs?: number | undefined;
}

/**
 * Normalizes an environment preset name to a valid Engineering Rotunda environment ID.
 */
export function normalizeVrEnvironment(environment?: string | undefined): VrRotundaEnvironment {
  if (typeof environment === "string") {
    const normalized = environment.trim().toLowerCase();
    for (const valid of VALID_VR_ENVIRONMENTS) {
      if (normalized === valid) {
        return valid;
      }
    }
  }
  return "dark-lab";
}

function sanitizeBaseUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function serializeBoardJson(boardJson?: string | Record<string, unknown> | undefined): string | null {
  if (typeof boardJson === "string") {
    return boardJson.trim().length > 0 ? boardJson : null;
  }
  if (boardJson && typeof boardJson === "object") {
    try {
      return JSON.stringify(boardJson);
    } catch {
      return null;
    }
  }
  return null;
}

function generateVrHandoffId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `vr-${crypto.randomUUID()}`;
  }
  return `vr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolves the external Ansatz / ModelScript Web base URL for WebXR handoff.
 *
 * Precedence:
 * 1. Explicit `explicitBaseUrl` argument
 * 2. VS Code setting `modelscript.vrHostUrl`
 * 3. VS Code setting `modelscript.ansatzUrl`
 * 4. VS Code setting `modelscript.vr.hostUrl`
 * 5. Default `"https://ansatz.social"`
 */
export function resolveVrHostBaseUrl(explicitBaseUrl?: string | undefined): string {
  const explicit = sanitizeBaseUrl(explicitBaseUrl);
  if (explicit) return explicit;

  try {
    const rootCfg = vscode.workspace?.getConfiguration?.("modelscript");
    const fromVrHost = sanitizeBaseUrl(rootCfg?.get<string>("vrHostUrl"));
    if (fromVrHost) return fromVrHost;

    const fromAnsatzUrl = sanitizeBaseUrl(rootCfg?.get<string>("ansatzUrl"));
    if (fromAnsatzUrl) return fromAnsatzUrl;

    const vrCfg = vscode.workspace?.getConfiguration?.("modelscript.vr");
    const fromNestedHost = sanitizeBaseUrl(vrCfg?.get<string>("hostUrl"));
    if (fromNestedHost) return fromNestedHost;
  } catch {
    // Fallback cleanly outside VS Code extension host
  }

  return DEFAULT_VR_HOST_URL;
}

/**
 * Encodes an arbitrary UTF-8 string into URL-safe base64 (RFC 4648 §5, unpadded)
 * using Web-standard `TextEncoder` + chunked `btoa` so it works in both browsers and Node.
 */
export function encodeUtf8Base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Decodes a URL-safe base64 (RFC 4648 §5) string back into a UTF-8 string.
 * Returns `null` if the input is empty, malformed, or invalid UTF-8.
 */
export function decodeUtf8Base64Url(encoded: string): string | null {
  if (!encoded || typeof encoded !== "string") return null;
  const trimmed = encoded.trim();
  if (!trimmed || trimmed.length > MAX_DECODE_HASH_CHARS) return null;
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(trimmed)) return null;

  const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Publishes a VR handoff payload (unsaved local `.step`/`.mo`/`.inp`/`.gcode`/`.urdf` source text
 * and/or full `.mscanvas` board JSON) onto `BroadcastChannel("modelscript-vr-handoff")`.
 *
 * Responds to incoming `{ type: "vr-handoff-request", handoffId }` pings from the newly opened
 * `/canvas?handoffId=...` tab by posting `{ type: "vr-handoff-payload", ...payload }`, and
 * automatically closes the channel after `ttlMs` (default 60s) to prevent resource leaks.
 *
 * Returns a cleanup callback that immediately closes the channel and clears the timer.
 */
export function publishVrHandoffToBroadcastChannel(
  payload: VrHandoffBroadcastPayload,
  options: PublishVrHandoffOptions = {},
): () => void {
  const handoffId = typeof payload.handoffId === "string" ? payload.handoffId.trim() : "";
  if (!handoffId || typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(VR_HANDOFF_BROADCAST_CHANNEL);
  } catch {
    return () => {};
  }

  // Avoid keeping Node.js worker/test event loops alive solely because of an idle handoff channel.
  const unrefableChannel = channel as unknown as { unref?: () => void };
  if (typeof unrefableChannel.unref === "function") {
    unrefableChannel.unref();
  }

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    try {
      channel.onmessage = null;
    } catch {
      // ignore teardown errors
    }
    try {
      channel.close();
    } catch {
      // ignore close errors
    }
  };

  const normalizedPayload: VrHandoffBroadcastPayload = {
    ...payload,
    handoffId,
  };

  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (closed) return;
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    const rec = data as Record<string, unknown>;
    if (rec["type"] !== "vr-handoff-request") return;
    if (rec["handoffId"] !== handoffId) return;

    try {
      channel.postMessage({
        type: "vr-handoff-payload",
        ...normalizedPayload,
      });
    } catch {
      // Channel may already be closed
    }
  };

  const ttlMs =
    typeof options.ttlMs === "number" && Number.isFinite(options.ttlMs) && options.ttlMs > 0
      ? Math.floor(options.ttlMs)
      : DEFAULT_VR_HANDOFF_TTL_MS;
  timer = setTimeout(cleanup, ttlMs);
  const unrefableTimer = timer as unknown as { unref?: () => void };
  if (typeof unrefableTimer.unref === "function") {
    unrefableTimer.unref();
  }

  return cleanup;
}

/**
 * Builds the top-level browser URL for launching the Ansatz Engineering Rotunda in WebXR VR/AR.
 *
 * Serialized `.mscanvas` boards are UTF-8 base64url-encoded inside `#vrBoard=...` (URL hash fragment)
 * so payloads never hit HTTP server query length limits and are never sent to server access logs.
 * Oversized boards exceeding `maxBoardBytes` (default 128 KiB) are safely omitted from the hash
 * with `boardOmitted=1` set in query parameters.
 */
export function buildExternalVrRotundaUrl(opts: VrHandoffOptions = {}): string {
  const baseUrl = resolveVrHostBaseUrl(opts.baseUrl);
  const env = normalizeVrEnvironment(opts.environment);
  const mode = opts.mode === "spatial-3d" ? "spatial-3d" : "webxr-vr";

  let routePath = "/canvas";
  if (opts.route === "render-artifact") {
    const idStr = opts.artifactId !== undefined ? String(opts.artifactId).trim() : "";
    routePath = idStr ? `/render-artifact/${encodeURIComponent(idStr)}` : "/render-artifact";
  }

  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("env", env);

  if (typeof opts.handoffId === "string" && opts.handoffId.trim().length > 0) {
    params.set("handoffId", opts.handoffId.trim());
  }
  if (typeof opts.artifactUri === "string" && opts.artifactUri.trim().length > 0) {
    params.set("artifact", opts.artifactUri.trim());
  }
  if (typeof opts.title === "string" && opts.title.trim().length > 0) {
    params.set("title", opts.title.trim());
  }
  if (typeof opts.kind === "string" && opts.kind.trim().length > 0) {
    params.set("kind", opts.kind.trim());
  }
  if (
    typeof opts.activeModelIndex === "number" &&
    Number.isFinite(opts.activeModelIndex) &&
    opts.activeModelIndex >= 0
  ) {
    params.set("model", String(Math.floor(opts.activeModelIndex)));
  }

  let hash = "";
  const serializedBoard = serializeBoardJson(opts.boardJson);

  if (serializedBoard !== null) {
    const maxBytes =
      typeof opts.maxBoardBytes === "number" && Number.isFinite(opts.maxBoardBytes) && opts.maxBoardBytes > 0
        ? Math.floor(opts.maxBoardBytes)
        : DEFAULT_MAX_VR_BOARD_BYTES;
    const byteLength = new TextEncoder().encode(serializedBoard).byteLength;
    if (byteLength <= maxBytes) {
      hash = `#vrBoard=${encodeUtf8Base64Url(serializedBoard)}`;
    } else {
      params.set("boardOmitted", "1");
    }
  }

  return `${baseUrl}${routePath}?${params.toString()}${hash}`;
}

/**
 * Decodes the serialized `.mscanvas` board JSON from a URL hash fragment (e.g. `window.location.hash`
 * or full URL containing `#vrBoard=...`) produced by `buildExternalVrRotundaUrl`.
 *
 * Returns `null` when no `#vrBoard=` parameter is present or the payload is invalid.
 */
export function decodeVrBoardFromHash(hash: string): string | null {
  if (!hash || typeof hash !== "string") return null;

  const hashIdx = hash.indexOf("#");
  const fragment = hashIdx >= 0 ? hash.slice(hashIdx + 1) : hash;
  const trimmed = fragment.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const encoded = params.get("vrBoard");
  if (!encoded) return null;

  return decodeUtf8Base64Url(encoded);
}

/**
 * Opens the Engineering Rotunda in a top-level external browser tab via `vscode.env.openExternal`
 * so WebXR (`immersive-vr` / `immersive-ar`) can run outside VS Code's sandboxed webview iframe.
 *
 * When `fileContent` or `boardJson` is provided, generates a `handoffId`, attaches `?handoffId=...`
 * to the launched URL, publishes the full payload via `BroadcastChannel` for same-origin tabs,
 * and preserves `#vrBoard=...` hash encoding for cross-origin fallback.
 */
export async function openExternalVrRotunda(opts: VrHandoffOptions = {}): Promise<boolean> {
  const env = normalizeVrEnvironment(opts.environment);
  const serializedBoard = serializeBoardJson(opts.boardJson);
  const fileContent =
    typeof opts.fileContent === "string" && opts.fileContent.length > 0 ? opts.fileContent : undefined;
  const hasRelayPayload = serializedBoard !== null || fileContent !== undefined;

  const explicitHandoffId =
    typeof opts.handoffId === "string" && opts.handoffId.trim().length > 0 ? opts.handoffId.trim() : undefined;
  const handoffId = explicitHandoffId ?? (hasRelayPayload ? generateVrHandoffId() : undefined);

  const effectiveOpts: VrHandoffOptions = handoffId ? { ...opts, handoffId } : opts;
  const url = buildExternalVrRotundaUrl(effectiveOpts);

  let cleanupBroadcast: (() => void) | undefined;
  if (handoffId && hasRelayPayload) {
    cleanupBroadcast = publishVrHandoffToBroadcastChannel({
      handoffId,
      ...(serializedBoard !== null ? { boardJson: serializedBoard } : {}),
      ...(fileContent !== undefined ? { fileContent } : {}),
      ...(typeof opts.languageId === "string" && opts.languageId.trim().length > 0
        ? { languageId: opts.languageId.trim() }
        : {}),
      ...(typeof opts.artifactUri === "string" && opts.artifactUri.trim().length > 0
        ? { artifactUri: opts.artifactUri.trim() }
        : {}),
      ...(typeof opts.title === "string" && opts.title.trim().length > 0 ? { title: opts.title.trim() } : {}),
      ...(typeof opts.kind === "string" && opts.kind.trim().length > 0 ? { kind: opts.kind.trim() } : {}),
      environment: env,
      ...(typeof opts.activeModelIndex === "number" &&
      Number.isFinite(opts.activeModelIndex) &&
      opts.activeModelIndex >= 0
        ? { activeModelIndex: Math.floor(opts.activeModelIndex) }
        : {}),
    });
  }

  try {
    const openExternal = vscode.env?.openExternal;
    if (typeof openExternal !== "function") {
      cleanupBroadcast?.();
      return false;
    }
    const opened = await openExternal(vscode.Uri.parse(url));
    if (!opened) {
      cleanupBroadcast?.();
    }
    if (opened && !opts.silent) {
      const label = opts.title?.trim() ? `'${opts.title.trim()}'` : "Engineering Rotunda";
      void vscode.window?.showInformationMessage?.(`Opened ${label} in top-level WebXR VR browser tab (env: ${env}).`);
    }
    return Boolean(opened);
  } catch (err) {
    cleanupBroadcast?.();
    if (!opts.silent) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window?.showWarningMessage?.(`Could not open external WebXR VR tab: ${msg}`);
    }
    return false;
  }
}

export interface OpenInVrMessageDefaults {
  artifactUri?: string | undefined;
  title?: string | undefined;
  kind?: string | undefined;
  fileContent?: string | (() => string | undefined) | undefined;
  languageId?: string | undefined;
}

const vrHandoffAttachedPanels = new WeakSet<vscode.WebviewPanel>();

/**
 * Handles `"openInVr"` webview messages from STEP, CAD, FEA, CFD, GCode, and Multibody
 * custom editors / panels by launching a top-level WebXR VR browser tab via `openExternalVrRotunda`.
 *
 * Returns `true` if the message was an `"openInVr"` message and was dispatched, `false` otherwise.
 */
export async function handleOpenInVrWebviewMessage(
  msg: unknown,
  defaults: OpenInVrMessageDefaults = {},
): Promise<boolean> {
  if (!msg || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  const type = rec["type"] ?? rec["command"];
  if (type !== "openInVr") return false;

  const rawBoard = rec["boardJson"] ?? rec["document"];
  const boardJson =
    typeof rawBoard === "string" || (rawBoard !== null && typeof rawBoard === "object")
      ? (rawBoard as string | Record<string, unknown>)
      : undefined;

  const defaultFileContent = typeof defaults.fileContent === "function" ? defaults.fileContent() : defaults.fileContent;
  const fileContent = typeof rec["fileContent"] === "string" ? rec["fileContent"] : defaultFileContent;
  const languageId = typeof rec["languageId"] === "string" ? rec["languageId"] : defaults.languageId;
  const handoffId = typeof rec["handoffId"] === "string" ? rec["handoffId"] : undefined;

  await openExternalVrRotunda({
    baseUrl: typeof rec["baseUrl"] === "string" ? rec["baseUrl"] : undefined,
    route: rec["route"] === "render-artifact" ? "render-artifact" : "canvas",
    artifactId:
      typeof rec["artifactId"] === "string" || typeof rec["artifactId"] === "number" ? rec["artifactId"] : undefined,
    mode: rec["mode"] === "spatial-3d" ? "spatial-3d" : "webxr-vr",
    environment: typeof rec["environment"] === "string" ? rec["environment"] : "dark-lab",
    boardJson,
    fileContent,
    languageId,
    handoffId,
    artifactUri: typeof rec["artifactUri"] === "string" ? rec["artifactUri"] : defaults.artifactUri,
    title: typeof rec["title"] === "string" ? rec["title"] : defaults.title,
    kind: typeof rec["kind"] === "string" ? rec["kind"] : defaults.kind,
    activeModelIndex: typeof rec["activeModelIndex"] === "number" ? rec["activeModelIndex"] : undefined,
  });
  return true;
}

/**
 * Attaches an idempotent `"openInVr"` webview message handler to a VS Code WebviewPanel.
 * Calling this more than once on the same panel is a safe no-op so wrapped custom editors
 * never open duplicate external VR browser tabs.
 */
export function attachVrHandoffListener(
  webviewPanel: vscode.WebviewPanel,
  defaults: OpenInVrMessageDefaults = {},
): vscode.Disposable {
  if (vrHandoffAttachedPanels.has(webviewPanel)) {
    return new vscode.Disposable(() => {});
  }
  vrHandoffAttachedPanels.add(webviewPanel);
  return webviewPanel.webview.onDidReceiveMessage((msg: unknown) => {
    void handleOpenInVrWebviewMessage(msg, defaults);
  });
}
