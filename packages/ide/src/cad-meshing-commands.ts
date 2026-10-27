// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepMesher } from "@modelscript/simulate";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * Registers automated CAD-to-Mesh command palette and context menu actions in VS Code.
 */

async function resolveStepBytes(
  context: vscode.ExtensionContext,
  client: LanguageClient | undefined,
  targetUri: vscode.Uri,
  rawBytes: Uint8Array,
): Promise<Uint8Array | string | { vertices: Float32Array | number[]; indices: Uint32Array | number[] }> {
  if (/\.scad$/i.test(targetUri.path)) {
    try {
      const text = new TextDecoder().decode(rawBytes);
      const { getScadParser } = await import("@modelscript/scad");
      const { ScadEvaluator } = await import("@modelscript/scad/evaluator");
      const { ManifoldWorker } = await import("@modelscript/cad");

      let wasmBytes: Uint8Array | undefined;
      try {
        const wasmUri = vscode.Uri.joinPath(context.extensionUri, "dist", "scad.wasm");
        wasmBytes = await vscode.workspace.fs.readFile(wasmUri);
      } catch {
        // Fallback to default resolution in Node environments
      }

      const parser = await getScadParser(wasmBytes);
      const tree = parser.parse(text);
      if (tree) {
        const evaluator = new ScadEvaluator();
        const solid = evaluator.evaluate(tree.rootNode);
        if (solid) {
          const mesh = ManifoldWorker.evaluateSolid(solid);
          if (mesh.vertices.length > 0 && mesh.indices.length > 0) {
            return { vertices: mesh.vertices, indices: mesh.indices };
          }
        }
      }
    } catch (err) {
      console.warn("[cad-meshing] Direct SCAD evaluation fallback:", err);
    }

    if (client) {
      try {
        const comps = await client.sendRequest<
          {
            proceduralMesh?: { vertices?: number[] | undefined; indices?: number[] | undefined } | undefined;
            cad?: { position?: [number, number, number] | number[] | undefined } | undefined;
          }[]
        >("modelscript/getCadComponents", {
          uri: targetUri.toString(),
        });
        if (Array.isArray(comps) && comps.length > 0) {
          const vertices: number[] = [];
          const indices: number[] = [];
          for (const comp of comps) {
            const pm = comp?.proceduralMesh;
            if (!pm || !Array.isArray(pm.vertices) || !Array.isArray(pm.indices) || pm.indices.length === 0) continue;
            const pos: [number, number, number] = Array.isArray(comp.cad?.position)
              ? [
                  Number(comp.cad.position[0]) || 0,
                  Number(comp.cad.position[1]) || 0,
                  Number(comp.cad.position[2]) || 0,
                ]
              : [0, 0, 0];
            const baseVertex = vertices.length / 3;
            for (let i = 0; i < pm.vertices.length; i += 3) {
              vertices.push(
                Number(pm.vertices[i]) + pos[0],
                Number(pm.vertices[i + 1]) + pos[1],
                Number(pm.vertices[i + 2]) + pos[2],
              );
            }
            for (let i = 0; i < pm.indices.length; i++) {
              indices.push(baseVertex + Number(pm.indices[i]));
            }
          }
          if (vertices.length > 0 && indices.length > 0) {
            return { vertices, indices };
          }
        }
      } catch (lspErr) {
        console.warn("[cad-meshing] LSP getCadComponents fallback failed:", lspErr);
      }
    }
  }
  return rawBytes;
}

