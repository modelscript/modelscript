// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { CadViewerPanel } from "../src/cad-viewer-panel.js";
import { extractCadComponents } from "../src/webview/cad-viewer/parse-cad-annotations.js";

describe("CAD Direct-Manipulation Gizmo & Live Writeback", () => {
  it("preserves sourceMetadata through extractCadComponents", () => {
    const rawVariables = [
      {
        name: "box1",
        cad: 'CAD(uri="modelica://Lib/box.glb", position={0, 0, 0})',
        sourceMetadata: {
          parameterName: "box_width",
          transformMethod: "translate",
          argIndex: 0,
          startOffset: 10,
          endOffset: 35,
        },
      },
    ];

    const components = extractCadComponents(rawVariables);
    assert.strictEqual(components.length, 1);
    assert.strictEqual(components[0]!.name, "box1");
    assert.ok(components[0]!.sourceMetadata);
    assert.strictEqual(components[0]!.sourceMetadata?.parameterName, "box_width");
    assert.strictEqual(components[0]!.sourceMetadata?.transformMethod, "translate");
  });

  it("applies parameter writeback to OpenSCAD active document", async () => {
    const scadSource = `// Top comment
width = 25;
height = 50;

cube([width, height, 10]);
`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/model.scad"),
      fileName: "/workspace/model.scad",
      languageId: "scad",
      getText: () => scadSource,
      positionAt: (offset: number) => {
        const lines = scadSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitGizmoDelta({
        componentName: "cube1",
        delta: [15, 0, 0],
        newPosition: [40, 0, 0],
        sourceMetadata: {
          parameterName: "width",
        },
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.strictEqual(replacement.newText, "40");
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies vector transform writeback to OpenSCAD active document", async () => {
    const scadSource = `translate([10, 20, 30]) {
  cube([5, 5, 5]);
}
`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/part.scad"),
      fileName: "/workspace/part.scad",
      languageId: "scad",
      getText: () => scadSource,
      positionAt: (offset: number) => {
        const lines = scadSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitGizmoDelta({
        componentName: "part1",
        delta: [5, 10, -5],
        newPosition: [15, 30, 25],
        sourceMetadata: {
          transformMethod: "translate",
          argIndex: 0,
        },
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for transform");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.strictEqual(replacement.newText, "[15, 30, 25]");
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies position annotation writeback to Modelica active document", async () => {
    const moSource = `model RobotArm
  Body arm1(mass = 5) annotation(CAD(uri="modelica://Robot/arm.glb", position={1.00, 2.00, 3.00}));
end RobotArm;
`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/robot.mo"),
      fileName: "/workspace/robot.mo",
      languageId: "modelica",
      getText: () => moSource,
      positionAt: (offset: number) => {
        const lines = moSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitGizmoDelta({
        componentName: "arm1",
        delta: [0.5, -1.0, 2.0],
        newPosition: [1.5, 1.0, 5.0],
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for Modelica CAD annotation");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.ok(
        replacement.newText.includes("position = {1.5, 1, 5}"),
        "Edit should contain updated position vector in CAD annotation",
      );
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies direct dimension handle writeback to literal primitive in OpenSCAD", async () => {
    const scadSource = `cube([100, 50, 20]);\n`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/part.scad"),
      fileName: "/workspace/part.scad",
      languageId: "scad",
      getText: () => scadSource,
      positionAt: (offset: number) => {
        const lines = scadSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitDimensionDelta({
        componentName: "part1",
        dimensionIndex: 0, // X / Width
        newValue: 140,
        primitiveType: "cube",
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for dimension handle writeback");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.strictEqual(replacement.newText, "140");
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies face tag writeback to OpenSCAD active document", async () => {
    const scadSource = `cube([80, 40, 10]);\n`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/part.scad"),
      fileName: "/workspace/part.scad",
      languageId: "scad",
      getText: () => scadSource,
      positionAt: (offset: number) => {
        const lines = scadSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitFaceTag({
        componentName: "bracket",
        portName: "bearing_flange",
        portType: "mechanical_flange",
        normal: [0, 0, 1],
        sourceMetadata: {
          startOffset: 0,
          endOffset: 19,
        },
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for face tag writeback");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.ok(
        replacement.newText.includes('tag_port("bearing_flange", "mechanical_flange", [0, 0, 1])'),
        "Replacement must wrap solid in tag_port",
      );
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies CADPort tag writeback to Modelica active document", async () => {
    const moSource = `model RobotArm
  Modelica.Mechanics.MultiBody.Parts.BodyBox body;
end RobotArm;
`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });

    const origOnDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument;
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/robot.mo"),
      fileName: "/workspace/robot.mo",
      languageId: "modelica",
      getText: () => moSource,
      positionAt: (offset: number) => {
        const lines = moSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitFaceTag({
        componentName: "body",
        portName: "load_point",
        worldPos: [0.1, 0.2, 0.3],
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for Modelica CADPort tag writeback");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.ok(
        replacement.newText.includes('CADPort(feature = "load_point", offsetPosition = {0.1, 0.2, 0.3})'),
        "Replacement must contain CADPort annotation",
      );
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });

  it("applies kinematic assembly joint writeback to Modelica active document", async () => {
    const moSource = `model TwoLinkArm
  Modelica.Mechanics.MultiBody.Parts.Body link1;
  Modelica.Mechanics.MultiBody.Parts.Body link2;
equation
  connect(world.frame_b, link1.frame_a);
end TwoLinkArm;
`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const origOnDidChangeActiveTextEditor = (vscode.window as any).onDidChangeActiveTextEditor;
    const origOnDidChangeTextDocument = (vscode.workspace as any).onDidChangeTextDocument;
    (vscode.window as any).onDidChangeActiveTextEditor = () => ({ dispose: () => {} });
    (vscode.workspace as any).onDidChangeTextDocument = () => ({ dispose: () => {} });

    const mockClient: any = {
      onNotification: () => {},
      sendRequest: async () => [],
    };

    const mockDoc: any = {
      uri: vscode.Uri.file("/workspace/arm.mo"),
      fileName: "/workspace/arm.mo",
      languageId: "modelica",
      getText: () => moSource,
      positionAt: (offset: number) => {
        const lines = moSource.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    };

    const origActiveEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = {
      document: mockDoc,
    };

    const mockPanel: any = {
      webview: {
        asWebviewUri: (u: any) => u,
        postMessage: () => {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
    };

    const panel = new (CadViewerPanel as any)(mockPanel, vscode.Uri.file("/ext"), mockClient);

    try {
      await panel.handleCommitAssemblyJoint({
        jointName: "elbowJoint",
        jointType: "Revolute",
        partA: "link1",
        frameA: "frame_b",
        partB: "link2",
        frameB: "frame_a",
        axis: [0, 0, 1],
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied for assembly joint");
      const entries = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(entries.length > 0, "Edit should contain replacement");
      const replacement = entries[0];
      assert.ok(
        replacement.newText.includes("Modelica.Mechanics.MultiBody.Joints.Revolute elbowJoint(n = {0, 0, 1});"),
        "Replacement must contain Revolute declaration",
      );
      assert.ok(
        replacement.newText.includes("connect(link1.frame_b, elbowJoint.frame_a);"),
        "Replacement must connect link1 to elbowJoint.frame_a",
      );
      assert.ok(
        replacement.newText.includes("connect(elbowJoint.frame_b, link2.frame_a);"),
        "Replacement must connect elbowJoint.frame_b to link2.frame_a",
      );
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).onDidChangeActiveTextEditor = origOnDidChangeActiveTextEditor;
      (vscode.workspace as any).onDidChangeTextDocument = origOnDidChangeTextDocument;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      panel.dispose();
    }
  });
});
