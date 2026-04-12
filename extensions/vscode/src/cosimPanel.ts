// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Co-simulation sidebar panel for VS Code.
//
// Provides a WebviewViewProvider that renders the cosim management UI:
// - Infrastructure status (API, MQTT, Historian)
// - Local/remote connection configuration
// - Session management (create, start, stop)
// - Participant enrollment (publish models/FMUs)
// - Live simulation plot trigger

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BrowserBroker } from "./browserBroker";
import { BrowserHistorian } from "./browserHistorian";
import { FmuBrowserParticipant } from "./fmuBrowserParticipant";
import { LspSimulatorParticipant } from "./lspSimulatorParticipant";
import { SimulationPanel } from "./simulationPanel";

/** Common interface for both Modelica (LSP) and FMU (browser) participants. */
interface BrowserParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly allValues: Record<string, number>;
  getVariables(): { name: string; causality: string }[];
  initialize(startTime: number, stopTime: number, stepSize: number): Promise<void>;
  doStep(currentTime: number, stepSize: number): Promise<void>;
  getOutputs(): Promise<Map<string, number>>;
  setInputs(values: Map<string, number>): Promise<void>;
  terminate(): Promise<void>;
}

interface SessionInfo {
  id: string;
  state: string;
  participants: number;
}

interface ParticipantInfo {
  id: string;
  modelName: string;
  type: string;
  variables: number;
}

/** A variable coupling: one output feeds one input. */
interface LocalCoupling {
  from: { participantId: string; variableName: string };
  to: { participantId: string; variableName: string };
}

/** In-memory session state for local mode. */
interface LocalSession {
  id: string;
  state: "created" | "running" | "completed" | "error";
  participants: LocalParticipant[];
  couplings: LocalCoupling[];
  startTime: number;
  stopTime: number;
  stepSize: number;
  realtimeFactor: number;
}

/** In-memory participant state for local mode. */
interface LocalParticipant {
  id: string;
  modelName: string;
  uri: string;
  type: "modelica" | "fmu" | "ssp";
  variables: number;
  /** Backing participant (LSP-based Modelica or browser-based FMU). */
  participant: BrowserParticipant;
}

