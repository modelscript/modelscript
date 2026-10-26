// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractFbiModalDeformation, parseFbiFile } from "@modelscript/simpack";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export interface MultibodyMeshPayload {
  id: number;
  name: string;
  type: string;
  color?: [number, number, number] | undefined;
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface MultibodyCadComponent {
  name: string;
  cad?: { feature?: string | undefined } | undefined;
  bindings?:
    | {
        position?: [string, string, string] | undefined;
        rotation?: string[] | undefined;
      }
    | undefined;
  deformation?:
    | {
        mode?: "volume_radial" | "anisotropic" | "modal" | undefined;
        modalVariables?: string[] | undefined;
        modeShapes?: Float32Array[] | undefined;
        nodeMap?: Uint32Array | undefined;
      }
    | undefined;
}

export function createBoxMesh(
  id: number,
  name: string,
  width: number,
  height: number,
  depth: number,
  color?: [number, number, number],
): MultibodyMeshPayload {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  const vertices = new Float32Array([
    // Front face
    -hw,
    -hh,
    hd,
    hw,
    -hh,
    hd,
    hw,
    hh,
    hd,
    -hw,
    hh,
    hd,
    // Back face
    -hw,
    -hh,
    -hd,
    -hw,
    hh,
    -hd,
    hw,
    hh,
    -hd,
    hw,
    -hh,
    -hd,
    // Top face
    -hw,
    hh,
    -hd,
    -hw,
    hh,
    hd,
    hw,
    hh,
    hd,
    hw,
    hh,
    -hd,
    // Bottom face
    -hw,
    -hh,
    -hd,
    hw,
    -hh,
    -hd,
    hw,
    -hh,
    hd,
    -hw,
    -hh,
    hd,
    // Right face
    hw,
    -hh,
    -hd,
    hw,
    hh,
    -hd,
    hw,
    hh,
    hd,
    hw,
    -hh,
    hd,
    // Left face
    -hw,
    -hh,
    -hd,
    -hw,
    -hh,
    hd,
    -hw,
    hh,
    hd,
    -hw,
    hh,
    -hd,
  ]);

  const normals = new Float32Array([
    // Front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  const indices = new Uint32Array([
    0,
    1,
    2,
    0,
    2,
    3, // Front
    4,
    5,
    6,
    4,
    6,
    7, // Back
    8,
    9,
    10,
    8,
    10,
    11, // Top
    12,
    13,
    14,
    12,
    14,
    15, // Bottom
    16,
    17,
    18,
    16,
    18,
    19, // Right
    20,
    21,
    22,
    20,
    22,
    23, // Left
  ]);

  return { id, name, type: "body", color, vertices, normals, indices };
}

export function createCylinderMesh(
  id: number,
  name: string,
  radius: number,
  length: number,
  segments: number = 16,
  color?: [number, number, number],
): MultibodyMeshPayload {
  const hl = length / 2;
  const numVerts = (segments + 1) * 2;
  const vertices = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const indices = new Uint32Array(segments * 6);

  let vIdx = 0;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    // Bottom vertex
    vertices[vIdx] = radius * cos;
    vertices[vIdx + 1] = -hl;
    vertices[vIdx + 2] = radius * sin;
    normals[vIdx] = cos;
    normals[vIdx + 1] = 0;
    normals[vIdx + 2] = sin;
    vIdx += 3;

    // Top vertex
    vertices[vIdx] = radius * cos;
    vertices[vIdx + 1] = hl;
    vertices[vIdx + 2] = radius * sin;
    normals[vIdx] = cos;
    normals[vIdx + 1] = 0;
    normals[vIdx + 2] = sin;
    vIdx += 3;
  }

  let iIdx = 0;
  for (let i = 0; i < segments; i++) {
    const b1 = i * 2;
    const t1 = b1 + 1;
    const b2 = (i + 1) * 2;
    const t2 = b2 + 1;

    indices[iIdx++] = b1;
    indices[iIdx++] = t1;
    indices[iIdx++] = b2;

    indices[iIdx++] = b2;
    indices[iIdx++] = t1;
    indices[iIdx++] = t2;
  }

  return { id, name, type: "wheelset", color, vertices, normals, indices };
}

