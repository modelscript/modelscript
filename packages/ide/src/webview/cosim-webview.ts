// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Co-simulation panel webview script.
// Runs inside the VS Code sidebar webview. Communicates with the extension
// host (cosimPanel.ts) via postMessage.

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── DOM refs ──

const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
const modeStatus = document.getElementById("mode-status")!;
const btnRefresh = document.getElementById("btn-refresh")!;

const configSection = document.getElementById("config-section")!;
const inputApiUrl = document.getElementById("input-api-url") as HTMLInputElement;
const inputMqttUrl = document.getElementById("input-mqtt-url") as HTMLInputElement;
const btnSaveConfig = document.getElementById("btn-save-config")!;
const btnCancelConfig = document.getElementById("btn-cancel-config")!;

const wrapperBanner = document.getElementById("wrapper-banner")!;
const btnImportWrapper = document.getElementById("btn-import-wrapper")!;

const sessionsList = document.getElementById("sessions-list")!;
const btnQuickStart = document.getElementById("btn-quick-start")!;
const btnCreateSession = document.getElementById("btn-create-session")!;
const newSessionSection = document.getElementById("new-session-section")!;
const inputStartTime = document.getElementById("input-start-time") as HTMLInputElement;
const inputStopTime = document.getElementById("input-stop-time") as HTMLInputElement;
const inputStepSize = document.getElementById("input-step-size") as HTMLInputElement;
const inputRtFactor = document.getElementById("input-rt-factor") as HTMLInputElement;
const selectMasterAlgorithm = document.getElementById("select-master-algorithm") as HTMLSelectElement | null;
const fieldTolerance = document.getElementById("field-tolerance");
const inputTolerance = document.getElementById("input-tolerance") as HTMLInputElement | null;
const selectLoopRemediation = document.getElementById("select-loop-remediation") as HTMLSelectElement | null;
const btnSubmitSession = document.getElementById("btn-submit-session")!;
const btnCancelSession = document.getElementById("btn-cancel-session")!;

const hilProtocolSelect = document.getElementById("hil-protocol-select") as HTMLSelectElement | null;
const hilBaudSelect = document.getElementById("hil-baud-select") as HTMLSelectElement | null;
const hilStatusBadge = document.getElementById("hil-status-badge");
const hilMetrics = document.getElementById("hil-metrics");
const btnConnectHardware = document.getElementById("btn-connect-hardware") as HTMLButtonElement | null;
const btnDisconnectHardware = document.getElementById("btn-disconnect-hardware") as HTMLButtonElement | null;
const btnPauseCan = document.getElementById("btn-pause-can") as HTMLButtonElement | null;
const btnClearCan = document.getElementById("btn-clear-can") as HTMLButtonElement | null;
const canFrameRows = document.getElementById("can-frame-rows");

const errorContainer = document.getElementById("error-container")!;

// ── State ──

let isLocalMode = true; // Default to local mode

// ── Section collapse ──

document.querySelectorAll(".section-header").forEach((header) => {
  header.addEventListener("click", () => {
    const body = header.nextElementSibling;
    if (!body) return;
    header.classList.toggle("collapsed");
    body.classList.toggle("hidden");
  });
});

// ── Mode selector ──

modeSelect.addEventListener("change", () => {
  const mode = modeSelect.value;
  if (mode === "local") {
    vscode.postMessage({ type: "enableLocal" });
    configSection.style.display = "none";
  } else {
    vscode.postMessage({ type: "disableLocal" });
    configSection.style.display = "";
    vscode.postMessage({ type: "getConfig" });
  }
});

btnRefresh.addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

// ── Config ──

btnSaveConfig.addEventListener("click", () => {
  vscode.postMessage({
    type: "updateConfig",
    apiUrl: inputApiUrl.value || undefined,
    mqttWsUrl: inputMqttUrl.value || undefined,
  });
  configSection.style.display = "none";
});

btnCancelConfig.addEventListener("click", () => {
  configSection.style.display = "none";
});

