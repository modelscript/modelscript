// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Virtual Electrophysiology & Active Pacemaker Programmer Panel.
// Designed after clinical electrophysiology programmer tablets (Medtronic / Abbott styles)
// for dual-chamber pacemakers, CRT devices, and deforming cardiac-assist simulations.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export type PacemakerMode = "DDD" | "DDDR" | "VVI" | "VVIR" | "AAI" | "VOO" | "CRT-D";

export interface PacemakerParameters {
  mode: PacemakerMode;
  lowerRateLimit: number; // bpm (30-120)
  upperTrackingLimit: number; // bpm (90-180)
  pacedAvDelay: number; // ms (50-300)
  sensedAvDelay: number; // ms (40-250)
  ventricularVoltage: number; // V (0.5-5.0)
  ventricularPulseWidth: number; // ms (0.1-1.5)
  atrialVoltage: number; // V (0.5-5.0)
  ventricularSensitivity: number; // mV (0.5-5.0)
  atrialSensitivity: number; // mV (0.2-2.5)
  pvarp: number; // ms (150-500)
  ventricularBlanking: number; // ms (10-60)
}

export interface PacemakerTelemetry {
  heartRate: number; // bpm
  batteryVoltage: number; // V
  raLeadImpedance: number; // ohms
  rvLeadImpedance: number; // ohms
  apPercent: number; // %
  vpPercent: number; // %
  activeDisturbance: string | null;
}

export interface PacemakerProgrammerState {
  parameters: PacemakerParameters;
  telemetry: PacemakerTelemetry;
}

export interface DisturbanceInjectionResult {
  name: string;
  description: string;
  appliedParameters: Record<string, number | boolean>;
  timestamp: number;
}

export class PacemakerProgrammerPanel {
  public static currentPanel: PacemakerProgrammerPanel | undefined;
  public static readonly viewType = "modelscript.pacemakerProgrammer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  public client?: LanguageClient;
  public sourceUri?: string;
  private _disposables: vscode.Disposable[] = [];