export function createSphereMesh(
  id: number,
  name: string,
  radius: number,
  segments: number = 12,
  color?: [number, number, number],
): MultibodyMeshPayload {
  const rings = segments;
  const sectors = segments;
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const u = s / sectors;
      const theta = u * Math.PI * 2;
      const x = Math.cos(theta) * Math.sin(phi);
      const y = Math.cos(phi);
      const z = Math.sin(theta) * Math.sin(phi);

      vertices.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const first = r * (sectors + 1) + s;
      const second = first + sectors + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return {
    id,
    name,
    type: "marker",
    color,
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export function generateProceduralMultibodyGeometry(
  sourceUri: string,
  content: string = "",
): { meshes: MultibodyMeshPayload[]; components: MultibodyCadComponent[] } {
  const meshes: MultibodyMeshPayload[] = [];
  const components: MultibodyCadComponent[] = [];
  let nextId = 1;

  const isFbi =
    /\.fbi$/i.test(sourceUri) ||
    content.includes("$FBI") ||
    content.includes("FBI_VERSION") ||
    content.includes("<fbi");
  const isSimpack = /\.s(?:pck|im)$/i.test(sourceUri) || content.includes("$body") || content.includes("<body");
  const isGensys =
    /\.c(?:alc|ins|run|sub)$/i.test(sourceUri) || content.includes("rigid_body") || content.includes("wheelset");

  if (isFbi) {
    try {
      const fbi = parseFbiFile(content);
      const modal = extractFbiModalDeformation(fbi);
      const name = fbi.name || "FlexBody";

      const mesh = createBoxMesh(nextId++, name, 2.0, 0.4, 0.4, [0.35, 0.85, 0.65]);
      meshes.push(mesh);

      components.push({
        name,
        cad: { feature: name },
        bindings: {
          position: [`${name}.x`, `${name}.y`, `${name}.z`],
        },
        deformation: {
          mode: "modal",
          modalVariables: modal.modalVariables,
          modeShapes: modal.modeShapes,
        },
      });
      return { meshes, components };
    } catch {}
  } else if (isSimpack) {
    // Extract SIMPACK bodies
    const bodyRegex = /(?:<body\s+[^>]*id="([^"]+)"|^\s*(?:\$body|body)\s+([a-zA-Z0-9_]+))/gim;
    let match;
    while ((match = bodyRegex.exec(content)) !== null) {
      const name = (match[1] || match[2])!;
      meshes.push(createBoxMesh(nextId++, name, 1.2, 0.4, 0.6, [0.35, 0.65, 0.98]));
      components.push({
        name,
        cad: { feature: name },
        bindings: {
          position: [`${name}.r[1]`, `${name}.r[2]`, `${name}.r[3]`],
          rotation: [`${name}.phi`, `${name}.theta`, `${name}.psi`],
        },
      });
    }

    // Extract SIMPACK joints/markers
    const jointRegex = /(?:<joint\s+[^>]*id="([^"]+)"|^\s*(?:\$joint|joint)\s+([a-zA-Z0-9_]+))/gim;
    while ((match = jointRegex.exec(content)) !== null) {
      const name = (match[1] || match[2])!;
      meshes.push(createSphereMesh(nextId++, name, 0.15, 8, [0.95, 0.65, 0.15]));
    }
  } else if (isGensys) {
    // Extract GENSYS rigid bodies
    const rbRegex = /^\s*rigid_body\s+([a-zA-Z0-9_]+)/gim;
    let match;
    while ((match = rbRegex.exec(content)) !== null) {
      const name = match[1]!;
      meshes.push(createBoxMesh(nextId++, name, 2.0, 0.5, 0.8, [0.3, 0.7, 0.4]));
      components.push({
        name,
        cad: { feature: name },
        bindings: {
          position: [`${name}.x`, `${name}.y`, `${name}.z`],
          rotation: [`${name}.fi`, `${name}.th`, `${name}.ps`],
        },
      });
    }

    // Extract GENSYS wheelsets
    const wsRegex = /^\s*wheelset\s+([a-zA-Z0-9_]+)/gim;
    while ((match = wsRegex.exec(content)) !== null) {
      const name = match[1]!;
      meshes.push(createCylinderMesh(nextId++, name, 0.46, 1.5, 16, [0.85, 0.6, 0.15]));
      components.push({
        name,
        cad: { feature: name },
        bindings: {
          position: [`${name}.x`, `${name}.y`, `${name}.z`],
          rotation: [`${name}.fi`, `${name}.th`, `${name}.ps`],
        },
      });
    }
  } else {
    // Generic Modelica Multibody or default assembly
    const mbRegex = /(?:Modelica\.Mechanics\.MultiBody\.Parts\.Body\s+([a-zA-Z0-9_]+)|body\s+([a-zA-Z0-9_]+))/gim;
    let match;
    while ((match = mbRegex.exec(content)) !== null) {
      const name = (match[1] || match[2])!;
      meshes.push(createBoxMesh(nextId++, name, 1.0, 0.4, 0.5, [0.4, 0.6, 0.9]));
      components.push({
        name,
        cad: { feature: name },
        bindings: {
          position: [`${name}.r_0[1]`, `${name}.r_0[2]`, `${name}.r_0[3]`],
        },
      });
    }
  }

  // If no specific bodies matched, create default root body
  if (meshes.length === 0) {
    meshes.push(createBoxMesh(nextId++, "chassis", 1.5, 0.5, 0.8, [0.4, 0.65, 0.95]));
    components.push({
      name: "chassis",
      cad: { feature: "chassis" },
      bindings: {
        position: ["chassis.x", "chassis.y", "chassis.z"],
        rotation: ["chassis.phi", "chassis.theta", "chassis.psi"],
      },
    });
  }

  return { meshes, components };
}