// ── Wrapper banner ──

btnImportWrapper.addEventListener("click", () => {
  // Find the first "created" session, or create one
  const firstSession = sessionsList.querySelector(".session-card[data-session-id]");
  if (firstSession) {
    const sessionId = firstSession.getAttribute("data-session-id");
    if (sessionId) {
      vscode.postMessage({ type: "publishCosimModel", sessionId });
    }
  } else {
    // Quick-create a session and then import
    vscode.postMessage({
      type: "createSession",
      startTime: 0,
      stopTime: 10,
      stepSize: 0.01,
      realtimeFactor: 1,
      autoImportWrapper: true,
    });
  }
});

// ── Sessions ──

btnQuickStart.addEventListener("click", () => {
  vscode.postMessage({
    type: "createSession",
    startTime: 0,
    stopTime: 10,
    stepSize: 0.01,
    realtimeFactor: 1,
  });
});

btnCreateSession.addEventListener("click", () => {
  newSessionSection.style.display = newSessionSection.style.display === "none" ? "" : "none";
});

selectMasterAlgorithm?.addEventListener("change", () => {
  if (fieldTolerance) {
    const val = selectMasterAlgorithm.value;
    fieldTolerance.style.display = val === "richardson" || val === "newton" ? "" : "none";
  }
});

btnSubmitSession.addEventListener("click", () => {
  const masterAlgorithm = selectMasterAlgorithm?.value ?? "gauss-seidel";
  const tolerance = inputTolerance ? parseFloat(inputTolerance.value) : 1e-4;
  const loopRemediation = selectLoopRemediation?.value;
  vscode.postMessage({
    type: "createSession",
    startTime: parseFloat(inputStartTime.value),
    stopTime: parseFloat(inputStopTime.value),
    stepSize: parseFloat(inputStepSize.value),
    realtimeFactor: parseFloat(inputRtFactor.value),
    masterAlgorithm,
    richardsonTolerance: isNaN(tolerance) ? 1e-4 : tolerance,
    autoRemediateLoops: loopRemediation && loopRemediation !== "none" ? loopRemediation : undefined,
  });
  newSessionSection.style.display = "none";
});

btnCancelSession.addEventListener("click", () => {
  newSessionSection.style.display = "none";
});

// ── Message handling ──

interface HealthMsg {
  type: "healthUpdate";
  api: boolean;
  mqtt: boolean | string;
  historian: boolean | string;
  localMode?: boolean;
}

interface SessionInfo {
  id: string;
  sessionId?: string;
  state: string;
  masterAlgorithm?: string;
  autoRemediateLoops?: boolean | string;
  participants?: number;
}

interface ParticipantInfo {
  id: string;
  modelName: string;
  type: string;
  variables: number;
}

interface CouplingInfo {
  from: { participantId: string; variableName: string };
  to: { participantId: string; variableName: string };
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "healthUpdate":
      updateHealth(msg as HealthMsg);
      break;

    case "config":
      inputApiUrl.value = msg.apiUrl ?? "";
      inputMqttUrl.value = msg.mqttWsUrl ?? "";
      break;

    case "sessionList":
      renderSessions((msg.sessions ?? []) as SessionInfo[]);
      break;

    case "participantList":
      renderParticipants(msg.sessionId as string, (msg.participants ?? []) as ParticipantInfo[]);
      break;

    case "couplingList":
      renderCouplings(msg.sessionId as string, (msg.couplings ?? []) as CouplingInfo[]);
      break;

    case "sessionCreated":
      // Session list will auto-refresh
      break;

    case "simulationProgress":
      renderProgress(
        msg.sessionId as string,
        msg.currentTime as number,
        msg.startTime as number,
        msg.stopTime as number,
      );
      break;

    case "cosimWrapperDetected":
      wrapperBanner.classList.toggle("visible", msg.detected as boolean);
      break;

