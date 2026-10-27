// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramData } from "@modelscript/diagram";
import { renderDiagramDataToSvg } from "@modelscript/diagram/svg";
import { Context } from "@modelscript/modelica/context";
import { renderDiagram, renderIcon } from "@modelscript/modelica/diagram";
import { createWasmParser } from "@modelscript/modelica/parser";
import { registerWindow } from "@svgdotjs/svg.js";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSVGWindow } from "svgdom";
import xmlFormat from "xml-formatter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface RenderArgs {
  name: string;
  paths: string[] | undefined;
  icon: boolean;
  view: string | undefined;
  theme: "dark" | "light" | "blueprint";
  output: string | undefined;
}

export const Render: CommandModule<{}, RenderArgs> = {
  command: "render <name> [paths..]",
  describe: "Render 2D diagram or icon to SVG across Modelica, SysML v2, PSCAD, OWL 2, and SSP",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "class/module name to render, or file path when paths are omitted",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("icon", {
        alias: "i",
        description: "render icon (Modelica)",
        type: "boolean",
        default: false,
      })
      .option("view", {
        alias: "v",
        description: "diagram view/projection (e.g. All, BDD, IBD, StateMachine, Activity, SLD, Taxonomy, Properties)",
        type: "string",
      })
      .option("theme", {
        alias: "t",
        description: "color theme for polyglot SVG export (dark, light, blueprint)",
        choices: ["dark", "light", "blueprint"] as const,
        default: "light" as const,
      })
      .option("output", {
        alias: "o",
        description: "output SVG file path (defaults to stdout)",
        type: "string",
      });
  },
  handler: async (args) => {
    const rawPaths = args.paths && args.paths.length > 0 ? args.paths : [];
    const nameIsFile = rawPaths.length === 0 && fs.existsSync(args.name);
    const filePaths = nameIsFile ? [args.name] : rawPaths;
    const svgOpts = args.theme ? { theme: args.theme } : {};

    const emitSvg = (rawSvg: string) => {
      let formatted = rawSvg;
      try {
        formatted = (xmlFormat as any)(rawSvg);
      } catch {
        // fallback to unformatted if xmlFormat fails
      }
      if (args.output) {
        fs.writeFileSync(path.resolve(args.output), formatted, "utf-8");
      } else {
        console.log(formatted);
      }
    };

    const primaryFile = filePaths[0] ? path.resolve(filePaths[0]) : undefined;
    const ext = primaryFile ? path.extname(primaryFile).toLowerCase() : ".mo";

    // 1. PSCAD (.pscx / .pslx)
    if (primaryFile && (ext === ".pscx" || ext === ".pslx" || ext === ".pswx" || ext === ".psmx")) {
      const { parsePscx } = await import("@modelscript/pscad");
      const { renderPscadSvg } = await import("@modelscript/diagram/pscad-diagram-builder");
      const xml = fs.readFileSync(primaryFile, "utf-8");
      const project = parsePscx(xml);
      const svgStr = renderPscadSvg(project);
      emitSvg(svgStr);
      return;
    }

    // 2. SSP (.ssd / .ssp)
    if (primaryFile && (ext === ".ssd" || ext === ".ssp")) {
      const { buildSspDiagramData } = await import("@modelscript/ssp/diagram");
      let ssdXml: string | null = null;
      if (ext === ".ssp") {
        const { defaultContainerToolkit } = await import("@modelscript/runtime");
        const bytes = new Uint8Array(fs.readFileSync(primaryFile));
        ssdXml = defaultContainerToolkit.zip.readText(bytes, "SystemStructure.ssd") ?? null;
      } else {
        ssdXml = fs.readFileSync(primaryFile, "utf-8");
      }
      if (!ssdXml) {
        console.error(`Failed to read SystemStructure.ssd from '${primaryFile}'`);
        return;
      }
      const data = buildSspDiagramData(ssdXml);
      emitSvg(renderDiagramDataToSvg(data as unknown as DiagramData, svgOpts));
      return;
    }

    // 3. OWL 2 (.owl / .ofn / .owx / .ttl)
    if (primaryFile && (ext === ".owl" || ext === ".ofn" || ext === ".owx" || ext === ".ttl")) {
      const { createWasmParser: createDslParser } = await import("@modelscript/dsl/bindings");
      const { FIELD_NAMES, SYNTAX_NAMES } = await import("@modelscript/owl2/parser");
      const { buildOWL2DiagramData, lowerCstToAxioms } = await import("@modelscript/owl2");
      const { TableauReasoner } = await import("@modelscript/runtime");
      const owl2WasmPath = require.resolve("@modelscript/owl2/parser.wasm");
      const { parser } = await createDslParser(owl2WasmPath, { SYNTAX_NAMES, FIELD_NAMES } as any);
      const text = fs.readFileSync(primaryFile, "utf-8");
      const tree = parser.parse(text);
      const axioms = tree ? lowerCstToAxioms(tree.rootNode as any, text) : [];
      const inferredSubClassOf: { subClassIri: string; superClassIri: string }[] = [];
      try {
        const reasoner = new TableauReasoner();
        reasoner.loadOntology(axioms);
        reasoner.classify();
        const taxonomy = reasoner.getTaxonomy();
        for (const node of taxonomy) {
          for (const sup of node.directSuperClasses) {
            if (sup !== "owl:Thing" && sup !== node.iri) {
              inferredSubClassOf.push({ subClassIri: node.iri, superClassIri: sup });
            }
          }
        }
      } catch {
        // ignore reasoner errors during CLI rendering
      }
      const data = (buildOWL2DiagramData as any)(axioms, undefined, args.view || "All", { inferredSubClassOf });
      emitSvg(renderDiagramDataToSvg(data, svgOpts));
      return;
    }

    // 4. SysML v2 (.sysml / .sysml2)
    if (primaryFile && (ext === ".sysml" || ext === ".sysml2")) {
      const { createWasmParser: createDslParser } = await import("@modelscript/dsl/bindings");
      const { FIELD_NAMES, SYNTAX_NAMES } = await import("@modelscript/sysml2/parser");
      const { buildSysML2DiagramData, createSysML2WorkspaceIndex } = await import("@modelscript/sysml2/factory");
      const sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
      const { parser } = await createDslParser(sysmlWasmPath, { SYNTAX_NAMES, FIELD_NAMES } as any);
      const wsIndex = createSysML2WorkspaceIndex();
      let targetUri = "";
      for (const fp of filePaths) {
        const abs = path.resolve(fp);
        const uri = pathToFileURL(abs).toString();
        if (!targetUri) targetUri = uri;
        const text = fs.readFileSync(abs, "utf-8");
        wsIndex.register(uri, () => {
          const tree = parser.parse(text);
          return tree ? (tree.rootNode as any) : null;
        });
      }
      const unified = wsIndex.toUnified();
      const data = buildSysML2DiagramData(unified, targetUri, undefined, args.view || "All");
      emitSvg(renderDiagramDataToSvg(data as any, svgOpts));
      return;
    }

    // 5. Modelica (.mo) — Default
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    for (const p of filePaths) await context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }
    if (instance.isClassInstance === false || (instance.kind && instance.kind === "Component")) {
      console.error(`'${args.name}' is not a class`);
      return;
    }

    const window = createSVGWindow();
    registerWindow(window, window.document);
    const svg = args.icon ? renderIcon(instance) : renderDiagram(instance);
    if (svg) {
      emitSvg(svg.svg());
    }
  },
};