export class CosimViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "modelscript.cosimPanel";

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private healthPollTimer?: ReturnType<typeof setInterval>;

  // ── Local mode state ──
  private localMode = false;
  private localBroker: BrowserBroker | null = null;
  private localHistorian: BrowserHistorian | null = null;
  private localSessions = new Map<string, LocalSession>();
  private localSimTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {}

  /** Whether browser-local mode is active. */
  get isLocalMode(): boolean {
    return this.localMode;
  }

  /** The browser broker instance (when local mode is active). */
  get broker(): BrowserBroker | null {
    return this.localBroker;
  }

  /** The browser historian instance (when local mode is active). */
  get historian(): BrowserHistorian | null {
    return this.localHistorian;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext, // eslint-disable-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (msg: { type: string; [key: string]: unknown }) => {
        await this.handleWebviewMessage(msg);
      },
      undefined,
      this.disposables,
    );

    webviewView.onDidDispose(() => {
      this.stopHealthPoll();
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    });

    // Detect co-simulation wrapper files in the active editor
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.detectCosimWrapper(editor);
      }),
    );
    this.detectCosimWrapper(vscode.window.activeTextEditor);

    // Start health polling
    this.startHealthPoll();
  }

  /** Refresh the panel UI. */
  refresh(): void {
    void this.checkHealth();
    void this.fetchSessions();
  }

  // ── Health Polling ──

  private startHealthPoll(): void {
    void this.checkHealth();
    this.healthPollTimer = setInterval(() => void this.checkHealth(), 10_000);
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = undefined;
    }
  }

  private async checkHealth(): Promise<void> {
    // If local mode is active, report local status
    if (this.localMode) {
      this.postMessage({
        type: "healthUpdate",
        api: false,
        mqtt: "local",
        historian: "local",
        localMode: true,
      });
      return;
    }

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const data = (await response.json()) as {
          status: string;
          mqtt?: string;
          historian?: string;
        };
        this.postMessage({
          type: "healthUpdate",
          api: true,
          mqtt: data.mqtt === "connected",
          historian: data.historian === "connected",
          localMode: false,
        });
      } else {
        this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false, localMode: false });
      }
    } catch {
      this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false, localMode: false });
    }
  }

  // ── Message Handling ──

  private async handleWebviewMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    const apiUrl = this.getApiUrl();

    switch (msg.type) {
      case "refresh":
        this.refresh();
        break;

      case "enableLocal":
        this.enableLocalMode();
        break;

      case "disableLocal":
        this.disableLocalMode();
        break;

      case "startInfra":
        await this.startLocalInfra();
        break;

      case "getConfig":
        this.postMessage({
          type: "config",
          apiUrl: this.getApiUrl(),
          mqttWsUrl: this.getMqttWsUrl(),
        });
        break;

      case "updateConfig": {
        const config = vscode.workspace.getConfiguration("modelscript.cosim");
        if (msg.apiUrl) await config.update("apiUrl", msg.apiUrl as string, vscode.ConfigurationTarget.Global);
        if (msg.mqttWsUrl) await config.update("mqttWsUrl", msg.mqttWsUrl as string, vscode.ConfigurationTarget.Global);
        this.postMessage({
          type: "config",
          apiUrl: this.getApiUrl(),
          mqttWsUrl: this.getMqttWsUrl(),
        });
        void this.checkHealth();
        break;
      }

      case "createSession": {
        if (this.localMode) {
          this.localCreateSession(msg);
          break;
        }
        try {
          const body = {
            startTime: (msg.startTime as number) ?? 0,
            stopTime: (msg.stopTime as number) ?? 10,
            stepSize: (msg.stepSize as number) ?? 0.01,
            realtimeFactor: (msg.realtimeFactor as number) ?? 1,
          };
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (resp.ok) {
            const session = await resp.json();
            this.postMessage({ type: "sessionCreated", session });
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to create session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to create session: ${e}` });
        }
        break;
      }

      case "fetchSessions":
        if (this.localMode) {
          this.localFetchSessions();
        } else {
          await this.fetchSessions();
        }
        break;

      case "startSession": {
        if (this.localMode) {
          this.localStartSession(msg.sessionId as string);
          break;
        }
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/start`, { method: "POST" });
          if (resp.ok) {
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to start session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to start session: ${e}` });
        }
        break;
      }

      case "stopSession": {
        if (this.localMode) {
          this.localStopSession(msg.sessionId as string);
          break;
        }
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/stop`, { method: "POST" });
          if (resp.ok) {
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to stop session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to stop session: ${e}` });
        }
        break;
      }

      case "deleteSession": {
        if (this.localMode) {
          this.localDeleteSession(msg.sessionId as string);
          break;
        }
        try {
          await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}`, { method: "DELETE" });
          void this.fetchSessions();
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to delete session: ${e}` });
        }
        break;
      }

      case "publishModel": {
        if (this.localMode) {
          this.localPublishModel(msg.sessionId as string);
          break;
        }
        await this.publishCurrentModel(msg.sessionId as string);
        break;
      }

      case "publishFmu": {
        if (this.localMode) {
          await this.localPublishFmu(msg.sessionId as string);
        }
        break;
      }

      case "publishCosimModel": {
        if (this.localMode) {
          await this.localPublishCosimModel(msg.sessionId as string);
        }
        break;
      }

      case "addFmuParticipant": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/participants/fmu`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fmuId: msg.fmuId }),
          });
          if (resp.ok) {
            const data = await resp.json();
            this.postMessage({ type: "participantAdded", data });
            void this.fetchSessionParticipants(msg.sessionId as string);
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to add FMU: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to add FMU: ${e}` });
        }
        break;
      }

      case "fetchParticipants":
        if (this.localMode) {
          this.localFetchParticipants(msg.sessionId as string);
        } else {
          await this.fetchSessionParticipants(msg.sessionId as string);
        }
        break;

      case "openLivePlot": {
        await vscode.commands.executeCommand("modelscript.cosimOpenLivePlot", msg.sessionId, msg.participantId);
        break;
      }

      case "addCoupling": {
        if (this.localMode) {
          this.localAddCoupling(
            msg.sessionId as string,
            msg.fromParticipantId as string,
            msg.fromVariable as string,
            msg.toParticipantId as string,
            msg.toVariable as string,
          );
        }
        break;
      }

      case "createCosimWrapper": {
        if (this.localMode) {
          await this.localCreateCosimWrapper(msg.sessionId as string);
        }
        break;
      }

      case "fetchFmus": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/fmus`);
          if (resp.ok) {
            const data = await resp.json();
            this.postMessage({ type: "fmuList", fmus: (data as { fmus: unknown[] }).fmus });
          }
        } catch {
          this.postMessage({ type: "fmuList", fmus: [] });
        }
        break;
      }
    }
  }

  // ── Session Fetching ──

  private async fetchSessions(): Promise<void> {
    const apiUrl = this.getApiUrl();
    try {
      const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions`);
      if (resp.ok) {
        const data = (await resp.json()) as { sessions: SessionInfo[] };
        this.postMessage({ type: "sessionList", sessions: data.sessions });
      }
    } catch {
      this.postMessage({ type: "sessionList", sessions: [] });
    }
  }

  private async fetchSessionParticipants(sessionId: string): Promise<void> {
    const apiUrl = this.getApiUrl();
    try {
      const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${sessionId}/participants`);
      if (resp.ok) {
        const data = (await resp.json()) as { participants: ParticipantInfo[] };
        this.postMessage({ type: "participantList", sessionId, participants: data.participants });
      }
    } catch {
      this.postMessage({ type: "participantList", sessionId, participants: [] });
    }
  }

  // ── Publish Model ──

  /** Publish the active Modelica model as a local participant (lazy — initialized on session start). */
  private localPublishModel(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      vscode.window.showWarningMessage("Open a Modelica file to publish as a participant.");
      return;
    }

    const uri = editor.document.uri.toString();
    const fileName = editor.document.uri.path.split("/").pop()?.replace(".mo", "") ?? "Model";
    const participantId = `local-p-${Date.now().toString(36)}`;

    const lspParticipant = new LspSimulatorParticipant(this.client, participantId, fileName, uri);

    const localParticipant: LocalParticipant = {
      id: participantId,
      modelName: fileName,
      uri,
      type: "modelica",
      variables: 0, // Will be populated after initialization
      participant: lspParticipant,
    };

    session.participants.push(localParticipant);

    vscode.window.showInformationMessage(`Enrolled "${fileName}" as participant "${participantId}".`);
    this.localFetchSessions();
    this.localFetchParticipants(sessionId);
  }

  /** Publish an FMU model description XML file as a local FMU participant. */
  private async localPublishFmu(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    // Find .fmu.xml or .xml files in the workspace
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "FMU Model Description": ["xml"] },
      title: "Select FMU modelDescription.xml",
    });

    if (!uris || uris.length === 0) return;

    try {
      const fileUri = uris[0];
      const data = await vscode.workspace.fs.readFile(fileUri);
      const xmlContent = new TextDecoder().decode(data);
      const fileName = fileUri.path.split("/").pop()?.replace(".xml", "").replace(".fmu", "") ?? "FMU";
      const participantId = `local-fmu-${Date.now().toString(36)}`;

      const fmuParticipant = new FmuBrowserParticipant(participantId, xmlContent);

      const localParticipant: LocalParticipant = {
        id: participantId,
        modelName: fmuParticipant.modelName || fileName,
        uri: fileUri.toString(),
        type: "fmu",
        variables: 0,
        participant: fmuParticipant,
      };

      session.participants.push(localParticipant);

      vscode.window.showInformationMessage(
        `Enrolled FMU "${fmuParticipant.modelName}" as participant "${participantId}".`,
      );
      this.localFetchSessions();
      this.localFetchParticipants(sessionId);
    } catch (e) {
      this.postMessage({ type: "error", message: `Failed to load FMU: ${e}` });
    }
  }

  /** Publish an SSP archive, creating local FMU participants for each component and wiring them together. */
  private async localPublishSsp(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "SSP Archive": ["ssp"] },
      title: "Select SSP Archive",
    });

    if (!uris || uris.length === 0) return;

    try {
      const fileUri = uris[0];
      const data = await vscode.workspace.fs.readFile(fileUri);
      const sspBytes = new Uint8Array(data);

      const { unzipSync } = await import("fflate");
      const { parseSsd } = await import("./sspParser");

      const unzipped = unzipSync(sspBytes);
      const ssdData = unzipped["SystemStructure.ssd"];
      if (!ssdData) throw new Error("SystemStructure.ssd missing from archive.");

      const xml = new TextDecoder().decode(ssdData);
      const ssp = parseSsd(xml);

      if (ssp.components.length === 0) {
        throw new Error("SSP archive contains no components.");
      }

      const compIdMap = new Map<string, string>();

      // Add each component as a participant
      for (const comp of ssp.components) {
        if (!comp.source) continue;

        const fmuData = unzipped[comp.source];
        if (!fmuData) {
          vscode.window.showWarningMessage(`SSP component ${comp.name} missing FMU source: ${comp.source}`);
          continue;
        }

        const participantId = `ssp-${comp.name}-${Date.now().toString(36)}`;
        compIdMap.set(comp.name, participantId);

        const fmuParticipant = new FmuBrowserParticipant(participantId, fmuData);

        const localParticipant: LocalParticipant = {
          id: participantId,
          modelName: comp.name,
          uri: `${fileUri.toString()}#${comp.name}`,
          type: "ssp",
          variables: 0,
          participant: fmuParticipant,
        };

        session.participants.push(localParticipant);
      }

      // Add couplings
      for (const conn of ssp.connections) {
        const fromId = compIdMap.get(conn.startElement);
        const toId = compIdMap.get(conn.endElement);
        if (fromId && toId) {
          session.couplings.push({
            from: { participantId: fromId, variableName: conn.startConnector },
            to: { participantId: toId, variableName: conn.endConnector },
          });
        }
      }

      vscode.window.showInformationMessage(`Enrolled SSP "${ssp.name}" with ${ssp.components.length} components.`);
      this.localFetchSessions();
      this.localFetchParticipants(sessionId);
    } catch (e) {
      this.postMessage({ type: "error", message: `Failed to load SSP: ${e}` });
    }
  }

  /** Publish a co-simulation wrapper model: extract participants and couplings from connect equations. */
  private async localPublishCosimModel(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      vscode.window.showWarningMessage("Open a Modelica co-simulation wrapper model (.mo) to publish.");
      return;
    }

    const text = editor.document.getText();
    const uri = editor.document.uri.toString();

    try {
      // Call the LSP to extract the co-simulation graph
      const result = (await this.client.sendRequest("modelscript/extractCosimGraph", { uri, text })) as {
        ok: boolean;
        participants?: { id: string; type: "modelica" | "fmu"; className: string; fileName?: string }[];
        couplings?: {
          from: { participantId: string; variable: string };
          to: { participantId: string; variable: string };
        }[];
        error?: string;
      };

      if (!result.ok || !result.participants) {
        this.postMessage({
          type: "error",
          message: `Failed to extract co-sim graph: ${result.error ?? "unknown error"}`,
        });
        return;
      }

      if (result.participants.length === 0) {
        vscode.window.showWarningMessage("No components found in the wrapper model.");
        return;
      }

      // Clear existing participants and couplings
      session.participants = [];
      session.couplings = [];

      // Resolve the workspace folder for relative file paths
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

      // Create participants
      for (const p of result.participants) {
        const participantId = `cosim-${p.id}-${Date.now().toString(36)}`;

        // Auto-detect participant type: check if there's a matching .fmu or .xml file in the workspace
        let isFmu = p.type === "fmu";
        let fmuFileName = p.fileName;

        if (!isFmu && workspaceFolder) {
          // First check for .fmu archive (preferred — contains model.json for real simulation)
          const fmuCandidateUri = vscode.Uri.joinPath(workspaceFolder, `${p.className}.fmu`);
          try {
            await vscode.workspace.fs.stat(fmuCandidateUri);
            isFmu = true;
            fmuFileName = `${p.className}.fmu`;
          } catch {
            // Check for .xml model description (passthrough mode)
            const xmlCandidateUri = vscode.Uri.joinPath(workspaceFolder, `${p.className}.xml`);
            try {
              const data = await vscode.workspace.fs.readFile(xmlCandidateUri);
              const xmlContent = new TextDecoder().decode(data);
              if (xmlContent.includes("fmiModelDescription")) {
                isFmu = true;
                fmuFileName = `${p.className}.xml`;
              }
            } catch {
              // No matching FMU file — treat as Modelica
            }
          }
        }

        if (isFmu && fmuFileName) {
          if (workspaceFolder) {
            const fmuUri = vscode.Uri.joinPath(workspaceFolder, fmuFileName);
            try {
              const data = await vscode.workspace.fs.readFile(fmuUri);

              // Pass raw bytes for .fmu files, decoded string for .xml files
              const fmuParticipant = fmuFileName.endsWith(".fmu")
                ? new FmuBrowserParticipant(participantId, new Uint8Array(data))
                : new FmuBrowserParticipant(participantId, new TextDecoder().decode(data));

              session.participants.push({
                id: participantId,
                modelName: fmuParticipant.modelName || p.className,
                uri: fmuFileName,
                type: "fmu",
                variables: 0,
                participant: fmuParticipant,
              });
            } catch {
              this.postMessage({ type: "error", message: `FMU file not found: ${fmuFileName}` });
              continue;
            }
          }
        } else {
          // Find the document URI for this Modelica class
          // Convention: class name matches filename (e.g., Controller → Controller.mo)
          const moFileName = `${p.className}.mo`;
          let moUri = uri; // Default to the wrapper model's URI

          if (workspaceFolder) {
            const candidateUri = vscode.Uri.joinPath(workspaceFolder, moFileName);
            try {
              await vscode.workspace.fs.stat(candidateUri);
              moUri = candidateUri.toString();
            } catch {
              // File not found — fall back to wrapper URI
            }
          }

          const lspParticipant = new LspSimulatorParticipant(this.client, participantId, p.className, moUri);
          session.participants.push({
            id: participantId,
            modelName: p.className,
            uri: moUri,
            type: "modelica",
            variables: 0,
            participant: lspParticipant,
          });
        }
      }

      // Map original component IDs to generated participant IDs
      const idMap = new Map<string, string>();
      for (const p of result.participants) {
        const found = session.participants.find((sp) => sp.modelName === p.className);
        if (found) {
          idMap.set(p.id, found.id);
        }
      }

      // Set couplings (translating from original component IDs to participant IDs)
      if (result.couplings) {
        for (const c of result.couplings) {
          const fromId = idMap.get(c.from.participantId);
          const toId = idMap.get(c.to.participantId);
          if (fromId && toId) {
            session.couplings.push({
              from: { participantId: fromId, variableName: c.from.variable },
              to: { participantId: toId, variableName: c.to.variable },
            });
          }
        }
      }

      const nParticipants = session.participants.length;
      const nCouplings = session.couplings.length;
      vscode.window.showInformationMessage(
        `Co-sim graph: ${nParticipants} participant(s), ${nCouplings} coupling(s) extracted.`,
      );

      this.localFetchSessions();
      this.localFetchParticipants(sessionId);
    } catch (e) {
      this.postMessage({ type: "error", message: `Failed to publish co-sim model: ${e}` });
    }
  }

  /** Create a Modelica wrapper model from the session's FMU participants and open it in the editor. */
  private async localCreateCosimWrapper(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    if (session.participants.length === 0) {
      vscode.window.showWarningMessage("No participants in session. Add FMUs first.");
      return;
    }

    try {
      // Build FMU descriptors from session participants
      const fmus = session.participants.map((p) => ({
        className: p.modelName,
        instanceName: p.modelName.charAt(0).toLowerCase() + p.modelName.slice(1),
        fileName: p.type === "fmu" ? (p.uri.split("/").pop() ?? `${p.modelName}.fmu`) : `${p.modelName}.mo`,
      }));

      // Build connections from session couplings
      const connections = session.couplings.map((c) => {
        const fromP = session.participants.find((p) => p.id === c.from.participantId);
        const toP = session.participants.find((p) => p.id === c.to.participantId);
        const fromName = fromP
          ? fromP.modelName.charAt(0).toLowerCase() + fromP.modelName.slice(1)
          : c.from.participantId;
        const toName = toP ? toP.modelName.charAt(0).toLowerCase() + toP.modelName.slice(1) : c.to.participantId;
        return {
          source: `${fromName}.${c.from.variableName}`,
          target: `${toName}.${c.to.variableName}`,
        };
      });

      // Call LSP to generate the wrapper model source
      const result = (await this.client.sendRequest("modelscript/createCosimWrapper", {
        modelName: "CosimWrapper",
        fmus,
        connections,
      })) as { ok: boolean; source?: string; error?: string };

      if (!result.ok || !result.source) {
        this.postMessage({
          type: "error",
          message: `Failed to generate wrapper: ${result.error ?? "unknown error"}`,
        });
        return;
      }

      // Write the wrapper file to the workspace
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceFolder) {
        vscode.window.showWarningMessage("No workspace folder open.");
        return;
      }

      const wrapperUri = vscode.Uri.joinPath(workspaceFolder, "CosimWrapper.mo");
      await vscode.workspace.fs.writeFile(wrapperUri, new TextEncoder().encode(result.source));

      // Open the file in the editor
      const doc = await vscode.workspace.openTextDocument(wrapperUri);
      await vscode.window.showTextDocument(doc);

      vscode.window.showInformationMessage(
        `Created wrapper model "CosimWrapper.mo" with ${fmus.length} FMU(s). Open the Diagram view to wire ports.`,
      );
    } catch (e) {
      this.postMessage({ type: "error", message: `Failed to create wrapper: ${e}` });
    }
  }

  private async publishCurrentModel(sessionId: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      vscode.window.showWarningMessage("Open a Modelica file to publish as a participant.");
      return;
    }

    try {
      const uri = editor.document.uri.toString();
      // Request the LSP server to simulate and register the model
      const result = await this.client.sendRequest<{ ok: boolean; participantId?: string; error?: string }>(
        "modelscript/publishParticipant",
        { uri, sessionId },
      );

      if (result.ok) {
        vscode.window.showInformationMessage(`Published model as participant: ${result.participantId}`);
        void this.fetchSessionParticipants(sessionId);
      } else {
        vscode.window.showErrorMessage(`Failed to publish: ${result.error}`);
      }
    } catch (e) {
      // Fall back to API-based simulation registration
      vscode.window.showWarningMessage(`LSP publish not supported yet. Use the API to register participants.`);
      console.error("[cosim] publish error:", e);
    }
  }

  // ── Local Infrastructure ──

  private async startLocalInfra(): Promise<void> {
    const cmd = "docker compose up -d mqtt timescaledb api";

    // In VS Code Web, createTerminal is not available — copy command to clipboard instead
    try {
      await vscode.env.clipboard.writeText(cmd);
      await vscode.window.showInformationMessage(
        `Run the following in your terminal to start infrastructure (copied to clipboard):\n\n${cmd}`,
        "OK",
      );
    } catch {
      await vscode.window.showInformationMessage(`Run this command in your terminal:\n\n${cmd}`, "OK");
    }

    // Start checking health more frequently until services are up
    const fastPoll = setInterval(async () => {
      await this.checkHealth();
    }, 3_000);

    setTimeout(() => clearInterval(fastPoll), 60_000);
  }

  // ── Local Mode ──

  private enableLocalMode(): void {
    this.localMode = true;
    this.localBroker = new BrowserBroker();
    this.localHistorian = new BrowserHistorian();
    void this.checkHealth();
    this.localFetchSessions();
    vscode.window.showInformationMessage("Browser-local mode enabled. MQTT and historian are running in-memory.");
  }

  private disableLocalMode(): void {
    // Stop all running local simulations
    for (const [id, timer] of this.localSimTimers) {
      clearInterval(timer);
      this.localSimTimers.delete(id);
    }

    this.localMode = false;
    this.localBroker?.dispose();
    this.localBroker = null;
    this.localHistorian?.dispose();
    this.localHistorian = null;
    this.localSessions.clear();
    void this.checkHealth();
    this.postMessage({ type: "sessionList", sessions: [] });
    vscode.window.showInformationMessage("Browser-local mode disabled.");
  }

  private localCreateSession(msg: Record<string, unknown>): void {
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const session: LocalSession = {
      id,
      state: "created",
      participants: [],
      couplings: [],
      startTime: (msg.startTime as number) ?? 0,
      stopTime: (msg.stopTime as number) ?? 10,
      stepSize: (msg.stepSize as number) ?? 0.01,
      realtimeFactor: (msg.realtimeFactor as number) ?? 1,
    };
    this.localSessions.set(id, session);
    this.postMessage({ type: "sessionCreated", session: { id, state: session.state } });
    this.localFetchSessions();
  }

  private localFetchSessions(): void {
    const sessions = [...this.localSessions.values()].map((s) => ({
      id: s.id,
      state: s.state,
      participants: s.participants.length,
    }));
    this.postMessage({ type: "sessionList", sessions });
  }

  /** Start co-simulation by running a Gauss-Seidel orchestrator loop. */
  private async localStartSession(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) return;

    if (session.participants.length === 0) {
      this.postMessage({ type: "error", message: "No participants enrolled. Publish a model first." });
      return;
    }

    session.state = "running";
    this.localFetchSessions();

    const { startTime, stopTime, stepSize, realtimeFactor } = session;
    const participants = session.participants;

    try {
      // ── Phase 1: Initialize all participants via LSP ──
      await Promise.all(participants.map((p) => p.participant.initialize(startTime, stopTime, stepSize)));

      // Update variable counts after init
      for (const p of participants) {
        p.variables = p.participant.getVariables().length;
      }
      this.localFetchParticipants(sessionId);

      // ── Phase 2: Step loop (Gauss-Seidel) ──
      const wallClockStart = performance.now();
      const simTimeStart = startTime;
      let t = startTime;
      let aborted = false;

      // Store abort handle so localStopSession can break the loop
      const abortRef = { aborted: false };
      this.localSimTimers.set(sessionId, { [Symbol.toPrimitive]: () => 0, abortRef } as unknown as ReturnType<
        typeof setInterval
      >);

      while (t < stopTime - 1e-15 && !abortRef.aborted) {
        const effectiveH = Math.min(stepSize, stopTime - t);

        // ── Apply couplings (output → input) ──
        const allOutputs = new Map<string, Map<string, number>>();
        for (const p of participants) {
          const outputs = await p.participant.getOutputs();
          allOutputs.set(p.id, outputs);
        }

        // Route coupled values
        for (const coupling of session.couplings) {
          const sourceOutputs = allOutputs.get(coupling.from.participantId);
          if (!sourceOutputs) continue;
          const value = sourceOutputs.get(coupling.from.variableName);
          if (value === undefined) continue;

          const targetParticipant = participants.find((p) => p.id === coupling.to.participantId);
          if (targetParticipant) {
            await targetParticipant.participant.setInputs(new Map([[coupling.to.variableName, value]]));
          }
        }

        // ── Step all participants ──
        for (const p of participants) {
          await p.participant.doStep(t, effectiveH);
        }

        const time = t + effectiveH;

        // ── Publish results ──
        for (const p of participants) {
          const allValues = p.participant.allValues;
          for (const [variable, value] of Object.entries(allValues)) {
            const topic = `cosim/sessions/${sessionId}/participants/${p.id}/data`;
            const payload = JSON.stringify({ time, variable, value });
            this.localBroker?.publish(topic, payload);
            this.localHistorian?.record(sessionId, p.id, variable, value, time);
            SimulationPanel.postLiveDataPoint(`${p.modelName}.${variable}`, time, value);
          }
        }

        t += effectiveH;

        // ── Emit progress to webview ──
        this.postMessage({
          type: "simulationProgress",
          sessionId,
          currentTime: t,
          startTime,
          stopTime,
        });

        // Real-time pacing
        if (realtimeFactor > 0) {
          const simElapsed = t - simTimeStart;
          const wallTargetMs = (simElapsed / realtimeFactor) * 1000;
          const wallElapsedMs = performance.now() - wallClockStart;
          const waitMs = wallTargetMs - wallElapsedMs;
          if (waitMs > 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
          }
        }
      }

      aborted = abortRef.aborted;

      // ── Phase 3: Terminate ──
      await Promise.allSettled(participants.map((p) => p.participant.terminate()));
      this.localSimTimers.delete(sessionId);

      session.state = aborted ? "completed" : "completed";
      this.localFetchSessions();
    } catch (e) {
      session.state = "error";
      this.localFetchSessions();
      this.postMessage({ type: "error", message: `Co-simulation failed: ${e}` });

      // Best-effort terminate
      await Promise.allSettled(participants.map((p) => p.participant.terminate())).catch(() => undefined);
    }
  }

  /** Add a variable coupling between two participants. */
  private localAddCoupling(
    sessionId: string,
    fromParticipantId: string,
    fromVariable: string,
    toParticipantId: string,
    toVariable: string,
  ): void {
    const session = this.localSessions.get(sessionId);
    if (!session) return;

    session.couplings.push({
      from: { participantId: fromParticipantId, variableName: fromVariable },
      to: { participantId: toParticipantId, variableName: toVariable },
    });

    this.postMessage({
      type: "couplingAdded",
      sessionId,
      couplings: session.couplings,
    });
  }

  private localStopSession(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) return;

    // Signal the orchestrator loop to stop
    const timerEntry = this.localSimTimers.get(sessionId);
    if (timerEntry) {
      // For async orchestrator: set abort flag
      const abortRef = (timerEntry as unknown as { abortRef?: { aborted: boolean } }).abortRef;
      if (abortRef) {
        abortRef.aborted = true;
      } else {
        clearInterval(timerEntry);
      }
      this.localSimTimers.delete(sessionId);
    }

    session.state = "completed";
    this.localFetchSessions();
  }

  private localDeleteSession(sessionId: string): void {
    const timer = this.localSimTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.localSimTimers.delete(sessionId);
    }

    this.localSessions.delete(sessionId);
    this.localHistorian?.clear(sessionId);
    this.localFetchSessions();
  }

  private localFetchParticipants(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "participantList", sessionId, participants: [] });
      this.postMessage({ type: "couplingList", sessionId, couplings: [] });
      return;
    }
    this.postMessage({
      type: "participantList",
      sessionId,
      participants: session.participants,
    });
    this.postMessage({
      type: "couplingList",
      sessionId,
      couplings: session.couplings,
    });
  }

  /** Detect if the active editor contains a co-simulation wrapper model. */
  private detectCosimWrapper(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== "modelica") {
      this.postMessage({ type: "cosimWrapperDetected", detected: false });
      return;
    }
    const text = editor.document.getText();
    const hasConnect = /\bconnect\s*\(/.test(text);
    this.postMessage({ type: "cosimWrapperDetected", detected: hasConnect });
  }

  // ── Config Helpers ──

  private getApiUrl(): string {
    return vscode.workspace.getConfiguration("modelscript.cosim").get<string>("apiUrl") ?? "http://localhost:3000";
  }

  private getMqttWsUrl(): string {
    return vscode.workspace.getConfiguration("modelscript.cosim").get<string>("mqttWsUrl") ?? "ws://localhost:9001";
  }

  // ── PostMessage ──

  private postMessage(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  // ── HTML ──

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "cosimWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Co-Simulation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 0;
      overflow-x: hidden;
    }
    .section {
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      padding: 10px 14px;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
      margin-bottom: 8px;
      cursor: pointer;
      user-select: none;
    }
    .section-header .chevron {
      font-size: 10px;
      transition: transform 0.15s;
    }
    .section-header.collapsed .chevron {
      transform: rotate(-90deg);
    }
    .section-body.hidden {
      display: none;
    }

    /* ── Mode bar ── */
    .mode-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
    }
    .mode-bar select {
      flex: 1;
      padding: 4px 6px;
      font-size: 12px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
    }
    .mode-status {
      font-size: 11px;
      white-space: nowrap;
    }
    .mode-status.ready { color: var(--vscode-testing-iconPassed, #2da44e); }
    .mode-status.offline { color: var(--vscode-testing-iconFailed, #cf222e); }
    .mode-status.local { color: #f0883e; }

    /* ── Buttons ── */
    button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .btn-block {
      width: 100%;
      justify-content: center;
    }
    input, select {
      width: 100%;
      padding: 4px 6px;
      font-size: 12px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
    }
    input:focus, select:focus {
      border-color: var(--vscode-focusBorder);
    }
    .field {
      margin-bottom: 6px;
    }
    .field label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }

    /* ── Session cards ── */
    .session-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 6px;
    }
    .session-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .session-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .session-actions {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      flex-wrap: wrap;
    }
    .session-actions button {
      font-size: 11px;
      padding: 2px 6px;
    }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      border-radius: 10px;
      text-transform: uppercase;
    }
    .badge.created { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .badge.running { background: #2da44e20; color: #2da44e; }
    .badge.completed { background: #0969da20; color: #0969da; }
    .badge.error { background: #cf222e20; color: #cf222e; }
    .empty-state {
      padding: 12px 0;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .error-msg {
      background: var(--vscode-inputValidation-errorBackground, #5a121220);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      color: var(--vscode-errorForeground);
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 12px;
      margin-top: 6px;
    }
    .connection-form {
      margin-top: 6px;
    }

    /* ── Add-participant picker ── */
    .add-picker {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      padding: 6px;
      margin-top: 6px;
    }
    .add-picker-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .add-picker-option:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .add-picker-option .icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .add-picker-option .label { font-weight: 500; }
    .add-picker-option .desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 1px;
    }
    .add-picker-option .recommended {
      font-size: 9px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 5px;
      border-radius: 8px;
      margin-left: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .add-picker-divider {
      border-top: 1px solid var(--vscode-panel-border);
      margin: 4px 0;
    }

    /* ── Coupling arrows ── */
    .coupling-list {
      margin-top: 6px;
      font-size: 11px;
    }
    .coupling-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-descriptionForeground);
    }
    .coupling-arrow {
      color: var(--vscode-charts-green, #2da44e);
      font-weight: bold;
    }

    /* ── Progress bar ── */
    .progress-container {
      margin-top: 6px;
    }
    .progress-track {
      height: 4px;
      background: var(--vscode-progressBar-background, #0969da);
      opacity: 0.2;
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0969da);
      opacity: 1;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .progress-text {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      display: block;
    }

    /* ── Wrapper detection banner ── */
    .wrapper-banner {
      background: var(--vscode-editorInfo-background, #0969da15);
      border: 1px solid var(--vscode-editorInfo-border, #0969da40);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      font-size: 12px;
      display: none;
    }
    .wrapper-banner.visible { display: block; }
    .wrapper-banner button { margin-top: 6px; }
  </style>
</head>
<body>
  <!-- Mode Selector -->
  <div class="section" id="mode-section">
    <div class="mode-bar">
      <select id="mode-select">
        <option value="local">🖥 Local (Browser)</option>
        <option value="remote">☁ Remote Server</option>
      </select>
      <span class="mode-status ready" id="mode-status">● Ready</span>
      <button id="btn-refresh" class="secondary" title="Refresh" style="padding:2px 6px">⟳</button>
    </div>
  </div>

  <!-- Remote Configuration (hidden by default) -->
  <div class="section" id="config-section" style="display:none">
    <div class="section-header" data-section="config">
      <span class="chevron">▾</span>
      Connection Settings
    </div>
    <div class="section-body" id="config-body">
      <div class="connection-form">
        <div class="field">
          <label>API URL</label>
          <input type="text" id="input-api-url" placeholder="http://localhost:3000">
        </div>
        <div class="field">
          <label>MQTT WebSocket URL</label>
          <input type="text" id="input-mqtt-url" placeholder="ws://localhost:9001">
        </div>
        <div class="btn-row">
          <button id="btn-save-config">Save</button>
          <button id="btn-cancel-config" class="secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Wrapper Detection Banner -->
  <div class="wrapper-banner" id="wrapper-banner">
    🔗 The open file looks like a co-simulation wrapper.
    <button id="btn-import-wrapper">Import Participants &amp; Couplings</button>
  </div>

  <!-- Sessions -->
  <div class="section" id="sessions-section">
    <div class="section-header" data-section="sessions">
      <span class="chevron">▾</span>
      Sessions
    </div>
    <div class="section-body" id="sessions-body">
      <div id="sessions-list"></div>
      <div class="btn-row">
        <button id="btn-quick-start" style="flex:1">⚡ Quick Start</button>
        <button id="btn-create-session" class="secondary" style="flex:1">Custom…</button>
      </div>
    </div>
  </div>

  <!-- Create Session Form (hidden by default) -->
  <div class="section" id="new-session-section" style="display:none">
    <div class="section-header">
      <span class="chevron">▾</span>
      New Session
    </div>
    <div class="section-body">
      <div class="field">
        <label>Start Time</label>
        <input type="number" id="input-start-time" value="0" step="0.1">
      </div>
      <div class="field">
        <label>Stop Time</label>
        <input type="number" id="input-stop-time" value="10" step="0.1">
      </div>
      <div class="field">
        <label>Step Size</label>
        <input type="number" id="input-step-size" value="0.01" step="0.001">
      </div>
      <div class="field">
        <label>Real-time Factor (0 = as fast as possible)</label>
        <input type="number" id="input-rt-factor" value="1" step="0.1">
      </div>
      <div class="btn-row">
        <button id="btn-submit-session">Create</button>
        <button id="btn-cancel-session" class="secondary">Cancel</button>
      </div>
    </div>
  </div>

  <div id="error-container"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