    case "hardwareStatus": {
      const hStatus = msg as { connected: boolean; baudRate?: number; protocol?: string };
      if (hStatus.connected) {
        if (hilStatusBadge) {
          hilStatusBadge.className = "hil-badge connected";
          hilStatusBadge.textContent = `● Connected (${hStatus.baudRate ?? 500000} baud)`;
        }
        if (btnDisconnectHardware) btnDisconnectHardware.disabled = false;
        if (btnConnectHardware) btnConnectHardware.disabled = true;
      } else {
        if (hilStatusBadge) {
          hilStatusBadge.className = "hil-badge disconnected";
          hilStatusBadge.textContent = "● Disconnected";
        }
        if (btnDisconnectHardware) btnDisconnectHardware.disabled = true;
        if (btnConnectHardware) btnConnectHardware.disabled = false;
      }
      break;
    }

    case "error":
      showError(msg.message as string);
      break;
  }
});

// ── Health rendering ──

function updateHealth(h: HealthMsg): void {
  isLocalMode = h.localMode === true;

  // Sync the mode dropdown
  modeSelect.value = isLocalMode ? "local" : "remote";

  if (isLocalMode) {
    modeStatus.textContent = "● Local";
    modeStatus.className = "mode-status local";
  } else if (h.api) {
    modeStatus.textContent = "● Connected";
    modeStatus.className = "mode-status ready";
  } else {
    modeStatus.textContent = "● Offline";
    modeStatus.className = "mode-status offline";
  }
}

// ── Session rendering ──

function createActionButton(
  label: string,
  action: "start" | "stop" | "delete" | "addParticipant" | "livePlot",
  sessionId: string,
  options?: { className?: string; style?: string; title?: string },
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.dataset.action = action;
  btn.dataset.id = sessionId;
  if (options?.className) btn.className = options.className;
  if (options?.style) btn.style.cssText = options.style;
  if (options?.title) btn.title = options.title;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    switch (action) {
      case "start":
        vscode.postMessage({ type: "startSession", sessionId });
        break;
      case "stop":
        vscode.postMessage({ type: "stopSession", sessionId });
        break;
      case "delete":
        vscode.postMessage({ type: "deleteSession", sessionId });
        break;
      case "addParticipant":
        toggleAddPicker(sessionId);
        break;
      case "livePlot":
        vscode.postMessage({ type: "openLivePlot", sessionId });
        break;
    }
  });
  return btn;
}

