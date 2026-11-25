// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";
import { canIndexUrdfFile, indexUrdfFile } from "./indexing.js";
import { urdfPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for ROS URDF, SDFormat, and Xacro files (.urdf, .sdf, .xacro).
 */
export const urdfLanguage = language({
  polyglot: urdfPolyglotConfig,
  name: "urdf",
  fileExtensions: [".urdf", ".sdf", ".xacro"],
  maturity: "experimental",
  indexing: {
    indexFile: indexUrdfFile,
    canIndex: canIndexUrdfFile,
  },
  lsp: {
    fileExtensions: [".urdf", ".sdf", ".xacro"],
  },
  ui: {
    panels: [
      {
        id: "urdfEditor",
        viewType: "modelscript.urdfEditor",
        title: "URDF / SDF Robot Kinematics Studio",
        shortTitle: "URDF",
        selector: ["*.urdf", "*.sdf", "*.xacro"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/UrdfPanel.tsx",
        artifactViewTypes: ["urdf", "sdf", "xacro", "urdf-kinematics"],
      },
    ],
    stencils: [
      {
        label: "Rigid Body / Link",
        snippet:
          '  <link name="link_new">\n    <inertial><mass value="1.5"/><inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.02"/></inertial>\n  </link>\n',
      },
      {
        label: "Revolute Joint",
        snippet:
          '  <joint name="joint_new" type="revolute">\n    <parent link="base_link"/>\n    <child link="link_new"/>\n    <axis xyz="0 0 1"/>\n  </joint>\n',
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
    ],
  },
  diagram: {
    placement: {
      persistence: "sidecar",
    },
    mutations: {
      sections: { node: "robot", edge: "robot" },
      createNode: (className: string, name: string) =>
        `<link name="${name}"><!-- ${className} --><inertial><mass value="1.0"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/></inertial></link>`,
      createEdge: (source: string, target: string) =>
        `<joint name="${source}_to_${target}" type="fixed"><parent link="${source}"/><child link="${target}"/></joint>`,
    },
  },

  rules: {
    Document: ($) => repeat(choice($["Element"]!, $["Comment"]!)),

    Element: ($) =>
      seq(
        "<",
        $["TagIdentifier"]!,
        repeat($["Attribute"]!),
        choice(
          "/>",
          seq(">", repeat(choice($["Element"]!, $["TextContent"]!, $["Comment"]!)), "</", $["TagIdentifier"]!, ">"),
        ),
      ),

    Attribute: ($) => seq($["AttrIdentifier"]!, "=", $["StringLiteral"]!),

    TagIdentifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    AttrIdentifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    StringLiteral: () => /"[^"]*"|'[^']*'/,
    TextContent: () => /[^<]+/,
    Comment: () => /<!--([^-]|-[^-]|--[^>])*-->/,
  },
});

export default urdfLanguage;
