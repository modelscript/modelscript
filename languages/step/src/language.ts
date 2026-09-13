import { choice, def, field, language, optional, ref, repeat, repeat1, seq } from "@modelscript/dsl";

export const stepLanguage = language({
  name: "step",

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

  lsp: {
    fileExtension: ".step",
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
        const unifiedIndex = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();

        if (meshes.length === 0 && unifiedIndex) {
          const { generateDroneChassisGeometry } = await import("@modelscript/cad/mesh-fallbacks");
          const normTarget = targetUri.replace(":///", ":/");
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