function renderSessions(sessions: SessionInfo[]): void {
  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.appendChild(document.createTextNode("No active sessions"));
    empty.appendChild(document.createElement("br"));
    const hint = document.createElement("span");
    hint.style.fontSize = "11px";
    hint.style.opacity = "0.7";
    hint.textContent = "Click ⚡ Quick Start to begin";
    empty.appendChild(hint);
    sessionsList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const s of sessions) {
    const id = String(s.sessionId ?? s.id);
    const stateClass =
      s.state === "running"
        ? "running"
        : s.state === "completed"
          ? "completed"
          : s.state === "error"
            ? "error"
            : "created";

    const card = document.createElement("div");
    card.className = "session-card";
    card.dataset.sessionId = id;

    const header = document.createElement("div");
    header.className = "session-header";

    const stateBadge = document.createElement("span");
    stateBadge.className = `badge ${stateClass}`;
    stateBadge.textContent = s.state;
    header.appendChild(stateBadge);

    if (s.masterAlgorithm) {
      const algoBadge = document.createElement("span");
      algoBadge.className = "badge";
      algoBadge.style.cssText =
        "font-size:9px;opacity:0.85;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)";
      algoBadge.title = "Algorithm";
      algoBadge.textContent = s.masterAlgorithm;
      header.appendChild(algoBadge);
    }

    const idSpan = document.createElement("span");
    idSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    idSpan.title = id;
    idSpan.textContent = `${id.slice(0, 12)}…`;
    header.appendChild(idSpan);

    header.appendChild(
      createActionButton("✕", "delete", id, {
        className: "secondary",
        style: "padding:1px 4px;font-size:10px",
        title: "Delete session",
      }),
    );
    card.appendChild(header);

    const participantArea = document.createElement("div");
    participantArea.className = "participant-area";
    participantArea.id = `participants-${id}`;
    card.appendChild(participantArea);

    const couplingArea = document.createElement("div");
    couplingArea.className = "coupling-area";
    couplingArea.id = `couplings-${id}`;
    card.appendChild(couplingArea);

    if (s.state === "running") {
      const progressContainer = document.createElement("div");
      progressContainer.className = "progress-container";
      progressContainer.id = `progress-${id}`;

      const progressTrack = document.createElement("div");
      progressTrack.className = "progress-track";

      const progressFill = document.createElement("div");
      progressFill.className = "progress-fill";
      progressFill.style.width = "0%";
      progressTrack.appendChild(progressFill);

      const progressText = document.createElement("span");
      progressText.className = "progress-text";
      progressText.textContent = "Starting…";

      progressContainer.append(progressTrack, progressText);
      card.appendChild(progressContainer);
    }

    const actions = document.createElement("div");
    actions.className = "session-actions";
    if (s.state === "created") {
      actions.appendChild(createActionButton("+ Add Participant", "addParticipant", id, { className: "secondary" }));
      actions.appendChild(createActionButton("▶ Start", "start", id));
    } else if (s.state === "running") {
      actions.appendChild(createActionButton("⏹ Stop", "stop", id));
      actions.appendChild(createActionButton("📈 Live Plot", "livePlot", id, { className: "secondary" }));
    }
    card.appendChild(actions);

    const pickerContainer = document.createElement("div");
    pickerContainer.className = "add-picker-container";
    pickerContainer.id = `picker-${id}`;
    pickerContainer.style.display = "none";
    card.appendChild(pickerContainer);

    fragment.appendChild(card);
  }

  sessionsList.replaceChildren(fragment);

  // Fetch participants for each session
  for (const s of sessions) {
    const id = s.sessionId ?? s.id;
    vscode.postMessage({ type: "fetchParticipants", sessionId: id });
  }
}

// ── Add Participant Picker ──

interface PickerOptionSpec {
  action: "cosim" | "model" | "fmu" | "ssp" | "wrapper";
  icon: string;
  label: string;
  desc: string;
  recommended?: boolean;
  dividerBefore?: boolean;
}

const PICKER_OPTIONS: readonly PickerOptionSpec[] = [
  {
    action: "cosim",
    icon: "🔗",
    label: "From Modelica Wrapper",
    desc: "Import participants & couplings from the open .mo file with connect() equations",
    recommended: true,
  },
  {
    action: "model",
    icon: "📄",
    label: "From Open .mo File",
    desc: "Add the active Modelica model as a single participant",
  },
  {
    action: "fmu",
    icon: "📦",
    label: "From FMU File",
    desc: "Browse for a .fmu or modelDescription.xml file",
  },
  {
    action: "ssp",
    icon: "🧩",
    label: "From SSP File",
    desc: "Browse for a .ssp archive file",
  },
  {
    action: "wrapper",
    icon: "🔧",
    label: "Generate Wrapper",
    desc: "Create a Modelica wrapper from current participants",
    dividerBefore: true,
  },
];