export class MultiBodyAnimationPanel extends BaseWebviewPanel {
  public static currentPanel: MultiBodyAnimationPanel | undefined;
  public static readonly viewType = "modelscript.multibodyAnimation";

  private readonly _client: LanguageClient;
  public sourceUri?: string | undefined;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    client: LanguageClient,
    simulationData: { t: number[]; y: number[][]; states: string[] },
    sourceUri: string,
    modelContent?: string,
  ) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (MultiBodyAnimationPanel.currentPanel) {
      MultiBodyAnimationPanel.currentPanel.sourceUri = sourceUri;
      MultiBodyAnimationPanel.currentPanel._panel.reveal(column);
      await MultiBodyAnimationPanel.currentPanel.loadData(simulationData, modelContent);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MultiBodyAnimationPanel.viewType,
      "3D Multi-Body Animation",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    MultiBodyAnimationPanel.currentPanel = new MultiBodyAnimationPanel(panel, extensionUri, client, sourceUri);
    await MultiBodyAnimationPanel.currentPanel.loadData(simulationData, modelContent);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this._client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell({
      title: "3D Multi-Body Animation",
      scriptName: "multibody-animation-webview.js",
    });
  }

  public async loadData(simulationData: { t: number[]; y: number[][]; states: string[] }, modelContent?: string) {
    if (!this.sourceUri) return;

    let cadComponents: unknown[] = [];
    let stepMeshes: unknown[] = [];

    // 1. Attempt to fetch CAD Components & STEP meshes from LSP
    try {
      cadComponents =
        (await this._client.sendRequest<unknown[]>("modelscript/getCadComponents", {
          uri: this.sourceUri,
        })) || [];
    } catch {
      cadComponents = [];
    }

    try {
      stepMeshes =
        (await this._client.sendRequest<unknown[]>("modelscript/getStepMeshes", {
          uri: this.sourceUri,
        })) || [];
    } catch {
      stepMeshes = [];
    }

    // 2. If no CAD meshes found or if this is a native MBS deck, generate procedural geometry
    if (stepMeshes.length === 0) {
      const procedural = generateProceduralMultibodyGeometry(this.sourceUri, modelContent || "");
      stepMeshes = procedural.meshes;
      if (cadComponents.length === 0) {
        cadComponents = procedural.components;
      }
    }

    this._panel.webview.postMessage({
      type: "init",
      data: {
        stepMeshes,
        cadComponents,
        simulationData,
      },
    });
  }

  /**
   * Push live variable values to the webview for real-time 3D animation.
   */
  public sendLiveValues(values: Record<string, number>, time: number): void {
    this._panel.webview.postMessage({
      type: "liveValues",
      data: { values, time },
    });
  }

  /**
   * Syncs live simulation state variables from DAP debugger to the 3D webview.
   */
  public syncWithDebugger(variables: { name: string; value: string }[], time?: number): void {
    const values: Record<string, number> = {};
    let t = time ?? 0;

    for (const v of variables) {
      const num = Number(v.value);
      if (!isNaN(num)) {
        values[v.name] = num;
        if (v.name === "time" && time === undefined) {
          t = num;
        }
      }
    }

    this.sendLiveValues(values, t);
  }

  public focusPart(partName: string): void {
    this._panel.webview.postMessage({
      type: "focusPart",
      partName,
    });
  }

  public reveal(column?: vscode.ViewColumn): void {
    this._panel.reveal(column);
  }

  public override dispose(): void {
    MultiBodyAnimationPanel.currentPanel = undefined;
    super.dispose();
  }
}