  private _state: PacemakerProgrammerState = {
    parameters: {
      mode: "DDD",
      lowerRateLimit: 60,
      upperTrackingLimit: 130,
      pacedAvDelay: 150,
      sensedAvDelay: 120,
      ventricularVoltage: 2.5,
      ventricularPulseWidth: 0.4,
      atrialVoltage: 2.0,
      ventricularSensitivity: 2.0,
      atrialSensitivity: 0.7,
      pvarp: 250,
      ventricularBlanking: 28,
    },
    telemetry: {
      heartRate: 72,
      batteryVoltage: 2.84,
      raLeadImpedance: 520,
      rvLeadImpedance: 640,
      apPercent: 8,
      vpPercent: 74,
      activeDisturbance: null,
    },
  };

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, uri?: string) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (PacemakerProgrammerPanel.currentPanel) {
      PacemakerProgrammerPanel.currentPanel._panel.reveal(column);
      if (client) PacemakerProgrammerPanel.currentPanel.client = client;
      if (uri) PacemakerProgrammerPanel.currentPanel.sourceUri = uri;
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PacemakerProgrammerPanel.viewType,
      "Pacemaker Clinical Programmer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    PacemakerProgrammerPanel.currentPanel = new PacemakerProgrammerPanel(panel, extensionUri, client, uri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client?: LanguageClient, uri?: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.client = client;
    this.sourceUri = uri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            this.sendState();
            break;
          case "updateParameter":
            this.updateParameter(message.name, message.value);
            break;
          case "injectDisturbance":
            this.injectDisturbance(message.name);
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview();
  }

  public getCurrentState(): PacemakerProgrammerState {
    return {
      parameters: { ...this._state.parameters },
      telemetry: { ...this._state.telemetry },
    };
  }

  public updateParameter(name: keyof PacemakerParameters | string, value: number | string): void {
    if (name === "mode") {
      this._state.parameters.mode = value as PacemakerMode;
    } else if (name in this._state.parameters) {
      const numVal = typeof value === "string" ? parseFloat(value) : value;
      (this._state.parameters as Record<string, any>)[name] = numVal;
    }

    // Forward to client or active simulation if available
    if (this.client && this.sourceUri) {
      this.client.sendNotification("modelscript/updateSimulationParameter", {
        uri: this.sourceUri,
        parameter: name,
        value,
      });
    }

    this.sendState();
  }

  public injectDisturbance(name: string): DisturbanceInjectionResult {
    const timestamp = Date.now();
    let appliedParameters: Record<string, number | boolean> = {};
    let description = "";

    switch (name) {
      case "avBlock":
        appliedParameters = { avBlock: true, avConductionDelay: 999.0 };
        description = "Complete 3rd-Degree AV Block induced. Conduction severed; escape V-pacing active.";
        this._state.telemetry.activeDisturbance = "3° AV Block";
        this._state.telemetry.vpPercent = 100;
        break;
      case "bradycardia":
        appliedParameters = { intrinsicSinusRate: 35.0 };
        description = "Vasovagal Bradycardia triggered. Sinus node slowed to 35 bpm; pacing at LRL.";
        this._state.telemetry.activeDisturbance = "Bradycardia (35 bpm)";
        this._state.telemetry.apPercent = 95;
        break;
      case "pvc":
        appliedParameters = { ectopicVentricularBeat: true, pvcOffsetMs: 50.0 };
        description = "Premature Ventricular Contraction (PVC) injected. Refractory blanking tested.";
        this._state.telemetry.activeDisturbance = "Ectopic PVC";
        break;
      case "leadDislodgement":
        appliedParameters = { pacingCaptureThreshold: 4.2, leadImpedanceMultiplier: 2.5 };
        description = "Lead Micro-Dislodgement simulated. Pacing threshold elevated to 4.2V.";
        this._state.telemetry.activeDisturbance = "Lead Dislodgement";
        this._state.telemetry.rvLeadImpedance = 1580;
        break;
      case "resetNormal":
      default:
        appliedParameters = {
          avBlock: false,
          intrinsicSinusRate: 72.0,
          ectopicVentricularBeat: false,
          pacingCaptureThreshold: 1.0,
        };
        description = "Normal Sinus Rhythm restored. Intrinsic conduction active.";
        this._state.telemetry.activeDisturbance = null;
        this._state.telemetry.rvLeadImpedance = 640;
        this._state.telemetry.vpPercent = 12;
        this._state.telemetry.apPercent = 4;
        break;
    }

    // Forward fault parameters to language client / simulation runner
    if (this.client && this.sourceUri) {
      this.client.sendNotification("modelscript/injectDisturbance", {
        uri: this.sourceUri,
        disturbance: name,
        parameters: appliedParameters,
      });
    }

    this.sendState();

    return {
      name,
      description,
      appliedParameters,
      timestamp,
    };
  }

  public sendState(): void {
    this._panel.webview.postMessage({
      type: "state",
      data: this.getCurrentState(),
    });
  }

  public reveal(column?: vscode.ViewColumn): void {
    this._panel.reveal(column);
  }

  public dispose(): void {
    PacemakerProgrammerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clinical Pacemaker Programmer</title>
  <style>
    :root {
      --bg: #14171d;
      --card-bg: #1c212a;
      --card-border: #2e3846;
      --text-main: #f0f4f8;
      --text-muted: #8b9bb4;
      --cyan: #00d2ff;
      --accent: #0091ff;
      --accent-hover: #1aa0ff;
      --amber: #ff9800;
      --red: #ff3b5c;
      --green: #00e676;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      box-sizing: border-box;
      height: 100vh;
      overflow-y: auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 16px;
    }
    .header-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(0, 230, 118, 0.15);
      color: var(--green);
      border: 1px solid rgba(0, 230, 118, 0.3);
    }
    .status-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--cyan);
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .param-group {
      margin-bottom: 12px;
    }
    .param-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .param-value {
      color: var(--text-main);
      font-weight: 600;
    }
    input[type="range"] {
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: #2a3442;
      outline: none;
      -webkit-appearance: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--cyan);
      cursor: pointer;
      box-shadow: 0 0 6px rgba(0, 210, 255, 0.6);
    }
    select {
      width: 100%;
      padding: 8px 12px;
      border-radius: 4px;
      background: #242c38;
      border: 1px solid var(--card-border);
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }
    .btn-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .btn-action {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: #232c3a;
      color: var(--text-main);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-action:hover {
      background: #2f3b4d;
      border-color: var(--cyan);
    }
    .btn-danger {
      border-color: rgba(255, 59, 92, 0.4);
      background: rgba(255, 59, 92, 0.1);
      color: #ff6b84;
    }
    .btn-danger:hover {
      background: rgba(255, 59, 92, 0.25);
      border-color: var(--red);
    }
    .btn-restore {
      border-color: rgba(0, 230, 118, 0.4);
      background: rgba(0, 230, 118, 0.1);
      color: var(--green);
    }
    .btn-restore:hover {
      background: rgba(0, 230, 118, 0.25);
      border-color: var(--green);
    }
    .telemetry-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 12px;
    }
    .telemetry-row:last-child {
      border-bottom: none;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span>⚡ Virtual Electrophysiology Programmer</span>
    </div>
    <div class="status-badge" id="telemetry-badge">
      <div class="status-indicator-dot"></div>
      <span id="badge-text">Coupled Live: Dual-Chamber (DDD)</span>
    </div>
  </div>

  <div class="grid">
    <!-- Pacing Modes & Limits -->
    <div class="card">
      <div class="card-title">Pacing Mode & Rate Limits</div>
      <div class="param-group">
        <div class="param-label">
          <span>Operating Pacing Mode</span>
        </div>
        <select id="mode-select">
          <option value="DDD">DDD (Dual Pacing, Dual Sensing, Tracking)</option>
          <option value="DDDR">DDDR (Rate-Responsive Dual Chamber)</option>
          <option value="VVI">VVI (Ventricular Demand Backup)</option>
          <option value="VVIR">VVIR (Rate-Responsive Ventricular)</option>
          <option value="AAI">AAI (Atrial Pacing for SSS)</option>
          <option value="VOO">VOO (Asynchronous Ventricular Safety)</option>
          <option value="CRT-D">CRT-D (Biventricular Resynchronization)</option>
        </select>
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Lower Rate Limit (LRL)</span>
          <span class="param-value" id="val-lrl">60 bpm</span>
        </div>
        <input type="range" id="input-lrl" min="30" max="120" value="60">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Upper Tracking Limit (UTL)</span>
          <span class="param-value" id="val-utl">130 bpm</span>
        </div>
        <input type="range" id="input-utl" min="90" max="180" value="130">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Paced AV Delay</span>
          <span class="param-value" id="val-paved">150 ms</span>
        </div>
        <input type="range" id="input-paved" min="50" max="300" value="150">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Sensed AV Delay</span>
          <span class="param-value" id="val-snt">120 ms</span>
        </div>
        <input type="range" id="input-snt" min="40" max="250" value="120">
      </div>
    </div>

    <!-- Pacing Outputs & Blanking Windows -->
    <div class="card">
      <div class="card-title">Pacing Pulse & Sensing Windows</div>
      <div class="param-group">
        <div class="param-label">
          <span>Ventricular Pulse Amplitude</span>
          <span class="param-value" id="val-vvolt">2.5 V</span>
        </div>
        <input type="range" id="input-vvolt" min="0.5" max="5.0" step="0.1" value="2.5">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Ventricular Sensing Sensitivity</span>
          <span class="param-value" id="val-vsens">2.0 mV</span>
        </div>
        <input type="range" id="input-vsens" min="0.5" max="5.0" step="0.1" value="2.0">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Post-Ventricular Atrial Refractory (PVARP)</span>
          <span class="param-value" id="val-pvarp">250 ms</span>
        </div>
        <input type="range" id="input-pvarp" min="150" max="500" step="10" value="250">
      </div>

      <div class="param-group">
        <div class="param-label">
          <span>Ventricular Blanking Period</span>
          <span class="param-value" id="val-blank">28 ms</span>
        </div>
        <input type="range" id="input-blank" min="10" max="60" step="2" value="28">
      </div>
    </div>

    <!-- Electrophysiology Stress & Arrhythmia Injector -->
    <div class="card">
      <div class="card-title">Arrhythmia & Stress Injector</div>
      <div class="btn-grid">
        <button class="btn-action btn-danger" id="btn-block">
          ⚡ Induce Complete 3° AV Block
        </button>
        <button class="btn-action btn-danger" id="btn-brady">
          ⚡ Trigger Vasovagal Bradycardia (35 bpm)
        </button>
        <button class="btn-action btn-danger" id="btn-pvc">
          ⚡ Inject Premature Ventricular Contraction (PVC)
        </button>
        <button class="btn-action btn-danger" id="btn-dislodge">
          ⚡ Simulate Lead Micro-Dislodgement (4.2V Thresh)
        </button>
        <button class="btn-action btn-restore" id="btn-restore">
          ✔ Restore Normal Sinus Rhythm
        </button>
      </div>
    </div>

    <!-- Clinical Device Telemetry -->
    <div class="card">
      <div class="card-title">Live Device Telemetry</div>
      <div class="telemetry-row">
        <span style="color: var(--text-muted)">Current Rhythm / Disturbance</span>
        <span id="tel-disturbance" style="color: var(--green); font-weight: 600">Normal Sinus</span>
      </div>
      <div class="telemetry-row">
        <span style="color: var(--text-muted)">RA Lead Impedance</span>
        <span id="tel-ra">520 Ω (In-range)</span>
      </div>
      <div class="telemetry-row">
        <span style="color: var(--text-muted)">RV Lead Impedance</span>
        <span id="tel-rv">640 Ω (In-range)</span>
      </div>
      <div class="telemetry-row">
        <span style="color: var(--text-muted)">Pacing Distribution</span>
        <span id="tel-dist">AP: 8% | VP: 74%</span>
      </div>
      <div class="telemetry-row">
        <span style="color: var(--text-muted)">Battery Voltage</span>
        <span id="tel-batt">2.84 V (8.4 yrs expected)</span>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const modeSelect = document.getElementById("mode-select");
    const inputLrl = document.getElementById("input-lrl");
    const valLrl = document.getElementById("val-lrl");
    const inputUtl = document.getElementById("input-utl");
    const valUtl = document.getElementById("val-utl");
    const inputPaved = document.getElementById("input-paved");
    const valPaved = document.getElementById("val-paved");
    const inputSnt = document.getElementById("input-snt");
    const valSnt = document.getElementById("val-snt");
    const inputVvolt = document.getElementById("input-vvolt");
    const valVvolt = document.getElementById("val-vvolt");
    const inputVsens = document.getElementById("input-vsens");
    const valVsens = document.getElementById("val-vsens");
    const inputPvarp = document.getElementById("input-pvarp");
    const valPvarp = document.getElementById("val-pvarp");
    const inputBlank = document.getElementById("input-blank");
    const valBlank = document.getElementById("val-blank");

    const telDisturbance = document.getElementById("tel-disturbance");
    const telRa = document.getElementById("tel-ra");
    const telRv = document.getElementById("tel-rv");
    const telDist = document.getElementById("tel-dist");
    const badgeText = document.getElementById("badge-text");

    modeSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "updateParameter", name: "mode", value: modeSelect.value });
    });

    function bindSlider(input, valDisplay, unit, paramName) {
      input.addEventListener("input", () => {
        valDisplay.textContent = input.value + " " + unit;
      });
      input.addEventListener("change", () => {
        vscode.postMessage({ type: "updateParameter", name: paramName, value: parseFloat(input.value) });
      });
    }

    bindSlider(inputLrl, valLrl, "bpm", "lowerRateLimit");
    bindSlider(inputUtl, valUtl, "bpm", "upperTrackingLimit");
    bindSlider(inputPaved, valPaved, "ms", "pacedAvDelay");
    bindSlider(inputSnt, valSnt, "ms", "sensedAvDelay");
    bindSlider(inputVvolt, valVvolt, "V", "ventricularVoltage");
    bindSlider(inputVsens, valVsens, "mV", "ventricularSensitivity");
    bindSlider(inputPvarp, valPvarp, "ms", "pvarp");
    bindSlider(inputBlank, valBlank, "ms", "ventricularBlanking");

    document.getElementById("btn-block").addEventListener("click", () => {
      vscode.postMessage({ type: "injectDisturbance", name: "avBlock" });
    });
    document.getElementById("btn-brady").addEventListener("click", () => {
      vscode.postMessage({ type: "injectDisturbance", name: "bradycardia" });
    });
    document.getElementById("btn-pvc").addEventListener("click", () => {
      vscode.postMessage({ type: "injectDisturbance", name: "pvc" });
    });
    document.getElementById("btn-dislodge").addEventListener("click", () => {
      vscode.postMessage({ type: "injectDisturbance", name: "leadDislodgement" });
    });
    document.getElementById("btn-restore").addEventListener("click", () => {
      vscode.postMessage({ type: "injectDisturbance", name: "resetNormal" });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "state" && msg.data) {
        const { parameters, telemetry } = msg.data;
        if (parameters) {
          if (parameters.mode) modeSelect.value = parameters.mode;
          if (parameters.lowerRateLimit) {
            inputLrl.value = parameters.lowerRateLimit;
            valLrl.textContent = parameters.lowerRateLimit + " bpm";
          }
          if (parameters.upperTrackingLimit) {
            inputUtl.value = parameters.upperTrackingLimit;
            valUtl.textContent = parameters.upperTrackingLimit + " bpm";
          }
          if (parameters.pacedAvDelay) {
            inputPaved.value = parameters.pacedAvDelay;
            valPaved.textContent = parameters.pacedAvDelay + " ms";
          }
          if (parameters.sensedAvDelay) {
            inputSnt.value = parameters.sensedAvDelay;
            valSnt.textContent = parameters.sensedAvDelay + " ms";
          }
          if (parameters.ventricularVoltage) {
            inputVvolt.value = parameters.ventricularVoltage;
            valVvolt.textContent = parameters.ventricularVoltage + " V";
          }
          if (parameters.ventricularSensitivity) {
            inputVsens.value = parameters.ventricularSensitivity;
            valVsens.textContent = parameters.ventricularSensitivity + " mV";
          }
          if (parameters.pvarp) {
            inputPvarp.value = parameters.pvarp;
            valPvarp.textContent = parameters.pvarp + " ms";
          }
          if (parameters.ventricularBlanking) {
            inputBlank.value = parameters.ventricularBlanking;
            valBlank.textContent = parameters.ventricularBlanking + " ms";
          }
        }
        if (telemetry) {
          telDisturbance.textContent = telemetry.activeDisturbance || "Normal Sinus Rhythm";
          telDisturbance.style.color = telemetry.activeDisturbance ? "#ff3b5c" : "#00e676";
          telRa.textContent = telemetry.raLeadImpedance + " Ω (In-range)";
          telRv.textContent = telemetry.rvLeadImpedance + " Ω" + (telemetry.rvLeadImpedance > 1000 ? " (Elevated!)" : " (In-range)");
          telRv.style.color = telemetry.rvLeadImpedance > 1000 ? "#ff9800" : "inherit";
          telDist.textContent = "AP: " + telemetry.apPercent + "% | VP: " + telemetry.vpPercent + "%";
          badgeText.textContent = "Coupled Live: " + (parameters ? parameters.mode : "DDD");
        }
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
