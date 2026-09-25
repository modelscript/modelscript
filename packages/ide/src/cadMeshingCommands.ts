// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepMesher } from "@modelscript/simulate";
import * as vscode from "vscode";

/**
 * Registers automated CAD-to-Mesh command palette and context menu actions in VS Code.
 */
export function registerCadMeshingCommands(context: vscode.ExtensionContext): void {
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
            const result = StepMesher.meshStepToTetrahedra(rawBytes, {
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
          } catch (err: any) {
            vscode.window.showErrorMessage(`FEA Meshing failed: ${err.message || String(err)}`);
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
            const result = StepMesher.meshStepToTetrahedra(rawBytes, {
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
            try {
              await vscode.workspace.fs.stat(cfgUri);
            } catch {
              const su2FileName = su2Path.split("/").pop();
              const defaultCfg =
                [
                  `% SU2 CFD Configuration generated from CAD`,
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
          } catch (err: any) {
            vscode.window.showErrorMessage(`CFD Meshing failed: ${err.message || String(err)}`);
          }
        },
      );
    },
  );

  context.subscriptions.push(genFeaDisposable, genCfdDisposable);
}
