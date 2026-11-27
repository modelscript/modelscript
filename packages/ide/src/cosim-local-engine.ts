// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser-local co-simulation engine for VS Code.
//
// Manages in-memory co-simulation sessions, participants (LSP Modelica and
// browser FMU/SSP), variable couplings, and the Gauss-Seidel orchestrator loop.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BrowserBroker } from "./browser-broker";
import { BrowserHistorian } from "./browser-historian";
import { FmuBrowserParticipant } from "./fmu-browser-participant";
import { LspSimulatorParticipant } from "./lsp-simulator-participant";
import { SimulationPanel } from "./simulation-panel";

/** Common interface for both Modelica (LSP) and FMU (browser) participants. */
export interface BrowserParticipant {
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

export interface SessionInfo {
  id: string;
  state: string;
  masterAlgorithm?: string | undefined;
  participants: number;
}

export interface ParticipantInfo {
  id: string;
  modelName: string;
  type: string;
  variables: number;
}

/** A variable coupling: one output feeds one input. */
export interface LocalCoupling {
  from: { participantId: string; variableName: string };
  to: { participantId: string; variableName: string };
}

/** In-memory session state for local mode. */
export interface LocalSession {
  id: string;
  state: "created" | "running" | "completed" | "error";
  masterAlgorithm?: string | undefined;
  participants: LocalParticipant[];
  couplings: LocalCoupling[];
  startTime: number;
  stopTime: number;
  stepSize: number;
  realtimeFactor: number;
}

/** In-memory participant state for local mode. */
export interface LocalParticipant {
  id: string;
  modelName: string;
  uri: string;
  type: string;
  variables: number;
  /** Backing participant (LSP-based Modelica or browser-based FMU). */
  participant: BrowserParticipant;
}

export type CosimMessagePoster = (msg: Record<string, unknown>) => void;

export class CosimLocalEngine {
  private localMode = false;
  private localBroker: BrowserBroker | null = null;
  private localHistorian: BrowserHistorian | null = null;
  private localSessions = new Map<string, LocalSession>();
  private localSimAborts = new Map<string, { aborted: boolean }>();

  constructor(
    private readonly client: LanguageClient,
    private readonly postMessage: CosimMessagePoster,
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

  /** Enable browser-local mode with in-memory broker and historian. */
  enable(): void {
    this.localMode = true;
    this.localBroker?.dispose();
    this.localHistorian?.dispose();
    this.localBroker = new BrowserBroker();
    this.localHistorian = new BrowserHistorian();
    this.localFetchSessions();
    vscode.window.showInformationMessage("Browser-local mode enabled. MQTT and historian are running in-memory.");
  }

  /** Disable browser-local mode and stop all running local simulations. */
  disable(): void {
    this.dispose();
    this.postMessage({ type: "sessionList", sessions: [] });
    vscode.window.showInformationMessage("Browser-local mode disabled.");
  }

  /** Dispose all local simulation abort handles, broker, historian, and sessions. */
  dispose(): void {
    for (const abortRef of this.localSimAborts.values()) {
      abortRef.aborted = true;
    }
    this.localSimAborts.clear();
    this.localBroker?.dispose();
    this.localBroker = null;
    this.localHistorian?.dispose();
    this.localHistorian = null;
    this.localSessions.clear();
    this.localMode = false;
  }

  localCreateSession(msg: Record<string, unknown>): void {
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const session: LocalSession = {
      id,
      state: "created",
      masterAlgorithm: (msg["masterAlgorithm"] as string) ?? "gauss-seidel",
      participants: [],
      couplings: [],
      startTime: (msg["startTime"] as number) ?? 0,
      stopTime: (msg["stopTime"] as number) ?? 10,
      stepSize: (msg["stepSize"] as number) ?? 0.01,
      realtimeFactor: (msg["realtimeFactor"] as number) ?? 1,
    };
    this.localSessions.set(id, session);
    this.postMessage({
      type: "sessionCreated",
      session: { id, state: session.state, masterAlgorithm: session.masterAlgorithm },
    });
    this.localFetchSessions();
  }

  localFetchSessions(): void {
    const sessions = [...this.localSessions.values()].map((s) => ({
      id: s.id,
      state: s.state,
      masterAlgorithm: s.masterAlgorithm,
      participants: s.participants.length,
    }));
    this.postMessage({ type: "sessionList", sessions });
  }

  /** Start co-simulation by running a Gauss-Seidel orchestrator loop. */
  async localStartSession(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) return;

    if (session.participants.length === 0) {
      this.postMessage({ type: "error", message: "No participants enrolled. Publish a model first." });
      return;
    }

    session.state = "running";
    this.localFetchSessions();

    const { startTime, stopTime, stepSize } = session;
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
      const abortRef = { aborted: false };
      this.localSimAborts.set(sessionId, abortRef);
      await this.localStepLoop(session, abortRef);

      // ── Phase 3: Terminate ──
      await Promise.allSettled(participants.map((p) => p.participant.terminate()));

      session.state = "completed";
      this.localFetchSessions();
    } catch (e) {
      session.state = "error";
      this.localFetchSessions();
      this.postMessage({ type: "error", message: `Co-simulation failed: ${e}` });

      // Best-effort terminate
      await Promise.allSettled(participants.map((p) => p.participant.terminate())).catch(() => undefined);
    } finally {
      this.localSimAborts.delete(sessionId);
    }
  }

