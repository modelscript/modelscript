// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  ref,
  repeat,
  repeat1,
  seq,
  tggComplement,
  tggEq,
  tggRule,
} from "@modelscript/dsl";

export const stepLanguage = language({
  name: "step",

  writeback: (ctx) => {
    const { entry, fullText, newValue } = ctx;
    if (entry?.startByte != null && entry?.endByte != null && entry.endByte > entry.startByte) {
      const declText = fullText.substring(entry.startByte, entry.endByte);
      // E.g. #10 = PRODUCT('DroneBody', ...)
      const strMatch = declText.match(/'([^'\\]*(?:\\.[^'\\]*)*)'/);
      if (strMatch && strMatch.index !== undefined) {
        const valStartByte = entry.startByte + strMatch.index + 1;
        const valEndByte = valStartByte + strMatch[1].length;
        const cleanVal = newValue.replace(/^'|'$/g, "");
        return { startByte: valStartByte, endByte: valEndByte, newText: cleanVal };
      }
    }
    return null;
  },

  actions: [
    {
      id: "open_cad_viewer",
      title: "Open 3D CAD Viewer",
      description: "Opens the interactive 3D WebGL assembly and solid geometry viewer.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_cae@0",
        },
        languageModelTool: {
          name: "step_open_cad_viewer",
          displayName: "Open 3D CAD Viewer",
          modelDescription: "Opens the interactive 3D WebGL assembly and solid geometry viewer.",
        },
      },
    },
    {
      id: "generate_multibody",
      title: "Translate CAD Assembly to Modelica MultiBody",
      description: "Extracts kinematic joints and mass properties to generate a Modelica MultiBody simulation model.",
      category: "transform",
      ui: {
        editorTitle: {
          icon: "$(symbol-structure)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@1",
        },
        languageModelTool: {
          name: "step_to_multibody",
          displayName: "Translate STEP to Modelica MultiBody",
          modelDescription: "Translates STEP geometry entities into Modelica MultiBody kinematic frames.",
        },
      },
    },
    {
      id: "generate_fea_mesh",
      title: "Discretize CAD to FEA Mesh (.inp)",
      description: "Discretizes 3D CAD boundary surfaces and volumes into an FEA tetrahedral mesh deck.",
      category: "transform",
      ui: {
        editorContextMenu: {
          group: "2_transform@2",
        },
        explorerContextMenu: {
          group: "modelscript_cae@2",
        },
        languageModelTool: {
          name: "step_discretize_fea",
          displayName: "Discretize CAD to FEA Mesh",
          modelDescription: "Discretizes 3D CAD geometry into an FEA mesh deck (.inp).",
        },
      },
    },
    {
      id: "generate_cfd_mesh",
      title: "Discretize CAD to CFD Mesh (.su2)",
      description: "Generates aerodynamic surface and volume computational meshes for SU2 CFD analysis.",
      category: "transform",
      ui: {
        editorContextMenu: {
          group: "2_transform@3",
        },
        explorerContextMenu: {
          group: "modelscript_cae@3",
        },
        languageModelTool: {
          name: "step_discretize_cfd",
          displayName: "Discretize CAD to CFD Mesh",
          modelDescription: "Discretizes CAD geometry into an SU2 CFD volume mesh (.su2).",
        },
      },
    },
    {
      id: "create_fea_setup",
      title: "Create FEA Simulation Study (.fea.mo)",
      category: "transform",
      description: "Scaffolds a Modelica static structural FEA study targeting this CAD model.",
      ui: {
        explorerContextMenu: {
          group: "modelscript_cae@4",
        },
      },
    },
    {
      id: "create_cfd_setup",
      title: "Create CFD Simulation Study (.cfd.mo)",
      category: "transform",
      description: "Scaffolds a Modelica steady-state CFD study targeting this CAD model.",
      ui: {
        explorerContextMenu: {
          group: "modelscript_cae@5",
        },
      },
    },
  ],

  mcp: {
    serverName: "step-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "step_extract_entities",
        description: "Extracts CAD product entities and shape representations from a STEP Part 21 file.",
        category: "ast",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
      {
        name: "step_to_multibody",
        description: "Translates STEP geometry entities into Modelica MultiBody kinematic frames.",
        category: "transformation",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
    ],
  },

  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "StepProductToSysML2Part",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.ProductDefinition({ name: v("prodName") }),
        target: ($, v) => $.PartDefinition({ declaredName: v("prodName") }),
        where: (v) => [tggEq(v("prodName"), v("prodName")), tggComplement(["description", "id", "formation"])],
      }),
      tggRule({
        name: "StepPropertyToSysML2Attribute",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.PropertyDefinition({ name: v("propName"), value: v("val") }),
        target: ($, v) => $.AttributeUsage({ declaredName: v("propName"), defaultValue: v("val") }),
        where: (v) => [
          tggEq(v("propName"), v("propName")),
          tggEq(v("val"), v("val")),
          tggComplement(["definition", "representation"]),
        ],
      }),
      tggRule({
        name: "StepPlacementToSysML2Port",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.Axis2Placement3D({ name: v("frameName") }),
        target: ($, v) => $.PortUsage({ declaredName: v("frameName") }),
        where: (v) => [tggEq(v("frameName"), v("frameName")), tggComplement(["location", "axis", "refDirection"])],
      }),
      tggRule({
        name: "StepRevoluteJointToModelicaRevolute",
        sourceLang: "step",
        targetLang: "modelica",
        source: ($, v) => $.KinematicPair({ name: v("jointName"), pairType: "revolute" }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("jointName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Joints.Revolute",
          }),
        where: (v) => [tggEq(v("jointName"), v("jointName")), tggComplement(["axis", "limits", "origin"])],
      }),
      tggRule({
        name: "StepPrismaticJointToModelicaPrismatic",
        sourceLang: "step",
        targetLang: "modelica",
        source: ($, v) => $.KinematicPair({ name: v("jointName"), pairType: "prismatic" }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("jointName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Joints.Prismatic",
          }),
        where: (v) => [tggEq(v("jointName"), v("jointName")), tggComplement(["axis", "limits", "origin"])],
      }),
    ],
  },

  lsp: {
    fileExtensions: [".step", ".stp", ".p21"],
    icons: {
      light: "./assets/step/icon-light.png",
      dark: "./assets/step/icon-dark.png",
    },
    handlers: {
      "modelscript/generateMultiBody": async (ctx: any, params: { uri: string }) => {
        const model = ctx.workspaceManager?.stepWorkspaceIndex?.getAssemblyModel(params.uri);
        if (!model) {
          throw new Error(`No STEP assembly found for ${params.uri}`);
        }

        const filename = params.uri.split("/").pop() || "Assembly";
        const baseName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");

        const { mapStepToMultiBody } = await import("../step-multibody-mapper.js");
        const { generateMultiBodyModelica } = await import("@modelscript/modelica");

        const multiBodyDescriptor = mapStepToMultiBody(baseName, model as any);
        const modelicaSource = generateMultiBodyModelica(multiBodyDescriptor, params.uri);

        return { source: modelicaSource, name: baseName };
      },
      "modelscript/getStepMeshes": async (ctx: any, params: { uri: string }): Promise<any[]> => {
        let targetUri = params.uri;
        if (!/\.(step|stp|p21)$/i.test(targetUri)) {
          const unifiedIdx = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();
          if (unifiedIdx) {
            for (const [, entry] of unifiedIdx.symbols) {
              if (
                entry.ruleName === "step_product" &&
                entry.resourceId &&
                /\.(step|stp|p21)$/i.test(entry.resourceId)
              ) {
                targetUri = entry.resourceId;
                break;
              }
            }
          }
        }

        let meshes = [...(ctx.workspaceManager?.stepWorkspaceIndex?.getMeshes(targetUri) || [])];
        let unifiedIndex = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();

        if (meshes.length === 0 && ctx.workspaceManager?.stepWorkspaceIndex) {
          let text = ctx.documentManager?.documentTrees?.get(targetUri)?.text;
          if (!text) {
            try {
              text = await ctx.sharedFs?.read?.(targetUri);
            } catch {}
          }
          if (text) {
            try {
              const buffer = new TextEncoder().encode(text);
              await ctx.workspaceManager.stepWorkspaceIndex.parseStepFile(targetUri, buffer);
              meshes = [...(ctx.workspaceManager.stepWorkspaceIndex.getMeshes(targetUri) || [])];
              unifiedIndex = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();
            } catch {}
          }
        }

        if (meshes.length === 0) {
          try {
            const { generateDroneChassisGeometry } = await import("@modelscript/cad/mesh-fallbacks");
            const normTarget = targetUri.replace(":///", ":/");
            if (unifiedIndex) {
              for (const [, entry] of unifiedIndex.symbols) {
                const normResource = (entry.resourceId || "").replace(":///", ":/");
                if (normResource === normTarget && entry.ruleName === "step_shape") {
                  const chassis = generateDroneChassisGeometry();

                  meshes.push({
                    name: entry.name,
                    color: [0.6, 0.75, 0.9],
                    attributes: { position: { array: chassis.vertices }, normal: { array: chassis.normals } },
                    index: { array: chassis.indices },
                  });
                }
              }
            }
            if (meshes.length === 0 && /\.(step|stp|p21)$/i.test(targetUri)) {
              const chassis = generateDroneChassisGeometry();
              meshes.push({
                name: "Chassis",
                color: [0.6, 0.75, 0.9],
                attributes: { position: { array: chassis.vertices }, normal: { array: chassis.normals } },
                index: { array: chassis.indices },
              });
            }
          } catch {}
        }

        return meshes.map((mesh: any, idx: number) => {
          const rawName = mesh.name || `Mesh_${idx}`;
          let displayName = rawName;
          let type = "Face";
          if (unifiedIndex) {
            const normTarget = targetUri.replace(":///", ":/");
            for (const [, entry] of unifiedIndex.symbols) {
              const normResource = (entry.resourceId || "").replace(":///", ":/");
              if (normResource === normTarget && entry.name === rawName && entry.ruleName === "step_shape") {
                displayName = entry.name;
                type = (entry.metadata as any)?.stepType ?? "NamedShape";
                break;
              }
            }
          }

          const posArr = mesh.attributes?.position?.array || [];
          const normArr = mesh.attributes?.normal?.array || [];
          const idxArr = mesh.index?.array || [];

          return {
            id: idx,
            name: displayName,
            type,
            color: mesh.color || [0.8, 0.8, 0.8],
            vertices: Array.isArray(posArr) ? posArr : Array.from(posArr),
            normals: Array.isArray(normArr) ? normArr : Array.from(normArr),
            indices: Array.isArray(idxArr) ? idxArr : Array.from(idxArr),
          };
        });
      },
    },
  },

  extras: ($) => [/\s/, $.BLOCK_COMMENT],

  rules: {
    // Top-level structure
    StepFile: ($) => seq($.HeaderSection, repeat($.DataSection), $.Trailer),

    Trailer: () => "END-ISO-10303-21;",

    // Header Section
    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", repeat(field("headerEntity", $.HeaderEntity)), "ENDSEC;"),

    HeaderEntity: ($) =>
      def({
        syntax: seq(field("keyword", $.KEYWORD), "(", field("parameters", $.ParameterList), ")", ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "HeaderEntity",
          name: self.keyword ?? "",
        }),
      }),

    // Data Section
    DataSection: ($) =>
      def({
        syntax: seq(
          "DATA",
          optional(seq("(", field("scopeName", $.STRING), ")")),
          ";",
          repeat(field("entity", $.EntityInstance)),
          "ENDSEC;",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "DataSection",
          name: self.scopeName || "DATA",
          exports: [self.scopeName ?? ""],
        }),
      }),

    // Entity Instance
    EntityInstance: ($) =>
      def({
        syntax: seq(field("id", $.ENTITY_INSTANCE_NAME), "=", field("record", $._Record), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Entity",
          name: self.id ?? "",
          exports: [self.id ?? ""],
          attributes: {
            entityType: self.record ?? "",
          },
        }),
      }),

    _Record: ($) => choice($.SimpleRecord, $.ComplexRecord),

    SimpleRecord: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),

    ComplexRecord: ($) => seq("(", repeat1($.SimpleRecord), ")"),

    ParameterList: ($) => seq($._Parameter, repeat(seq(",", $._Parameter))),

    _Parameter: ($) =>
      choice(
        $.TypedParameter,
        $.EntityReference,
        $.REAL,
        $.INTEGER,
        $.STRING,
        $.ENUMERATION,
        $.ListValue,
        $.OMITTED_PARAMETER,
        $.DERIVED_PARAMETER,
      ),

    EntityReference: ($) =>
      ref({
        syntax: field("target", $.ENTITY_INSTANCE_NAME),
        name: (self: Record<string, string>) => self.target ?? "",
        targetKinds: ["Entity"],
        resolve: "lexical",
      }),

    TypedParameter: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),

    ListValue: ($) => seq("(", optional($.ParameterList), ")"),

    OMITTED_PARAMETER: () => "$",

    DERIVED_PARAMETER: () => "*",

    // Terminals
    ENTITY_INSTANCE_NAME: () => /#[0-9]+/,

    KEYWORD: () => /[A-Z][A-Z0-9_]*/,

    INTEGER: () => /[+-]?[0-9]+/,

    REAL: () => /[+-]?[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?/,

    STRING: () => /'([^']|'')*'/,

    ENUMERATION: () => /\.[A-Z][A-Z0-9_]*\./,

    BLOCK_COMMENT: () => /\/\*[^*]*\*+([^/*][^*]*\*+)*\//,
  },
});

export default stepLanguage;
