// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeCfdConfig } from "@modelscript/cfd";
import { materializeFeaDeck } from "@modelscript/fea";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { registerCadMeshingCommands } from "../cad-meshing-commands.js";
import { CadViewerPanel } from "../cad-viewer-panel.js";
import { GCodeEditorProvider } from "../gcode-editor-provider.js";
import { StepEditorProvider } from "../step-editor-provider.js";

export function registerCadAndMeshingCommands(
  context: vscode.ExtensionContext,
  client?: LanguageClient,
): vscode.Disposable[] {
  // Register automated CAD-to-Mesh background workers (.inp / .su2 generation)
  registerCadMeshingCommands(context, client);

  return [
    vscode.commands.registerCommand("modelscript.openCadViewer", () => {
      if (client) {
        CadViewerPanel.createOrShow(context.extensionUri, client);
      }
    }),

    vscode.commands.registerCommand("modelscript.openStepViewer", async (uri?: vscode.Uri) => {
      let target = uri;
      if (!target) {
        const active = vscode.window.activeTextEditor?.document?.uri;
        if (active && /\.(step|stp|p21)$/i.test(active.path)) {
          target = active;
        }
      }
      if (!target) {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "STEP Files": ["step", "stp", "p21"] },
        });
        if (uris && uris[0]) target = uris[0];
      }
      if (target) {
        await vscode.commands.executeCommand("vscode.openWith", target, StepEditorProvider.viewType);
      } else {
        vscode.window.showInformationMessage("No STEP CAD file found or selected.");
      }
    }),

    vscode.commands.registerCommand("modelscript.previewCsg", async (args?: any) => {
      let targetUri: vscode.Uri | undefined;
      if (args instanceof vscode.Uri) {
        targetUri = args;
      } else if (args?.uri) {
        targetUri = typeof args.uri === "string" ? vscode.Uri.parse(args.uri) : args.uri;
      } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document && /\.scad$/i.test(activeEditor.document.uri.path)) {
          targetUri = activeEditor.document.uri;
        }
      }
      if (!targetUri) {
        const scadFiles = await vscode.workspace.findFiles("**/*.scad", undefined, 1);
        if (scadFiles.length > 0) {
          targetUri = scadFiles[0];
        }
      }
      if (!targetUri) {
        vscode.window.showInformationMessage("No OpenSCAD (.scad) file found in the workspace.");
        return;
      }

      try {
        let docText: string | undefined;
        for (const doc of vscode.workspace.textDocuments) {
          if (doc.uri.toString() === targetUri.toString()) {
            docText = doc.getText();
            break;
          }
        }
        if (!docText) {
          const raw = await vscode.workspace.fs.readFile(targetUri);
          docText = new TextDecoder().decode(raw);
        }

        const res = await client?.sendRequest<any>("modelscript/executeAction", {
          actionId: "preview_csg",
          uri: targetUri.toString(),
          languageId: "scad",
          inputs: { documentText: docText },
        });

        if (res && res.step) {
          const stepUri = targetUri.with({ path: targetUri.path.replace(/\.scad$/i, ".step") });
          await vscode.workspace.fs.writeFile(stepUri, new TextEncoder().encode(res.step));
          if (client && Array.isArray(res.components) && res.components.length > 0) {
            CadViewerPanel.createOrShow(context.extensionUri, client);
          } else {
            await vscode.commands.executeCommand(
              "vscode.openWith",
              stepUri,
              StepEditorProvider.viewType,
              vscode.ViewColumn.Beside,
            );
          }
        } else {
          vscode.window.showWarningMessage("OpenSCAD model evaluated, but produced no 3D solid geometry.");
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to preview OpenSCAD 3D model: ${err?.message ?? err}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.scad.preview_csg", (args?: any) =>
      vscode.commands.executeCommand("modelscript.previewCsg", args),
    ),

    vscode.commands.registerCommand("modelscript.scad.exportStep", async (args?: any) => {
      let targetUri: vscode.Uri | undefined;
      if (args instanceof vscode.Uri) {
        targetUri = args;
      } else if (args?.uri) {
        targetUri = typeof args.uri === "string" ? vscode.Uri.parse(args.uri) : args.uri;
      } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document && /\.scad$/i.test(activeEditor.document.uri.path)) {
          targetUri = activeEditor.document.uri;
        }
      }
      if (!targetUri) return;
      try {
        let docText: string | undefined;
        for (const doc of vscode.workspace.textDocuments) {
          if (doc.uri.toString() === targetUri.toString()) {
            docText = doc.getText();
            break;
          }
        }
        if (!docText) {
          const raw = await vscode.workspace.fs.readFile(targetUri);
          docText = new TextDecoder().decode(raw);
        }
        const res = await client?.sendRequest<any>("modelscript/executeAction", {
          actionId: "export_step",
          uri: targetUri.toString(),
          languageId: "scad",
          inputs: { documentText: docText },
        });
        if (res && res.step) {
          const stepUri = targetUri.with({ path: targetUri.path.replace(/\.scad$/i, ".step") });
          await vscode.workspace.fs.writeFile(stepUri, new TextEncoder().encode(res.step));
          vscode.window.showInformationMessage(`Exported ${stepUri.path.split("/").pop()} to workspace`);
          await vscode.commands.executeCommand(
            "vscode.openWith",
            stepUri,
            StepEditorProvider.viewType,
            vscode.ViewColumn.Beside,
          );
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to export STEP CAD: ${err?.message ?? err}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.scad.export_step", (args?: any) =>
      vscode.commands.executeCommand("modelscript.scad.exportStep", args),
    ),

    vscode.commands.registerCommand("modelscript.openGCodeViewer", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "G-Code Toolpath": ["gcode", "nc", "g"] },
          openLabel: "Open Toolpath in G-Code Viewer",
        });
        if (files && files[0]) {
          targetUri = files[0];
        }
      }
      if (targetUri) {
        await vscode.commands.executeCommand("vscode.openWith", targetUri, GCodeEditorProvider.viewType);
      }
    }),

    vscode.commands.registerCommand("modelscript.exportShapeToStep", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Please open a file containing a shape class.");
        return;
      }

      const uri = editor.document.uri.toString();

      let symbols: vscode.DocumentSymbol[] | unknown[] | undefined;
      try {
        symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | unknown[]>(
          "vscode.executeDocumentSymbolProvider",
          editor.document.uri,
        );
      } catch (e) {
        vscode.window.showErrorMessage("Error fetching symbols: " + e);
      }

      const classNames: string[] = [];
      if (symbols && symbols.length > 0) {
        const extractClasses = (syms: vscode.DocumentSymbol[], prefix: string) => {
          for (const sym of syms) {
            const fullName = prefix ? `${prefix}.${sym.name}` : sym.name;
            if (
              sym.kind !== vscode.SymbolKind.Variable &&
              sym.kind !== vscode.SymbolKind.Property &&
              sym.kind !== vscode.SymbolKind.Field &&
              sym.kind !== vscode.SymbolKind.Constant &&
              sym.kind !== vscode.SymbolKind.Function &&
              sym.kind !== vscode.SymbolKind.Method
            ) {
              classNames.push(fullName);
            }
            if (sym.children && sym.children.length > 0) {
              extractClasses(sym.children, fullName);
            }
          }
        };
        extractClasses(symbols as vscode.DocumentSymbol[], "");
      }

      let className: string | undefined;
      if (classNames.length === 1) {
        className = classNames[0];
      } else if (classNames.length > 1) {
        className = await vscode.window.showQuickPick(classNames, {
          placeHolder: "Select the shape class to export to STEP",
        });
      } else {
        className = await vscode.window.showInputBox({
          prompt: `Enter shape class (Fallback - symbols: ${symbols?.length || "undefined"})`,
          placeHolder: "e.g., DroneCAD.DroneChassis",
        });
      }

      if (!className) return;

      try {
        const result = await client.sendRequest<{ step: string; name: string }>("modelscript/exportShapeToStep", {
          uri,
          className,
        });

        if (result && result.step) {
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
          const fileUri = vscode.Uri.joinPath(folder, `${result.name.split(".").pop()}.step`);
          await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(result.step));
          vscode.window.showInformationMessage(`Exported ${result.name} to ${fileUri.fsPath}`);
          vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript.stepEditor");
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Failed to export shape: ${e instanceof Error ? e.message : e}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.openCadExample", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!folder) {
        vscode.window.showErrorMessage("Please open a workspace folder first.");
        return;
      }
      const sysmlUri = vscode.Uri.joinPath(folder, "drone_architecture.sysml");
      const stepUri = vscode.Uri.joinPath(folder, "drone.step");

      try {
        const sysmlContent = `package DroneArchitecture {
  import DroneCAD::*;

  part def DroneAssembly {
    part chassis : Chassis;
    part rotor1 : Rotor;
    part rotor2 : Rotor;
    part rotor3 : Rotor;
    part rotor4 : Rotor;

    // Reference CAD geometry directly from the STEP file!
    ref chassisGeometry = DroneCAD::ChassisShape;
  }

  part def Chassis {}
  part def Rotor {}
}`;
        await vscode.workspace.fs.writeFile(sysmlUri, new TextEncoder().encode(sysmlContent));

        const stepContent = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('drone','2023-10-23T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2001,#2);
#2=APPLICATION_CONTEXT('core data for automotive mechanical design processes');
#3=SHAPE_DEFINITION_REPRESENTATION(#4,#10);
#4=PRODUCT_DEFINITION_SHAPE('','',#5);
#5=PRODUCT_DEFINITION('design','',#6,#9);
#6=PRODUCT_DEFINITION_FORMATION('','',#7);
#7=PRODUCT('DroneCAD','DroneCAD','',(#8));
#8=PRODUCT_CONTEXT('',#2,'mechanical');
#9=DESIGN_CONTEXT('',#2,'design');
#10=SHAPE_REPRESENTATION('',(#11),#15);
#11=AXIS2_PLACEMENT_3D('',#12,#13,#14);
#12=CARTESIAN_POINT('',(0.,0.,0.));
#13=DIRECTION('',(0.,0.,1.));
#14=DIRECTION('',(1.,0.,0.));
#15=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#16))GLOBAL_UNIT_ASSIGNED_CONTEXT((#17,#18,#19))REPRESENTATION_CONTEXT('Context #1','3D Context with PROGRAM and LENGTH unit'));
#16=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#17,'distance_accuracy_value','confusion accuracy');
#17=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#18=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#19=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#20=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11,#21),#15);
#21=MANIFOLD_SOLID_BREP('ChassisShape',#22);
#22=CLOSED_SHELL('',(#23));
#23=ADVANCED_FACE('',(#24),#29,.T.);
#24=FACE_BOUND('',#25,.T.);
#25=EDGE_LOOP('',(#26,#27,#28));
#26=ORIENTED_EDGE('',*,*,#30,.T.);
#27=ORIENTED_EDGE('',*,*,#31,.T.);
#28=ORIENTED_EDGE('',*,*,#32,.T.);
#29=PLANE('',#33);
#30=EDGE_CURVE('',#34,#35,#36,.T.);
#31=EDGE_CURVE('',#35,#37,#38,.T.);
#32=EDGE_CURVE('',#37,#34,#39,.T.);
#33=AXIS2_PLACEMENT_3D('',#40,#41,#42);
#34=VERTEX_POINT('',#43);
#35=VERTEX_POINT('',#44);
#36=LINE('',#45,#46);
#37=VERTEX_POINT('',#47);
#38=LINE('',#48,#49);
#39=LINE('',#50,#51);
#40=CARTESIAN_POINT('',(0.,0.,0.));
#41=DIRECTION('',(0.,0.,1.));
#42=DIRECTION('',(1.,0.,0.));
#43=CARTESIAN_POINT('',(0.,0.,0.));
#44=CARTESIAN_POINT('',(10.,0.,0.));
#45=CARTESIAN_POINT('',(0.,0.,0.));
#46=VECTOR('',#52,1.);
#47=CARTESIAN_POINT('',(0.,10.,0.));
#48=CARTESIAN_POINT('',(10.,0.,0.));
#49=VECTOR('',#53,1.);
#50=CARTESIAN_POINT('',(0.,10.,0.));
#51=VECTOR('',#54,1.);
#52=DIRECTION('',(1.,0.,0.));
#53=DIRECTION('',(-0.707106781186547,0.707106781186547,0.));
#54=DIRECTION('',(0.,-1.,0.));
#ENDSEC;
#END-ISO-10303-21;`;
        await vscode.workspace.fs.writeFile(stepUri, new TextEncoder().encode(stepContent));

        const doc = await vscode.workspace.openTextDocument(sysmlUri);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });

        setTimeout(() => {
          vscode.commands.executeCommand("vscode.open", stepUri, {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
          });
        }, 1000);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to open CAD example: ${e}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.focusCadPart", async (arg?: any) => {
      let partName = "";
      if (typeof arg === "string") {
        try {
          const parsed = JSON.parse(decodeURIComponent(arg));
          partName = parsed.partName || arg;
        } catch {
          partName = arg;
        }
      } else if (arg && typeof arg === "object") {
        partName = arg.partName || "";
      }

      if (!partName) return;

      const { MultiBodyAnimationPanel } = await import("../multibody-animation-panel.js");
      if (MultiBodyAnimationPanel.currentPanel) {
        MultiBodyAnimationPanel.currentPanel.reveal();
        MultiBodyAnimationPanel.currentPanel.focusPart(partName);
        return;
      }

      if (CadViewerPanel.currentPanel) {
        CadViewerPanel.currentPanel.reveal();
        CadViewerPanel.currentPanel.focusPart(partName);
        return;
      }

      if (client && context.extensionUri) {
        CadViewerPanel.createOrShow(context.extensionUri, client, partName);
      }
    }),

    vscode.commands.registerCommand("modelscript.createFeaSetup", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri || !targetUri.path.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Please select a STEP file to create an FEA setup.");
        return;
      }
      const studyName =
        targetUri.path
          .split("/")
          .pop()
          ?.replace(/\.(step|stp)$/i, "") + "_FEA";
      const setupUri = targetUri.with({ path: targetUri.path + ".fea.mo" });
      const moContent = `model ${studyName}
  extends ModelScript.Studies.StaticStructuralFEA(
    meshResolution = 0.05
  );
  // Add target component here
end ${studyName};
`;
      await vscode.workspace.fs.writeFile(setupUri, new TextEncoder().encode(moContent));
      vscode.window.showInformationMessage(`Created FEA study: ${setupUri.path}`);
      const doc = await vscode.workspace.openTextDocument(setupUri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("modelscript.createCfdSetup", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri || !targetUri.path.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Please select a STEP file to create a CFD setup.");
        return;
      }
      const studyName =
        targetUri.path
          .split("/")
          .pop()
          ?.replace(/\.(step|stp)$/i, "") + "_CFD";
      const setupUri = targetUri.with({ path: targetUri.path + ".cfd.mo" });
      const moContent = `model ${studyName}
  extends ModelScript.Studies.SteadyStateCFD(
    meshResolution = 0.05
  );
  // Add target component here
end ${studyName};
`;
      await vscode.workspace.fs.writeFile(setupUri, new TextEncoder().encode(moContent));
      vscode.window.showInformationMessage(`Created CFD study: ${setupUri.path}`);
      const doc = await vscode.workspace.openTextDocument(setupUri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("modelscript.migrateMsimToStudy", async () => {
      const uris = await vscode.workspace.findFiles("**/*.msim");
      if (uris.length === 0) {
        vscode.window.showInformationMessage("No .msim files found to migrate.");
        return;
      }

      let migratedCount = 0;
      for (const uri of uris) {
        try {
          const content = await vscode.workspace.fs.readFile(uri);
          const json = JSON.parse(new TextDecoder().decode(content));

          const studyName =
            uri.path
              .split("/")
              .pop()
              ?.replace(".msim", "")
              .replace(/[^a-zA-Z0-9_]/g, "_") || "MigratedStudy";
          const workflowClass =
            json.type === "CFD"
              ? "ModelScript.Studies.SteadyStateCFD"
              : json.type === "FEA"
                ? "ModelScript.Studies.StaticStructuralFEA"
                : json.type === "MESHING"
                  ? "ModelScript.Studies.Meshing"
                  : "ModelScript.Studies.TransientSimulation";

          const targetClass = json.targetClass || "TargetModel";
          const meshSize = json.mesh?.size || json.mesh?.min || 0.05;

          const moContent = `model ${studyName}
  extends ${workflowClass}(
    meshResolution = ${meshSize}
  );
  extends ${targetClass};
end ${studyName};
`;

          const moUri = uri.with({ path: uri.path.replace(/\.msim$/, ".mo") });
          await vscode.workspace.fs.writeFile(moUri, new TextEncoder().encode(moContent));
          await vscode.workspace.fs.delete(uri);
          migratedCount++;
        } catch (e) {
          console.error("Failed to migrate", uri.path, e);
        }
      }

      vscode.window.showInformationMessage(
        `Successfully migrated ${migratedCount} .msim files to native Modelica studies.`,
      );
    }),

    vscode.commands.registerCommand("modelscript.generateMesh", async (uri?: vscode.Uri) => {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: "$(file-binary) FEA Structural Mesh (.inp)",
            description: "Generate 3D tetrahedral CalculiX/Abaqus solid mesh",
            targetType: "fea",
          },
          {
            label: "$(globe) CFD Aerodynamic Grid (.su2)",
            description: "Generate SU2 volume mesh with boundary layer inflation",
            targetType: "cfd",
          },
        ],
        { placeHolder: "Select target physics solver grid to generate from CAD" },
      );
      if (!choice) return;
      if (choice.targetType === "fea") {
        await vscode.commands.executeCommand("modelscript.generateFeaMesh", uri);
      } else {
        await vscode.commands.executeCommand("modelscript.generateCfdMesh", uri);
      }
    }),

    vscode.commands.registerCommand("modelscript.materializeCalculixDeck", async (uriOrStr?: vscode.Uri | string) => {
      let targetUri: vscode.Uri | undefined;
      if (typeof uriOrStr === "string") targetUri = vscode.Uri.parse(uriOrStr);
      else if (uriOrStr) targetUri = uriOrStr;
      else if (vscode.window.activeTextEditor) targetUri = vscode.window.activeTextEditor.document.uri;

      if (
        !targetUri ||
        (!targetUri.path.endsWith(".inp") && !targetUri.path.endsWith(".bdf") && !targetUri.path.endsWith(".inpt"))
      ) {
        vscode.window.showErrorMessage("Please open or select an FEA deck (.inp / .bdf) to materialize.");
        return;
      }

      try {
        const fileBytes = await vscode.workspace.fs.readFile(targetUri);
        const rawText = new TextDecoder().decode(fileBytes);
        const materialized = materializeFeaDeck(rawText);
        const outPath = targetUri.path.endsWith(".inpt")
          ? targetUri.path.replace(/\.inpt$/, ".inp")
          : targetUri.path.replace(/(\.[^.]+)$/, ".materialized$1");
        const outUri = targetUri.with({ path: outPath });
        await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(materialized));
        vscode.window
          .showInformationMessage(`Materialized FEA deck to ${outUri.path}`, "Open deck")
          .then(async (sel) => {
            if (sel === "Open deck") {
              const doc = await vscode.workspace.openTextDocument(outUri);
              await vscode.window.showTextDocument(doc);
            }
          });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to materialize FEA deck: ${err.message || err}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.materializeSu2Config", async (uriOrStr?: vscode.Uri | string) => {
      let targetUri: vscode.Uri | undefined;
      if (typeof uriOrStr === "string") targetUri = vscode.Uri.parse(uriOrStr);
      else if (uriOrStr) targetUri = uriOrStr;
      else if (vscode.window.activeTextEditor) targetUri = vscode.window.activeTextEditor.document.uri;

      if (!targetUri || (!targetUri.path.endsWith(".cfg") && !targetUri.path.endsWith(".cfgt"))) {
        vscode.window.showErrorMessage("Please open or select a CFD config (.cfg) to materialize.");
        return;
      }

      try {
        const fileBytes = await vscode.workspace.fs.readFile(targetUri);
        const rawText = new TextDecoder().decode(fileBytes);
        const materialized = materializeCfdConfig(rawText);
        const outPath = targetUri.path.endsWith(".cfgt")
          ? targetUri.path.replace(/\.cfgt$/, ".cfg")
          : targetUri.path.replace(/\.cfg$/, ".materialized.cfg");
        const outUri = targetUri.with({ path: outPath });
        await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(materialized));
        vscode.window
          .showInformationMessage(`Materialized CFD config to ${outUri.path}`, "Open config")
          .then(async (sel) => {
            if (sel === "Open config") {
              const doc = await vscode.workspace.openTextDocument(outUri);
              await vscode.window.showTextDocument(doc);
            }
          });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to materialize CFD config: ${err.message || err}`);
      }
    }),
  ];
}
