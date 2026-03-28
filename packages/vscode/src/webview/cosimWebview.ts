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
const apiDot = document.getElementById("api-dot")!;
const mqttDot = document.getElementById("mqtt-dot")!;
const historianDot = document.getElementById("historian-dot")!;
const apiStatus = document.getElementById("api-status")!;
const mqttStatus = document.getElementById("mqtt-status")!;
const historianStatus = document.getElementById("historian-status")!;

const btnStartInfra = document.getElementById("btn-start-infra")!;
const btnConnectRemote = document.getElementById("btn-connect-remote")!;
const btnRefresh = document.getElementById("btn-refresh")!;

const configSection = document.getElementById("config-section")!;
const inputApiUrl = document.getElementById("input-api-url") as HTMLInputElement;
const inputMqttUrl = document.getElementById("input-mqtt-url") as HTMLInputElement;
const btnSaveConfig = document.getElementById("btn-save-config")!;
const btnCancelConfig = document.getElementById("btn-cancel-config")!;

const sessionsList = document.getElementById("sessions-list")!;
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

// ── Section collapse ──

document.querySelectorAll(".section-header").forEach((header) => {
  header.addEventListener("click", () => {
    const body = header.nextElementSibling;
    if (!body) return;
    header.classList.toggle("collapsed");
    body.classList.toggle("hidden");
  });
});

// ── Button handlers ──

btnStartInfra.addEventListener("click", () => {
  vscode.postMessage({ type: "startInfra" });
});

const btnUseLocal = document.getElementById("btn-use-local");
let isLocalMode = false;

if (btnUseLocal) {
  btnUseLocal.addEventListener("click", () => {
    if (isLocalMode) {
      vscode.postMessage({ type: "disableLocal" });
    } else {
      vscode.postMessage({ type: "enableLocal" });
    }
  });
}

btnConnectRemote.addEventListener("click", () => {
  configSection.style.display = configSection.style.display === "none" ? "" : "none";
  vscode.postMessage({ type: "getConfig" });
});

btnRefresh.addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

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

    case "sessionCreated":
      // Session was created, list will refresh
      break;

    case "error":
      showError(msg.message as string);
      break;
  }
});

// ── Health rendering ──

function updateHealth(h: HealthMsg): void {
  setStatus(apiDot, apiStatus, h.api);
  setStatus(mqttDot, mqttStatus, h.mqtt);
  setStatus(historianDot, historianStatus, h.historian);

  // Update local mode button
  isLocalMode = h.localMode === true;
  if (btnUseLocal) {
    if (isLocalMode) {
      btnUseLocal.textContent = "Disable Local Mode";
      btnUseLocal.classList.remove("secondary");
    } else {
      btnUseLocal.textContent = "Use Browser-Local";
      btnUseLocal.classList.add("secondary");
    }
  }
}

function setStatus(dot: HTMLElement, label: HTMLElement, online: boolean | string): void {
  if (online === "local") {
    dot.className = "status-dot local";
    label.textContent = "local";
  } else {
    dot.className = `status-dot ${online ? "online" : "offline"}`;
    label.textContent = online ? "online" : "offline";
  }
}

// ── Session rendering ──

function renderSessions(sessions: SessionInfo[]): void {
  if (sessions.length === 0) {
    sessionsList.innerHTML = '<div class="empty-state">No active sessions</div>';
    return;
  }

  sessionsList.innerHTML = sessions
    .map((s) => {
      const id = s.sessionId ?? s.id;
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
          <span class="badge ${stateClass}">${s.state}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${id}">${id.slice(0, 12)}…</span>
        </div>
        <div class="session-actions">
          ${s.state === "created" ? `<button data-action="start" data-id="${id}">▶ Start</button>` : ""}
          ${s.state === "running" ? `<button data-action="stop" data-id="${id}">⏹ Stop</button>` : ""}
          ${s.state === "created" ? `<button data-action="publish" data-id="${id}" class="secondary">📡 Publish Model</button>` : ""}
          ${s.state === "running" ? `<button data-action="livePlot" data-id="${id}" class="secondary">📈 Live Plot</button>` : ""}
          <button data-action="delete" data-id="${id}" class="secondary">✕</button>
        </div>
        <div class="participant-area" id="participants-${id}"></div>
      </div>`;
    })
    .join("");

  // Bind session action buttons
  sessionsList.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
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
        case "publish":
          vscode.postMessage({ type: "publishModel", sessionId: id });
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

// ── Participant rendering ──

function renderParticipants(sessionId: string, participants: ParticipantInfo[]): void {
  const container = document.getElementById(`participants-${sessionId}`);
  if (!container) return;

  if (participants.length === 0) {
    container.innerHTML = '<div class="session-meta" style="margin-top:4px">No participants enrolled</div>';
    return;
  }

  container.innerHTML = participants
    .map(
      (p) => `
    <div class="session-meta" style="margin-top:2px">
      • ${p.modelName} <span style="opacity:0.6">(${p.type}, ${p.variables} vars)</span>
    </div>`,
    )
    .join("");
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

// ── Initial fetch ──

vscode.postMessage({ type: "refresh" });
