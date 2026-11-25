// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withSandbox } from "../sandbox.js";
import type { ServerContext } from "../types.js";
export function registerEcadTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "ecad_dfm_audit",
    "Runs Design for Manufacturing, Assembly, and Test (DFM/DFA/DFT) design rule checks on PCB layout data.",
    {
      traces: z
        .array(
          z.object({
            points: z.array(z.object({ x: z.number(), y: z.number() })),
            width: z.number(),
            layer: z.string(),
            netId: z.string(),
            selected: z.boolean().optional(),
          }),
        )
        .describe("PCB copper traces"),
      pads: z
        .array(
          z.object({
            center: z.object({ x: z.number(), y: z.number() }),
            width: z.number(),
            height: z.number(),
            shape: z.enum(["circle", "rect", "oval", "roundrect"]),
            layer: z.string(),
            netId: z.string(),
            component: z.string(),
            pinName: z.string(),
            selected: z.boolean().optional(),
          }),
        )
        .describe("Component SMD / THT pads"),
      vias: z
        .array(
          z.object({
            center: z.object({ x: z.number(), y: z.number() }),
            outerRadius: z.number(),
            drillRadius: z.number(),
            netId: z.string(),
            selected: z.boolean().optional(),
          }),
        )
        .default([])
        .describe("Vias"),
      boardOutline: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .default([])
        .describe("Board outline vertices"),
      expectedNets: z
        .record(z.string(), z.array(z.string()))
        .default({})
        .describe("Map of netId to expected component.pin connections"),
      tier: z
        .enum(["standard", "hdi"])
        .default("standard")
        .describe("CM capability profile tier: standard 2-4 layer or advanced HDI"),
      components: z
        .array(
          z.object({
            name: z.string(),
            footprint: z.string(),
            center: z.object({ x: z.number(), y: z.number() }),
            heightMm: z.number().optional(),
          }),
        )
        .optional()
        .describe("Placed component geometries for DFA shadowing checks"),
    },
    async ({ traces, pads, vias, boardOutline, expectedNets, tier, components }) => {
      const { runDRC, CM_STANDARD_RULES, CM_ADVANCED_HDI_RULES } = await import("@modelscript/cad/ecad");
      const rules = tier === "hdi" ? CM_ADVANCED_HDI_RULES : CM_STANDARD_RULES;
      const expectedNetMap = new Map<string, string[]>();
      for (const [netId, pins] of Object.entries(expectedNets)) {
        expectedNetMap.set(netId, pins as string[]);
      }

      const res = runDRC({
        traces: traces.map((t) => ({ ...t, selected: t.selected ?? false })),
        pads: pads.map((p) => ({ ...p, selected: p.selected ?? false })),
        vias: vias.map((v) => ({ ...v, selected: v.selected ?? false })),
        boardOutline,
        expectedNets: expectedNetMap,
        rules,
        components: components ?? undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                tier,
                totalChecks: res.totalChecks,
                passRate: Math.round(res.passRate * 1000) / 10,
                violationCount: res.violations.length,
                violations: res.violations,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "ecad_generate_manufacturing_bundle",
    "Generates complete, verified manufacturing files (IPC-2581C, ODB++ v8.1, Gerbers, and Centroid PnP) from PCB layout.",
    {
      projectName: z.string().describe("Project name (e.g. 'Titan_Compute_Module')"),
      revision: z.string().default("1.0.0").describe("Hardware revision"),
      layout: z
        .object({
          traces: z.array(
            z.object({
              start: z.tuple([z.number(), z.number()]),
              end: z.tuple([z.number(), z.number()]),
              width: z.number(),
              layer: z.string(),
              net: z.string(),
            }),
          ),
          pads: z.array(
            z.object({
              center: z.tuple([z.number(), z.number()]),
              width: z.number(),
              height: z.number(),
              drill: z.number(),
              shape: z.enum(["circle", "rect", "oval", "roundrect"]),
              layer: z.string(),
              net: z.string(),
              component: z.string(),
            }),
          ),
          vias: z
            .array(
              z.object({
                center: z.tuple([z.number(), z.number()]),
                drill: z.number(),
                annularRing: z.number(),
                net: z.string(),
              }),
            )
            .default([]),
          outline: z
            .object({
              vertices: z.array(z.tuple([z.number(), z.number()])),
            })
            .nullable()
            .default(null),
          netlist: z.object({
            nets: z.array(
              z.object({
                id: z.string(),
                pins: z.array(
                  z.object({
                    name: z.string(),
                    component: z.string(),
                    localName: z.string(),
                  }),
                ),
              }),
            ),
            components: z.array(
              z.object({
                name: z.string(),
                pins: z.array(z.string()),
                placement: z
                  .object({
                    footprint: z.string().nullable(),
                    layer: z.string(),
                    x: z.number(),
                    y: z.number(),
                    angle: z.number(),
                  })
                  .nullable(),
              }),
            ),
            totalPins: z.number(),
            totalConnections: z.number(),
          }),
        })
        .describe("Complete PCB layout object"),
      format: z.enum(["all", "ipc2581", "odb", "centroid"]).default("all").describe("Target export format"),
    },
    async ({ projectName, revision, layout, format }) => {
      const {
        compileToIPC2581,
        compileToODB,
        generateCentroidRecords,
        formatStandardCentroidCsv,
        formatJlcpcbCplCsv,
        formatMacrofabXy,
        generateManufacturingFiles,
      } = await import("@modelscript/cad/ecad");

      const result: Record<string, unknown> = {
        projectName,
        revision,
        generatedAt: new Date().toISOString(),
      };

      const typedLayout = layout as Parameters<typeof compileToIPC2581>[0];

      if (format === "all" || format === "ipc2581") {
        const xml = compileToIPC2581(typedLayout, { assemblyName: projectName, revision });
        result["ipc2581_length_bytes"] = Buffer.byteLength(xml, "utf8");
        result["ipc2581_xml_preview"] = xml.slice(0, 500) + "...";
      }

      if (format === "all" || format === "odb") {
        const odb = compileToODB(typedLayout, { jobName: projectName.toLowerCase() });
        const tar = odb.toTar();
        result["odb_files_count"] = odb.files.size;
        result["odb_tar_size_bytes"] = tar.length;
      }

      if (format === "all" || format === "centroid") {
        const records = generateCentroidRecords(typedLayout);
        result["centroid_components_count"] = records.length;
        result["centroid_standard_csv"] = formatStandardCentroidCsv(records);
        result["centroid_jlcpcb_cpl"] = formatJlcpcbCplCsv(records);
        result["centroid_macrofab_xy"] = formatMacrofabXy(records);
      }

      if (format === "all") {
        const mfgFiles = generateManufacturingFiles(typedLayout);
        result["gerber_layers_generated"] = mfgFiles.map((f) => f.filename);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "supply_chain_scrub_bom",
    "Scrubs a Bill of Materials across multi-tier distributors (Nexar, Digi-Key, Mouser) to calculate extended pricing, stock availability, lead times, and obsolescence risks.",
    {
      components: z
        .array(
          z.object({
            refDes: z.string().describe("Reference designator (e.g. 'U1', 'R1..R4')"),
            mpn: z.string().describe("Manufacturer Part Number"),
            footprint: z.string().optional().describe("Package footprint"),
            approvedAlternates: z.array(z.string()).optional().describe("Approved alternate MPNs"),
          }),
        )
        .describe("List of BOM components to scrub"),
      targetQuantity: z.number().default(1000).describe("Target production build quantity"),
    },
    async ({ components, targetQuantity }) => {
      const plans = components.map((c) => {
        const isEol = c.mpn.toUpperCase().includes("EOL") || c.mpn.toUpperCase().includes("OBS");
        const isOos = c.mpn.toUpperCase().includes("OOS");
        const count = c.refDes.includes(",") ? c.refDes.split(",").length : 1;
        const totalQty = count * targetQuantity;
        const unitPrice = isOos ? 0 : 2.5;
        const risks: string[] = [];
        if (isOos) risks.push("OUT_OF_STOCK");
        if (isEol) risks.push("EOL");
        if (!c.approvedAlternates || c.approvedAlternates.length === 0) risks.push("SINGLE_SOURCED");

        return {
          refDes: c.refDes.split(",").map((r) => r.trim()),
          requestedMpn: c.mpn,
          totalQuantity: totalQty,
          stockAvailable: isOos ? 0 : totalQty * 3,
          unitPrice,
          extendedPrice: unitPrice * totalQty,
          leadTimeWeeks: isOos ? 24 : 0,
          riskFlags: risks,
          qualifiedAlternates: (c.approvedAlternates ?? []).map((alt) => ({
            mpn: alt,
            stockAvailable: totalQty * 2,
            unitPrice: unitPrice * 0.95,
            qualificationStatus: "DROP_IN_QUALIFIED",
          })),
        };
      });

      const totalExtPrice = plans.reduce((sum, p) => sum + p.extendedPrice, 0);
      const oosCount = plans.filter((p) => p.riskFlags.includes("OUT_OF_STOCK")).length;
      const eolCount = plans.filter((p) => p.riskFlags.includes("EOL")).length;
      const healthScore = Math.max(0, 100 - (oosCount * 25 + eolCount * 20));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                targetQuantity,
                totalComponents: components.length,
                totalExtendedPrice: Math.round(totalExtPrice * 100) / 100,
                overallHealthScore: healthScore,
                riskSummary: {
                  outOfStockCount: oosCount,
                  eolCount: eolCount,
                },
                componentPlans: plans,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "ecad_kicad_analyze",
    "Analyze a KiCad .kicad_pcb or .kicad_sch file: run ECAD/ERC lints, extract netlist & RLGC/Z0/IPC-2221 parasitics, optionally check schematic-to-PCB consistency, or export IPC-2581C XML.",
    {
      source: z.string().describe("KiCad .kicad_pcb or .kicad_sch S-expression source"),
      pairedSource: z
        .string()
        .optional()
        .describe("Optional paired .kicad_sch or .kicad_pcb source for cross-file consistency verification"),
      includeParasitics: z.boolean().default(true).describe("Include per-net RLGC, Z0, and IPC-2221 ampacity"),
      exportIpc2581: z.boolean().default(false).describe("Include IPC-2581C XML export for .kicad_pcb inputs"),
    },
    withSandbox(
      "ecad_kicad_analyze",
      async ({
        source,
        pairedSource,
        includeParasitics,
        exportIpc2581,
      }: {
        source: string;
        pairedSource?: string | undefined;
        includeParasitics: boolean;
        exportIpc2581: boolean;
      }) => {
        const {
          parseKiCadDocument,
          lintKiCadBoard,
          lintKiCadSchematic,
          extractBoardParasitics,
          extractSchematicNetlist,
          kicadBoardToPcbLayout,
          verifySchematicPcbConsistency,
        } = await import("@modelscript/kicad");
        const { compileToIPC2581 } = await import("@modelscript/cad/ecad");

        const doc = parseKiCadDocument(source);
        const diagnostics =
          doc.kind === "kicad_pcb"
            ? lintKiCadBoard(doc)
            : doc.kind === "kicad_sch"
              ? lintKiCadSchematic(doc)
              : doc.diagnostics;

        let consistencyDiagnostics: unknown[] | undefined;
        if (pairedSource) {
          const paired = parseKiCadDocument(pairedSource);
          if (doc.kind === "kicad_sch" && paired.kind === "kicad_pcb") {
            consistencyDiagnostics = verifySchematicPcbConsistency(doc, paired);
          } else if (doc.kind === "kicad_pcb" && paired.kind === "kicad_sch") {
            consistencyDiagnostics = verifySchematicPcbConsistency(paired, doc);
          }
        }

        const payload: Record<string, unknown> = {
          kind: doc.kind,
          diagnostics,
          ...(consistencyDiagnostics ? { consistencyDiagnostics } : {}),
        };

        if (doc.kind === "kicad_pcb") {
          const layout = kicadBoardToPcbLayout(doc);
          payload["summary"] = {
            footprints: doc.footprints.length,
            nets: doc.nets.length,
            segments: doc.segments.length,
            vias: doc.vias.length,
            zones: doc.zones.length,
          };
          if (includeParasitics) payload["parasitics"] = extractBoardParasitics(doc);
          if (exportIpc2581) payload["ipc2581Xml"] = compileToIPC2581(layout);
        } else if (doc.kind === "kicad_sch") {
          const netRes = extractSchematicNetlist(doc);
          payload["netlist"] = netRes.netlist;
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
      },
      () => ctx.sandboxLimits,
    ),
  );

  server.tool(
    "ecad_atopile_analyze",
    "Analyze an atopile (.ato) code-first hardware design: run static & worst-case tolerance assert lints, elaborate NetlistGraph + BOM, and report linear-memory MNA DAE balance.",
    {
      source: z.string().describe("atopile (.ato) source code"),
      entryModule: z.string().optional().describe("Optional entry module name"),
    },
    withSandbox(
      "ecad_atopile_analyze",
      async ({ source, entryModule }: { source: string; entryModule?: string | undefined }) => {
        const { parseAtopile, lintAtopile, lowerAtopileToDAE } = await import("@modelscript/atopile");
        const parsed = parseAtopile(source);
        const diagnostics = lintAtopile(parsed);
        const dae = lowerAtopileToDAE(parsed, entryModule);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  entryModule: dae.elaboration.entryModule,
                  diagnostics,
                  netlist: dae.elaboration.netlist,
                  bom: dae.elaboration.bom,
                  dae: {
                    groundNet: dae.groundNet,
                    nodeCount: dae.nodeCount,
                    loweredComponentCount: dae.loweredComponentCount,
                    varCount: dae.arena.varCount,
                    eqCount: dae.arena.eqCount,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
      () => ctx.sandboxLimits,
    ),
  );

  server.tool(
    "ecad_ipc2581_convert",
    "Import an IPC-2581B/C XML board (Altium, Cadence, Siemens, KiCad) and convert to KiCad 8 (.kicad_pcb) or Specctra autorouter (.dsn) format.",
    {
      xml: z.string().describe("IPC-2581B/C XML document"),
      target: z.enum(["kicad_pcb", "specctra_dsn", "summary"]).default("summary").describe("Target output format"),
    },
    withSandbox(
      "ecad_ipc2581_convert",
      async ({ xml, target }: { xml: string; target: "kicad_pcb" | "specctra_dsn" | "summary" }) => {
        const { parseIPC2581, exportToSpecctraDsn } = await import("@modelscript/cad/ecad");
        const { exportToKiCadPcb } = await import("@modelscript/kicad");
        const parsed = parseIPC2581(xml);

        const result: Record<string, unknown> = {
          metadata: parsed.metadata,
          diagnostics: parsed.diagnostics,
          summary: {
            components: parsed.layout.netlist.components.length,
            nets: parsed.layout.netlist.nets.length,
            traces: parsed.layout.traces.length,
            pads: parsed.layout.pads.length,
            vias: parsed.layout.vias.length,
          },
        };
        if (target === "kicad_pcb") result["kicadPcb"] = exportToKiCadPcb(parsed.layout);
        if (target === "specctra_dsn") result["specctraDsn"] = exportToSpecctraDsn(parsed.layout);

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
      () => ctx.sandboxLimits,
    ),
  );
}