export function registerCadMeshingCommands(context: vscode.ExtensionContext, client?: LanguageClient): void {
  // Command: Generate FEA Mesh (.inp) from CAD
  const genFeaDisposable = vscode.commands.registerCommand(
    "modelscript.generateFeaMesh",
    async (fileUri?: vscode.Uri) => {
      let targetUri = fileUri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri) {
        vscode.window.showErrorMessage("No CAD file selected for FEA meshing.");
        return;
      }

      const resolution = await vscode.window.showQuickPick(
        [
          { label: "Coarse", description: "Fast tetrahedral discretization (res: 12)", res: 12 },
          { label: "Medium", description: "Standard engineering accuracy (res: 20)", res: 20 },
          { label: "Fine", description: "High-density mesh for stress hotspots (res: 35)", res: 35 },
        ],
        { placeHolder: "Select FEA Mesh Resolution" },
      );

      if (!resolution) return;

      const orderChoice = await vscode.window.showQuickPick(
        [
          {
            label: "Quadratic (Tet10 / C3D10)",
            description: "High-accuracy mid-edge nodes, prevents shear locking",
            order: "quadratic" as const,
          },
          { label: "Linear (Tet4 / C3D4)", description: "Standard 4-node linear tetrahedra", order: "linear" as const },
        ],
        { placeHolder: "Select Element Formulation Order" },
      );

      if (!orderChoice) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Meshing ${targetUri.path.split("/").pop()} into CalculiX FEA deck...`,
          cancellable: false,
        },
        async () => {
          try {
            const rawBytes = await vscode.workspace.fs.readFile(targetUri!);
            const stepBytes = await resolveStepBytes(context, client, targetUri!, rawBytes);
            const result = StepMesher.meshStepToTetrahedra(stepBytes, {
              resolution: resolution.res,
              order: orderChoice.order,
            });

            const inpDeck = StepMesher.exportToCalculixInp(result.mesh, result.patches, {
              heading: `FEA Mesh generated from ${targetUri!.path.split("/").pop()}`,
            });

            // Write alongside CAD file as .inp
            const inpPath = targetUri!.path.replace(/\.(step|stp|scad)$/i, "") + ".inp";
            const inpUri = targetUri!.with({ path: inpPath });

            await vscode.workspace.fs.writeFile(inpUri, new TextEncoder().encode(inpDeck));

            vscode.window.showInformationMessage(
              `Generated FEA Mesh: ${result.mesh.numNodes} nodes, ${result.mesh.numElements} elements (${result.quality.minJacobian.toFixed(3)} min Jacobian).`,
            );

            // Open in InpEditor
            await vscode.commands.executeCommand("vscode.openWith", inpUri, "modelscript.inpEditor");
          } catch (err: unknown) {
            vscode.window.showErrorMessage(`FEA Meshing failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      );
    },
  );

  // Command: Generate CFD Mesh (.su2) from CAD with Boundary Layer Inflation
  const genCfdDisposable = vscode.commands.registerCommand(
    "modelscript.generateCfdMesh",
    async (fileUri?: vscode.Uri) => {
      let targetUri = fileUri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri) {
        vscode.window.showErrorMessage("No CAD file selected for CFD meshing.");
        return;
      }

      const inflationChoice = await vscode.window.showQuickPick(
        [
          {
            label: "Yes (Turbulent Boundary Layer)",
            description: "Extrude 3-5 structured prism layers along walls (y+ <= 1)",
            inflate: true,
          },
          {
            label: "No (Pure Tetrahedral Grid)",
            description: "Unstructured tetrahedral discretization only",
            inflate: false,
          },
        ],
        { placeHolder: "Include Viscous Boundary Layer Inflation?" },
      );

      if (!inflationChoice) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Meshing ${targetUri.path.split("/").pop()} into SU2 CFD grid...`,
          cancellable: false,
        },
        async () => {
          try {
            const rawBytes = await vscode.workspace.fs.readFile(targetUri!);
            const stepBytes = await resolveStepBytes(context, client, targetUri!, rawBytes);
            const result = StepMesher.meshStepToTetrahedra(stepBytes, {
              resolution: 18,
              order: "linear",
              inflation: inflationChoice.inflate
                ? {
                    firstLayerHeight: 0.0005,
                    numLayers: 3,
                    growthRatio: 1.2,
                  }
                : undefined,
            });

            const su2Mesh = StepMesher.exportToSu2Mesh(result.mesh, result.patches);

            // Write alongside CAD file as .su2
            const su2Path = targetUri!.path.replace(/\.(step|stp|scad)$/i, "") + ".su2";
            const su2Uri = targetUri!.with({ path: su2Path });

            await vscode.workspace.fs.writeFile(su2Uri, new TextEncoder().encode(su2Mesh));

            vscode.window.showInformationMessage(
              `Generated SU2 CFD Grid: ${result.mesh.numNodes} points, ${result.mesh.numElements} elements.`,
            );

            // Also generate companion .cfg if not present
            const cfgPath = targetUri!.path.replace(/\.(step|stp|scad)$/i, "") + ".cfg";
            const cfgUri = targetUri!.with({ path: cfgPath });
            const cadFileName = targetUri!.path.split("/").pop() || "model.scad";
            const su2FileName = su2Path.split("/").pop();
            try {
              await vscode.workspace.fs.stat(cfgUri);
            } catch {
              const defaultCfg =
                [
                  `% SU2 CFD Configuration generated from CAD: ${cadFileName}`,
                  `SOLVER= RANS`,
                  `KIND_TURB_MODEL= SA`,
                  `MATH_PROBLEM= DIRECT`,
                  `RESTART_SOL= NO`,
                  `MACH_NUMBER= 0.15`,
                  `AOA= 0.0`,
                  `FREESTREAM_VELOCITY= ( 15.0, 0.0, 0.0 )`,
                  `FREESTREAM_PRESSURE= 101325.0`,
                  `FREESTREAM_TEMPERATURE= 288.15`,
                  `REFLEN= 1.0`,
                  `REFAREA= 1.0`,
                  `MESH_FILENAME= ${su2FileName}`,
                  `MESH_FORMAT= SU2`,
                  `MARKER_HEATFLUX= ( WALL_BODY, 0.0 )`,
                  `MARKER_FAR= ( INLET, OUTLET )`,
                  `NUM_METHOD_GRAD= GREEN_GAUSS`,
                  `CFL_NUMBER= 10.0`,
                  `ITER= 500`,
                  `CONV_CRITERIA= RESIDUAL`,
                  `RESIDUAL_REDUCTION= 6`,
                ].join("\n") + "\n";
              await vscode.workspace.fs.writeFile(cfgUri, new TextEncoder().encode(defaultCfg));
            }

            // Open in CfgEditor
            await vscode.commands.executeCommand("vscode.openWith", cfgUri, "modelscript.cfgEditor");
          } catch (err: unknown) {
            vscode.window.showErrorMessage(`CFD Meshing failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      );
    },
  );

  context.subscriptions.push(genFeaDisposable, genCfdDisposable);
}