  /** Execute the Gauss-Seidel co-simulation time-stepping loop. */
  async localStepLoop(session: LocalSession, abortRef: { aborted: boolean }): Promise<void> {
    const { id: sessionId, startTime, stopTime, stepSize, realtimeFactor, participants } = session;
    const wallClockStart = performance.now();
    const simTimeStart = startTime;
    let t = startTime;

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
  }

  /** Add a variable coupling between two participants. */
  localAddCoupling(
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

  localStopSession(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) return;

    // Signal the orchestrator loop to stop
    const abortRef = this.localSimAborts.get(sessionId);
    if (abortRef) {
      abortRef.aborted = true;
      this.localSimAborts.delete(sessionId);
    }

    session.state = "completed";
    this.localFetchSessions();
  }

  localDeleteSession(sessionId: string): void {
    const abortRef = this.localSimAborts.get(sessionId);
    if (abortRef) {
      abortRef.aborted = true;
      this.localSimAborts.delete(sessionId);
    }

    this.localSessions.delete(sessionId);
    this.localHistorian?.clear(sessionId);
    this.localFetchSessions();
  }

  localFetchParticipants(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "participantList", sessionId, participants: [] });
      this.postMessage({ type: "couplingList", sessionId, couplings: [] });
      return;
    }
    const participants: ParticipantInfo[] = session.participants.map((p) => ({
      id: p.id,
      modelName: p.modelName,
      type: p.type,
      variables: p.variables,
    }));
    this.postMessage({
      type: "participantList",
      sessionId,
      participants,
    });
    this.postMessage({
      type: "couplingList",
      sessionId,
      couplings: session.couplings,
    });
  }

  /** Publish the active Modelica model as a local participant (lazy — initialized on session start). */
  localPublishModel(sessionId: string): void {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to publish as a participant.");
      return;
    }

    const uri = editor.document.uri.toString();
    const fileName =
      editor.document.uri.path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "Model";
    const participantId = `local-p-${Date.now().toString(36)}`;

    const lspParticipant = new LspSimulatorParticipant(this.client, participantId, fileName, uri);

    const localParticipant: LocalParticipant = {
      id: participantId,
      modelName: fileName,
      uri,
      type: editor.document.languageId || "modelscript",
      variables: 0, // Will be populated after initialization
      participant: lspParticipant,
    };

    session.participants.push(localParticipant);

    vscode.window.showInformationMessage(`Enrolled "${fileName}" as participant "${participantId}".`);
    this.localFetchSessions();
    this.localFetchParticipants(sessionId);
  }

  /** Publish an FMU model description XML file as a local FMU participant. */
  async localPublishFmu(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "FMU Model Description": ["xml"] },
      title: "Select FMU modelDescription.xml",
    });

    if (!uris || uris.length === 0) return;

    try {
      const fileUri = uris[0]!;
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
  async localPublishSsp(sessionId: string): Promise<void> {
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
      const fileUri = uris[0]!;
      const data = await vscode.workspace.fs.readFile(fileUri);
      const sspBytes = new Uint8Array(data);

      const { unzipSync } = await import("fflate");
      const { parseSsd } = await import("./ssp-parser");

      const unzipped = unzipSync(sspBytes);
      const ssdData = unzipped["SystemStructure.ssd"];
      if (!ssdData) throw new Error("SystemStructure.ssd missing from archive.");

      const xml = new TextDecoder().decode(ssdData);
      const ssp = parseSsd(xml);

      if (ssp.components.length === 0) {
        throw new Error("SSP archive contains no components.");
      }

      const compIdMap = new Map<string, string>();

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
  async localPublishCosimModel(sessionId: string): Promise<void> {
    const session = this.localSessions.get(sessionId);
    if (!session) {
      this.postMessage({ type: "error", message: "Session not found." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a co-simulation wrapper model to publish.");
      return;
    }

    const text = editor.document.getText();
    const uri = editor.document.uri.toString();

    try {
      const result = (await this.client.sendRequest("modelscript/extractCosimGraph", { uri, text })) as {
        ok: boolean;
        participants?: { id: string; type: string; className: string; fileName?: string | undefined }[] | undefined;
        couplings?:
          | {
              from: { participantId: string; variable: string };
              to: { participantId: string; variable: string };
            }[]
          | undefined;
        error?: string | undefined;
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

      session.participants = [];
      session.couplings = [];

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

      for (const p of result.participants) {
        const participantId = `cosim-${p.id}-${Date.now().toString(36)}`;

        let isFmu = p.type === "fmu";
        let fmuFileName = p.fileName;

        if (!isFmu && workspaceFolder) {
          const fmuCandidateUri = vscode.Uri.joinPath(workspaceFolder, `${p.className}.fmu`);
          try {
            await vscode.workspace.fs.stat(fmuCandidateUri);
            isFmu = true;
            fmuFileName = `${p.className}.fmu`;
          } catch {
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
          const moFileName = `${p.className}.mo`;
          let moUri = uri;

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

      const idMap = new Map<string, string>();
      for (const p of result.participants) {
        const found = session.participants.find((sp) => sp.modelName === p.className);
        if (found) {
          idMap.set(p.id, found.id);
        }
      }

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
  async localCreateCosimWrapper(sessionId: string): Promise<void> {
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
      const fmus = session.participants.map((p) => ({
        className: p.modelName,
        instanceName: p.modelName.charAt(0).toLowerCase() + p.modelName.slice(1),
        fileName: p.type === "fmu" ? (p.uri.split("/").pop() ?? `${p.modelName}.fmu`) : `${p.modelName}.mo`,
      }));

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

      const result = (await this.client.sendRequest("modelscript/createCosimWrapper", {
        modelName: "CosimWrapper",
        fmus,
        connections,
      })) as { ok: boolean; source?: string | undefined; error?: string | undefined };

      if (!result.ok || !result.source) {
        this.postMessage({
          type: "error",
          message: `Failed to generate wrapper: ${result.error ?? "unknown error"}`,
        });
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceFolder) {
        vscode.window.showWarningMessage("No workspace folder open.");
        return;
      }

      const wrapperUri = vscode.Uri.joinPath(workspaceFolder, "CosimWrapper.mo");
      await vscode.workspace.fs.writeFile(wrapperUri, new TextEncoder().encode(result.source));

      const doc = await vscode.workspace.openTextDocument(wrapperUri);
      await vscode.window.showTextDocument(doc);

      vscode.window.showInformationMessage(
        `Created wrapper model "CosimWrapper.mo" with ${fmus.length} FMU(s). Open the Diagram view to wire ports.`,
      );
    } catch (e) {
      this.postMessage({ type: "error", message: `Failed to create wrapper: ${e}` });
    }
  }
}
