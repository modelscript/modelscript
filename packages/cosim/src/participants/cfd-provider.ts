// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Interface for a 3D Computational Fluid Dynamics (CFD) Provider.
 * Extends the generic 1D CoSimParticipant to support OpenFOAM-style
 * Navier-Stokes coupling and volumetric VTK extraction for VR rendering.
 */
export interface ICfdProvider extends CoSimParticipant {
  /**
   * Retrieves the current volumetric mesh data (e.g., in VTK format)
   * containing fields like alpha.polymer and T for real-time visualization.
   */
  getVtkBuffer(): Promise<Uint8Array | null>;

  /**
   * Initialize the mesh using the generated CAD geometry.
   * @param stepFileData The raw STEP file buffer from the ModelScript CAD pipeline.
   */
  loadGeometry(stepFileData: Uint8Array): Promise<void>;
}

export abstract class BaseCfdProvider implements ICfdProvider {
  public abstract readonly id: string;
  public abstract readonly modelName: string;
  public abstract readonly metadata: ParticipantMetadata;

  protected currentTime = 0;

  public async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.currentTime = startTime;
  }

  public abstract doStep(currentTime: number, stepSize: number): Promise<void>;
  public abstract getOutputs(): Promise<Map<string, CosimValue>>;
  public abstract setInputs(values: Map<string, CosimValue>): Promise<void>;
  public abstract terminate(): Promise<void>;

  public abstract getVtkBuffer(): Promise<Uint8Array | null>;
  public abstract loadGeometry(stepFileData: Uint8Array): Promise<void>;
}

/**
 * Tier 1: WASM Provider (Browser IDE)
 * Runs a simplified, coarse-mesh version of the CFD solver directly in the browser.
 * Perfect for zero-install, real-time prototyping and boundary condition debugging.
 */
export class WasmOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "WASM-based OpenFOAM solver for Browser execution",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    // Phase 2: Call Gmsh.wasm to extract a volumetric mesh
    console.log(`[WasmOpenFoamProvider] Loading geometry (${stepFileData.byteLength} bytes) via Gmsh.wasm...`);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Tick WASM OpenFOAM solver
    this.currentTime += stepSize;
    // console.log(`[WasmOpenFoamProvider] doStep to ${this.currentTime}`);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    // Mock mass flow resistance feedback
    outputs.set("gateInlet.m_flow", -0.05);
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Map 1D Modelica pressure to 3D Inlet Patch boundary condition
    // e.g., if values.has("gateInlet.p"), set it in WASM memory
  }

  public async terminate(): Promise<void> {
    console.log(`[WasmOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    // Return extracted alpha.polymer and T fields from WASM memory as VTK format
    return null;
  }
}

/**
 * Tier 2: Native Node.js Provider (Desktop VS Code Extension)
 * Uses child_process.spawn() to bypass WASM limits and execute the user's
 * natively installed OpenFOAM binaries. This leverages local multi-core CPUs and GPUs.
 */
export class NativeOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "Native OpenFOAM execution via Node.js spawn()",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    // Write STEP file to disk, spawn native Gmsh or snappyHexMesh
    console.log(`[NativeOpenFoamProvider] Loading geometry natively...`);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Spawn or communicate with OpenFOAM binary via standard FMI or pipes
    this.currentTime += stepSize;
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map<string, CosimValue>();
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Send boundary conditions to native process
  }

  public async terminate(): Promise<void> {
    // Kill child process
    console.log(`[NativeOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    // Read generated VTK files from OpenFOAM case directory
    return null;
  }
}

/**
 * Tier 3: Cloud API Provider
 * Packages the CAD mesh and Modelica parameters and sends them via REST/WebSocket
 * to a backend server. The server crunches massive CFD matrices and streams VR data.
 */
export class CloudOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "Cloud-accelerated OpenFOAM API endpoint",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    // Upload STEP buffer via REST
    console.log(`[CloudOpenFoamProvider] Uploading geometry to cloud...`);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Ping WebSocket to advance server tick
    this.currentTime += stepSize;
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map<string, CosimValue>();
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Send BC payload over WebSocket
  }

  public async terminate(): Promise<void> {
    console.log(`[CloudOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    // Stream delta VTK payload from cloud
    return null;
  }
}