function toggleAddPicker(sessionId: string): void {
  const container = document.getElementById(`picker-${sessionId}`);
  if (!container) return;

  if (container.style.display !== "none") {
    container.style.display = "none";
    return;
  }

  container.style.display = "";
  const picker = document.createElement("div");
  picker.className = "add-picker";

  for (const spec of PICKER_OPTIONS) {
    if (spec.dividerBefore) {
      const divider = document.createElement("div");
      divider.className = "add-picker-divider";
      picker.appendChild(divider);
    }

    const option = document.createElement("div");
    option.className = "add-picker-option";
    option.dataset.pickerAction = spec.action;
    option.dataset.session = sessionId;

    const iconEl = document.createElement("span");
    iconEl.className = "icon";
    iconEl.textContent = spec.icon;

    const body = document.createElement("div");
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = spec.label;
    body.appendChild(labelEl);

    if (spec.recommended) {
      const recEl = document.createElement("span");
      recEl.className = "recommended";
      recEl.textContent = "Recommended";
      body.appendChild(recEl);
    }

    const descEl = document.createElement("div");
    descEl.className = "desc";
    descEl.textContent = spec.desc;
    body.appendChild(descEl);

    option.append(iconEl, body);
    option.addEventListener("click", () => {
      switch (spec.action) {
        case "cosim":
          vscode.postMessage({ type: "publishCosimModel", sessionId });
          break;
        case "model":
          vscode.postMessage({ type: "publishModel", sessionId });
          break;
        case "fmu":
          vscode.postMessage({ type: "publishFmu", sessionId });
          break;
        case "ssp":
          vscode.postMessage({ type: "publishSsp", sessionId });
          break;
        case "wrapper":
          vscode.postMessage({ type: "createCosimWrapper", sessionId });
          break;
      }
      container.style.display = "none";
    });
    picker.appendChild(option);
  }

  container.replaceChildren(picker);
}

// ── Participant rendering ──

function renderParticipants(sessionId: string, participants: ParticipantInfo[]): void {
  const container = document.getElementById(`participants-${sessionId}`);
  if (!container) return;

  if (participants.length === 0) {
    const empty = document.createElement("div");
    empty.className = "session-meta";
    empty.style.cssText = "margin-top:4px;text-align:center;opacity:0.7";
    empty.textContent = "No participants yet";
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const p of participants) {
    const row = document.createElement("div");
    row.className = "session-meta";
    row.style.marginTop = "2px";

    const icon = p.type === "fmu" ? "📦" : p.type === "ssp" ? "🧩" : "📄";
    row.appendChild(document.createTextNode(`${icon} `));

    const nameEl = document.createElement("strong");
    nameEl.textContent = p.modelName;
    row.appendChild(nameEl);

    row.appendChild(document.createTextNode(" "));

    const metaEl = document.createElement("span");
    metaEl.style.opacity = "0.6";
    const varSuffix = p.variables ? `, ${Number(p.variables)} vars` : "";
    metaEl.textContent = `(${p.type}${varSuffix})`;
    row.appendChild(metaEl);

    fragment.appendChild(row);
  }
  container.replaceChildren(fragment);
}

// ── Coupling rendering ──

function renderCouplings(sessionId: string, couplings: CouplingInfo[]): void {
  const container = document.getElementById(`couplings-${sessionId}`);
  if (!container) return;

  if (couplings.length === 0) {
    container.replaceChildren();
    return;
  }

  const list = document.createElement("div");
  list.className = "coupling-list";

  const heading = document.createElement("div");
  heading.className = "session-meta";
  heading.style.cssText = "margin-top:4px;font-weight:500;opacity:1";
  heading.textContent = "Couplings";
  list.appendChild(heading);

  for (const c of couplings) {
    const item = document.createElement("div");
    item.className = "coupling-item";

    const fromSpan = document.createElement("span");
    fromSpan.textContent = `${abbreviateId(c.from.participantId)}.${c.from.variableName}`;

    const arrowSpan = document.createElement("span");
    arrowSpan.className = "coupling-arrow";
    arrowSpan.textContent = "──→";

    const toSpan = document.createElement("span");
    toSpan.textContent = `${abbreviateId(c.to.participantId)}.${c.to.variableName}`;

    item.append(fromSpan, arrowSpan, toSpan);
    list.appendChild(item);
  }

  container.replaceChildren(list);
}

/** Shorten a participant ID for display. */
function abbreviateId(id: string): string {
  // Prefer the model name portion (e.g., "cosim-Controller-xxx" → "Controller")
  const parts = id.split("-");
  if (parts.length >= 3) return parts[1] ?? id.slice(0, 8);
  return id.slice(0, 8);
}

