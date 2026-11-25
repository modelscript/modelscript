// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PreprocessContext, PreprocessResult } from "./types.js";

/**
 * Handles electrical power grid, RF, and electronics artifacts:
 * `pscad`, `psse`, `spice`, `verilog-a`, `touchstone`, `ibis`, `opendss`.
 */
export async function tryPreprocessPowerOrElectronics(ctx: PreprocessContext): Promise<PreprocessResult | null> {
  const { viewType, content, baseTitle, inlineCode } = ctx;

  switch (viewType) {
    case "pscad": {
      const { parsePscx, extractEmtNetlist } = await import("@modelscript/pscad");
      const { renderPscadSvg } = await import("@modelscript/diagram/pscad-diagram-builder");

      const project = parsePscx(content);
      const svg = renderPscadSvg(project);
      const netlist = extractEmtNetlist(project);

      const firstDef = project.definitions ? Array.from(project.definitions.values())[0] : undefined;

      return {
        svg,
        metadata: {
          projectTitle: project.name || baseTitle,
          definitionName: firstDef?.name,
          busCount: netlist.buses.size,
          componentCount:
            (netlist.branches?.length || 0) + (netlist.transformers?.length || 0) + (netlist.sources?.length || 0),
          transformerCount: netlist.transformers?.length || 0,
          branchCount: netlist.branches?.length || 0,
        },
        viewConfigAdditions: {
          code: inlineCode,
          netlist,
          title: project.name || baseTitle,
          projectTitle: project.name || baseTitle,
          definitionName: firstDef?.name,
        },
      };
    }

    case "psse": {
      const { parseRaw, extractPowerFlowNetlist, solvePowerFlow } = await import("@modelscript/psse");
      const { renderPsseSvg } = await import("@modelscript/diagram/psse-diagram-builder");

      const parsed = parseRaw(content);
      const pf = solvePowerFlow(parsed);
      const svg = renderPsseSvg(parsed, pf);
      const netlist = extractPowerFlowNetlist(parsed);

      const lossesMw = pf.converged
        ? pf.totalLossMw
        : Math.max(0, netlist.metrics.totalGenMw - netlist.metrics.totalLoadMw);
      const busList = Array.from(parsed.buses.values());

      return {
        svg,
        metadata: {
          busCount: parsed.buses.size,
          generatorCount: parsed.generators.length,
          branchCount: parsed.branches.length,
          transformerCount: parsed.transformers.length,
          totalGenMw: netlist.metrics.totalGenMw,
          totalLoadMw: netlist.metrics.totalLoadMw,
          lossesMw,
        },
        viewConfigAdditions: {
          code: inlineCode,
          metrics: {
            ...netlist.metrics,
            lossesMw,
          },
          buses: busList.slice(0, 50).map((b) => ({
            id: b.i,
            name: b.name,
            baseKv: b.baseKv,
            vm: b.vm,
            va: b.va,
          })),
          title: baseTitle,
        },
      };
    }

    case "spice": {
      const { parseSpice } = await import("@modelscript/spice");
      const { renderSpiceSvg } = await import("@modelscript/diagram/spice-diagram-builder");
      const deck = parseSpice(content) as unknown as {
        title?: string | undefined;
        elements?: unknown[] | { size?: number | undefined } | undefined;
        components?: unknown[] | { size?: number | undefined } | undefined;
        subcircuits?: unknown[] | Map<string, unknown> | undefined;
        models?: { size?: number | undefined } | undefined;
      };
      const elements = deck.elements || deck.components || [];
      const componentsArr = Array.isArray(elements) ? elements : [];
      const subcircuits = deck.subcircuits
        ? Array.isArray(deck.subcircuits)
          ? deck.subcircuits
          : Array.from(deck.subcircuits.values())
        : [];
      const svg = renderSpiceSvg({
        title: deck.title || baseTitle,
        components: componentsArr,
        elements: componentsArr,
        subcircuits,
      } as unknown as Parameters<typeof renderSpiceSvg>[0]);
      const elemCount = Array.isArray(elements) ? elements.length : elements.size || 0;
      const subcktCount = Array.isArray(subcircuits) ? subcircuits.length : 0;
      const modelCount = deck.models ? (typeof deck.models.size === "number" ? deck.models.size : 0) : 0;
      return {
        svg,
        metadata: {
          elementCount: elemCount,
          subcircuitCount: subcktCount,
          modelCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: deck.title || baseTitle,
          elementCount: elemCount,
          subcircuitCount: subcktCount,
        },
      };
    }

    case "verilog-a": {
      const { parseVerilogA } = await import("@modelscript/verilog-a");
      const { buildVerilogADiagram, renderVerilogASvg } =
        await import("@modelscript/diagram/verilog-a-diagram-builder");
      const doc = parseVerilogA(content);
      const diag = buildVerilogADiagram(doc as unknown as Parameters<typeof buildVerilogADiagram>[0]);
      const svg = renderVerilogASvg(doc as unknown as Parameters<typeof renderVerilogASvg>[0]);
      return {
        svg,
        metadata: {
          dialect: "verilog-a",
          portCount: diag.metadata.portCount,
          branchCount: diag.metadata.branchCount,
          parameterCount: diag.metadata.parameterCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "verilog-a",
          portCount: diag.metadata.portCount,
          branchCount: diag.metadata.branchCount,
          parameterCount: diag.metadata.parameterCount,
        },
      };
    }

    case "touchstone": {
      const { parseTouchstone, verifyPassivity } = await import("@modelscript/touchstone");
      const { renderTouchstoneSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
      const net = parseTouchstone(content) as unknown as Parameters<typeof verifyPassivity>[0] & {
        numPorts: number;
        options: { referenceResistance: number };
        frequencies?: unknown[] | undefined;
        dataPoints?: unknown[] | undefined;
      };
      const passivity = verifyPassivity(net);
      const svg = renderTouchstoneSvg({
        portCount: net.numPorts,
        referenceImpedance: net.options.referenceResistance,
        isPassive: passivity.isPassive,
      });
      return {
        svg,
        metadata: { portCount: net.numPorts, isPassive: passivity.isPassive },
        viewConfigAdditions: {
          code: inlineCode,
          title: baseTitle,
          portCount: net.numPorts,
          isPassive: passivity.isPassive,
          frequencyCount: net.frequencies?.length || net.dataPoints?.length || 0,
        },
      };
    }

    case "ibis": {
      const { parseIbis } = await import("@modelscript/ibis");
      const { renderIbisBufferSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
      const model = parseIbis(content);
      const comps = Array.from(model.components.values());
      const firstComp = comps[0];
      const svg = renderIbisBufferSvg({
        componentName: firstComp?.name || baseTitle,
        pins: firstComp
          ? Array.from(firstComp.pins.values()).map((p) => {
              const rawP = p as unknown as { pin: string; signal: string; model: string };
              return {
                pin: rawP.pin,
                signal: rawP.signal,
                model: rawP.model,
              };
            })
          : [],
      });
      return {
        svg,
        metadata: { componentCount: model.components.size, modelCount: model.models.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: firstComp?.name || baseTitle,
          componentCount: model.components.size,
          modelCount: model.models.size,
        },
      };
    }

    case "opendss": {
      const { parseOpenDss } = await import("@modelscript/opendss");
      const { renderOpenDssSvg } = await import("@modelscript/diagram/opendss-diagram-builder");
      const deck = parseOpenDss(content);
      const svg = renderOpenDssSvg(deck as unknown as Parameters<typeof renderOpenDssSvg>[0]);
      return {
        svg,
        metadata: {
          lineCount: deck.lines.size,
          loadCount: deck.loads.size,
          transformerCount: deck.transformers.size,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: deck.circuit ? `Circuit.${deck.circuit.name}` : baseTitle,
          lineCount: deck.lines.size,
          loadCount: deck.loads.size,
          transformerCount: deck.transformers.size,
        },
      };
    }

    default:
      return null;
  }
}
