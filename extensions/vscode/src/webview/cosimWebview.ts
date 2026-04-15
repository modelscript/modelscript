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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
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
const btnSubmitSession = document.getElementById("btn-submit-session")!;
const btnCancelSession = document.getElementById("btn-cancel-session")!;

const errorContainer = document.getElementById("error-container")!;
/* eslint-enable @typescript-eslint/no-non-null-assertion */

function escapeHtmlCosim(unsafe: string): string {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

btnSubmitSession.addEventListener("click", () => {
  vscode.postMessage({
    type: "createSession",
    startTime: parseFloat(inputStartTime.value),
    stopTime: parseFloat(inputStopTime.value),
    stepSize: parseFloat(inputStepSize.value),
    realtimeFactor: parseFloat(inputRtFactor.value),
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

function renderSessions(sessions: SessionInfo[]): void {
  if (sessions.length === 0) {
    sessionsList.innerHTML =
      '<div class="empty-state">No active sessions<br><span style="font-size:11px;opacity:0.7">Click ⚡ Quick Start to begin</span></div>';
    return;
  }

  sessionsList.innerHTML = sessions
    .map((s) => {
      const id = escapeHtmlCosim(s.sessionId ?? s.id);
      const safeState = escapeHtmlCosim(s.state);
      const stateClass =
        s.state === "running"
          ? "running"
          : s.state === "completed"
            ? "completed"
            : s.state === "error"
              ? "error"
              : "created";
      return `
      <div class="session-card" data-session-id="${id}">
        <div class="session-header">
          <span class="badge ${stateClass}">${safeState}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${id}">${id.slice(0, 12)}…</span>
          <button data-action="delete" data-id="${id}" class="secondary" style="padding:1px 4px;font-size:10px" title="Delete session">✕</button>
        </div>
        <div class="participant-area" id="participants-${id}"></div>
        <div class="coupling-area" id="couplings-${id}"></div>
        ${s.state === "running" ? `<div class="progress-container" id="progress-${id}"><div class="progress-track"><div class="progress-fill" style="width:0%"></div></div><span class="progress-text">Starting…</span></div>` : ""}
        <div class="session-actions">
          ${s.state === "created" ? `<button data-action="addParticipant" data-id="${id}" class="secondary">+ Add Participant</button>` : ""}
          ${s.state === "created" ? `<button data-action="start" data-id="${id}">▶ Start</button>` : ""}
          ${s.state === "running" ? `<button data-action="stop" data-id="${id}">⏹ Stop</button>` : ""}
          ${s.state === "running" ? `<button data-action="livePlot" data-id="${id}" class="secondary">📈 Live Plot</button>` : ""}
        </div>
        <div class="add-picker-container" id="picker-${id}" style="display:none"></div>
      </div>`;
    })
    .join("");

  // Bind session action buttons
  sessionsList.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      if (!action || !id) return;

      switch (action) {
        case "start":
          vscode.postMessage({ type: "startSession", sessionId: id });
          break;
        case "stop":
          vscode.postMessage({ type: "stopSession", sessionId: id });
          break;
        case "delete":
          vscode.postMessage({ type: "deleteSession", sessionId: id });
          break;
        case "addParticipant":
          toggleAddPicker(id);
          break;
        case "livePlot":
          vscode.postMessage({ type: "openLivePlot", sessionId: id });
          break;
      }
    });
  });

  // Fetch participants for each session
  for (const s of sessions) {
    const id = s.sessionId ?? s.id;
    vscode.postMessage({ type: "fetchParticipants", sessionId: id });
  }
}

// ── Add Participant Picker ──

function toggleAddPicker(sessionId: string): void {
  const container = document.getElementById(`picker-${sessionId}`);
  if (!container) return;

  if (container.style.display !== "none") {
    container.style.display = "none";
    return;
  }

  container.style.display = "";
  const safeId = escapeHtmlCosim(sessionId);
  container.innerHTML = `
    <div class="add-picker">
      <div class="add-picker-option" data-picker-action="cosim" data-session="${safeId}">
        <span class="icon">🔗</span>
        <div>
          <span class="label">From Modelica Wrapper</span>
          <span class="recommended">Recommended</span>
          <div class="desc">Import participants &amp; couplings from the open .mo file with connect() equations</div>
        </div>
      </div>
      <div class="add-picker-option" data-picker-action="model" data-session="${safeId}">
        <span class="icon">📄</span>
        <div>
          <span class="label">From Open .mo File</span>
          <div class="desc">Add the active Modelica model as a single participant</div>
        </div>
      </div>
      <div class="add-picker-option" data-picker-action="fmu" data-session="${safeId}">
        <span class="icon">📦</span>
        <div>
          <span class="label">From FMU File</span>
          <div class="desc">Browse for a .fmu or modelDescription.xml file</div>
        </div>
      </div>
      <div class="add-picker-option" data-picker-action="ssp" data-session="${safeId}">
        <span class="icon">🧩</span>
        <div>
          <span class="label">From SSP File</span>
          <div class="desc">Browse for a .ssp archive file</div>
        </div>
      </div>
      <div class="add-picker-divider"></div>
      <div class="add-picker-option" data-picker-action="wrapper" data-session="${safeId}">
        <span class="icon">🔧</span>
        <div>
          <span class="label">Generate Wrapper</span>
          <div class="desc">Create a Modelica wrapper from current participants</div>
        </div>
      </div>
    </div>
  `;

  // Bind picker options
  container.querySelectorAll(".add-picker-option").forEach((option) => {
    option.addEventListener("click", () => {
      const pickerAction = option.getAttribute("data-picker-action");
      const session = option.getAttribute("data-session");
      if (!pickerAction || !session) return;

      switch (pickerAction) {
        case "cosim":
          vscode.postMessage({ type: "publishCosimModel", sessionId: session });
          break;
        case "model":
          vscode.postMessage({ type: "publishModel", sessionId: session });
          break;
        case "fmu":
          vscode.postMessage({ type: "publishFmu", sessionId: session });
          break;
        case "ssp":
          vscode.postMessage({ type: "publishSsp", sessionId: session });
          break;
        case "wrapper":
          vscode.postMessage({ type: "createCosimWrapper", sessionId: session });
          break;
      }

      container.style.display = "none";
    });
  });
}

// ── Participant rendering ──

function renderParticipants(sessionId: string, participants: ParticipantInfo[]): void {
  const container = document.getElementById(`participants-${sessionId}`);
  if (!container) return;

  if (participants.length === 0) {
    container.innerHTML =
      '<div class="session-meta" style="margin-top:4px;text-align:center;opacity:0.7">No participants yet</div>';
    return;
  }

  container.innerHTML = participants
    .map(
      (p) => `
    <div class="session-meta" style="margin-top:2px">
      ${p.type === "fmu" ? "📦" : p.type === "ssp" ? "🧩" : "📄"} <strong>${escapeHtmlCosim(p.modelName)}</strong> <span style="opacity:0.6">(${escapeHtmlCosim(p.type)}${p.variables ? `, ${Number(p.variables)} vars` : ""})</span>
    </div>`,
    )
    .join("");
}

// ── Coupling rendering ──

function renderCouplings(sessionId: string, couplings: CouplingInfo[]): void {
  const container = document.getElementById(`couplings-${sessionId}`);
  if (!container) return;

  if (couplings.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="coupling-list">
      <div class="session-meta" style="margin-top:4px;font-weight:500;opacity:1">Couplings</div>
      ${couplings
        .map(
          (c) => `
        <div class="coupling-item">
          <span>${escapeHtmlCosim(abbreviateId(c.from.participantId))}.${escapeHtmlCosim(c.from.variableName)}</span>
          <span class="coupling-arrow">──→</span>
          <span>${escapeHtmlCosim(abbreviateId(c.to.participantId))}.${escapeHtmlCosim(c.to.variableName)}</span>
        </div>`,
        )
        .join("")}
    </div>
  `;
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

  const pct = Math.min(100, Math.max(0, ((currentTime - startTime) / (stopTime - startTime)) * 100));
  const fill = container.querySelector(".progress-fill") as HTMLElement;
  const text = container.querySelector(".progress-text") as HTMLElement;

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

// ── Initial setup: auto-enable local mode ──

vscode.postMessage({ type: "enableLocal" });
vscode.postMessage({ type: "refresh" });