// ── Progress rendering ──

function renderProgress(sessionId: string, currentTime: number, startTime: number, stopTime: number): void {
  const container = document.getElementById(`progress-${sessionId}`);
  if (!container) return;

  const span = stopTime - startTime;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((currentTime - startTime) / span) * 100)) : 0;
  const fill = container.querySelector(".progress-fill") as HTMLElement | null;
  const text = container.querySelector(".progress-text") as HTMLElement | null;

  if (fill) fill.style.width = `${pct.toFixed(1)}%`;
  if (text) text.textContent = `t=${currentTime.toFixed(2)}s / ${stopTime}s (${pct.toFixed(0)}%)`;
}

// ── Error display ──

function showError(message: string): void {
  const div = document.createElement("div");
  div.className = "error-msg";
  div.style.margin = "10px 14px";
  div.textContent = message;
  errorContainer.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

// ── Soft HIL & Real-Time CAN Inspector ──

interface CanFrameLogEntry {
  timestamp: number;
  dir: "RX" | "TX";
  id: string;
  dlc: number;
  payload: string;
  signals: string;
}

const canRingBuffer: CanFrameLogEntry[] = [];
const MAX_CAN_BUFFER = 100;
let isCanPaused = false;
let totalFrames = 0;
let fpsCounter = 0;
let lastFpsTime = performance.now();

interface WebSerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable?: ReadableStream<Uint8Array> | null | undefined;
}

interface NavigatorWithSerial {
  serial?:
    | {
        requestPort(): Promise<WebSerialPort>;
      }
    | undefined;
}

let activeSerialPort: WebSerialPort | null = null;
let activeSerialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

async function connectWebSerial(): Promise<void> {
  const nav = navigator as unknown as NavigatorWithSerial;
  if (!nav.serial) {
    showError("WebSerial API is not supported or accessible in this browser.");
    return;
  }
  try {
    if (btnConnectHardware) btnConnectHardware.disabled = true;
    activeSerialPort = await nav.serial.requestPort();
    const baudRate = parseInt(hilBaudSelect?.value ?? "500000", 10);
    await activeSerialPort.open({ baudRate });

    if (hilStatusBadge) {
      hilStatusBadge.className = "hil-badge connected";
      hilStatusBadge.textContent = `● Connected (${baudRate} baud)`;
    }
    if (btnDisconnectHardware) btnDisconnectHardware.disabled = false;

    vscode.postMessage({
      type: "hardwareConnected",
      protocol: hilProtocolSelect?.value ?? "slcan",
      baudRate,
      portName: "WebSerial Device",
    });

    void readSerialStream(activeSerialPort);
  } catch (err: unknown) {
    showError(`Failed to connect serial device: ${err instanceof Error ? err.message : String(err)}`);
    if (btnConnectHardware) btnConnectHardware.disabled = false;
  }
}

async function disconnectWebSerial(): Promise<void> {
  if (activeSerialReader) {
    try {
      await activeSerialReader.cancel();
    } catch {
      // Best-effort reader cancel
    }
    activeSerialReader = null;
  }
  if (activeSerialPort) {
    try {
      await activeSerialPort.close();
    } catch {
      // Best-effort serial port / reader cleanup
    }
    activeSerialPort = null;
  }
  if (hilStatusBadge) {
    hilStatusBadge.className = "hil-badge disconnected";
    hilStatusBadge.textContent = "● Disconnected";
  }
  if (btnConnectHardware) btnConnectHardware.disabled = false;
  if (btnDisconnectHardware) btnDisconnectHardware.disabled = true;

  vscode.postMessage({ type: "hardwareDisconnected" });
}

async function readSerialStream(port: WebSerialPort): Promise<void> {
  while (port.readable && activeSerialPort === port) {
    const reader = port.readable.getReader();
    activeSerialReader = reader;
    try {
      const decoder = new TextDecoder();
      let lineBuffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            processIncomingSerialLine(line.trim());
          }
        }
      }
    } catch (err: unknown) {
      console.warn("Serial read loop terminated:", err instanceof Error ? err.message : String(err));
      break;
    } finally {
      if (activeSerialReader === reader) {
        activeSerialReader = null;
      }
      try {
        reader.releaseLock();
      } catch {
        // Best-effort serial port / reader cleanup
      }
    }
  }
}

function processIncomingSerialLine(line: string): void {
  totalFrames++;
  fpsCounter++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    const fps = Math.round((fpsCounter * 1000) / (now - lastFpsTime));
    fpsCounter = 0;
    lastFpsTime = now;
    if (hilMetrics) {
      hilMetrics.textContent = `${totalFrames} frames | ${fps} fps`;
    }
  }

  let idStr = "---";
  let dlc = 0;
  let payloadHex = line;
  const decodedSignals = "";

  if (line.startsWith("t") && line.length >= 5) {
    idStr = "0x" + line.substring(1, 4).toUpperCase();
    dlc = parseInt(line.charAt(4), 10) || 0;
    payloadHex = line.substring(5);
  } else if (line.startsWith("T") && line.length >= 10) {
    idStr = "0x" + line.substring(1, 9).toUpperCase();
    dlc = parseInt(line.charAt(9), 10) || 0;
    payloadHex = line.substring(10);
  }

  if (canRingBuffer.length >= MAX_CAN_BUFFER) {
    canRingBuffer.shift();
  }
  canRingBuffer.push({
    timestamp: Math.round(now),
    dir: "RX",
    id: idStr,
    dlc,
    payload: payloadHex,
    signals: decodedSignals,
  });

  if (!isCanPaused) {
    renderCanMonitor();
  }
}

function renderCanMonitor(): void {
  if (!canFrameRows) return;
  if (canRingBuffer.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.style.cssText = "text-align: center; opacity: 0.5; padding: 12px 0;";
    td.textContent = "No traffic on bus";
    tr.appendChild(td);
    canFrameRows.replaceChildren(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of canRingBuffer.slice(-20).reverse()) {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--vscode-widget-border)";

    const tdDir = document.createElement("td");
    tdDir.style.padding = "2px 4px";
    tdDir.className = entry.dir === "RX" ? "can-dir-rx" : "can-dir-tx";
    tdDir.textContent = entry.dir;

    const tdId = document.createElement("td");
    tdId.style.cssText = "padding: 2px 4px; font-weight: 600;";
    tdId.textContent = entry.id;

    const tdDlc = document.createElement("td");
    tdDlc.style.padding = "2px 4px";
    tdDlc.textContent = String(entry.dlc);

    const tdPayload = document.createElement("td");
    tdPayload.style.cssText = "padding: 2px 4px; font-family: monospace;";
    tdPayload.textContent = entry.payload;

    const tdSignals = document.createElement("td");
    tdSignals.style.cssText = "padding: 2px 4px; opacity: 0.9;";
    tdSignals.textContent = entry.signals;

    tr.append(tdDir, tdId, tdDlc, tdPayload, tdSignals);
    fragment.appendChild(tr);
  }
  canFrameRows.replaceChildren(fragment);
}

btnConnectHardware?.addEventListener("click", () => {
  void connectWebSerial();
});

btnDisconnectHardware?.addEventListener("click", () => {
  void disconnectWebSerial();
});

btnClearCan?.addEventListener("click", () => {
  canRingBuffer.length = 0;
  totalFrames = 0;
  if (hilMetrics) hilMetrics.textContent = "0 frames | 0 fps";
  renderCanMonitor();
});

btnPauseCan?.addEventListener("click", () => {
  isCanPaused = !isCanPaused;
  if (btnPauseCan) btnPauseCan.textContent = isCanPaused ? "Resume" : "Pause";
});

// ── Initial setup: auto-enable local mode ──

vscode.postMessage({ type: "enableLocal" });
vscode.postMessage({ type: "refresh" });

export {};
