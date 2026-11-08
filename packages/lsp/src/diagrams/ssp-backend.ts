// SPDX-License-Identifier: AGPL-3.0-or-later

import { deduplicateAndSort, type DiagramBackend, type DiagramDispatchDeps } from "../diagramApi.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramPalette,
  PropertyFieldConfig,
} from "../diagramProtocol.js";

export function createSspDiagramBackend(backends: DiagramDispatchDeps): DiagramBackend {
  const readSsdSource = async (targetUri: string): Promise<string | null> => {
    const memText =
      (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
      (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        if (filePath.endsWith(".ssp")) {
          const { defaultContainerToolkit } = await import("@modelscript/runtime");
          const bytes = new Uint8Array(fs.readFileSync(filePath));
          return defaultContainerToolkit.zip.readText(bytes, "SystemStructure.ssd") ?? null;
        }
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs errors
    }
    return null;
  };

  return {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      try {
        const text = await readSsdSource(params.uri);
        if (!text) return null;
        const { buildSspDiagramData } = await import("@modelscript/ssp/diagram");
        return buildSspDiagramData(text) as unknown as DiagramData;
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const text = await readSsdSource(params.uri);
        if (!text) return null;
        const { parseSsd } = await import("@modelscript/ssp");
        const system = parseSsd(text);
        const cmp = system.components.find((c) => c.name === params.componentName);
        if (cmp) {
          const parameters: ComponentPropertyData["parameters"] = [
            { name: "source", value: cmp.source, description: "FMU archive path", group: "FMU Resource" },
            ...(cmp.type ? [{ name: "type", value: cmp.type, description: "MIME type", group: "FMU Resource" }] : []),
          ];
          const fields: PropertyFieldConfig[] = [
            { key: "source", label: "FMU Source", kind: "string", defaultValue: cmp.source },
            {
              key: "type",
              label: "Component Type",
              kind: "string",
              defaultValue: cmp.type ?? "application/x-fmu-sharedlibrary",
            },
          ];
          const values: Record<string, any> = {
            source: cmp.source,
            type: cmp.type ?? "application/x-fmu-sharedlibrary",
          };

          for (const b of system.parameterBindings || []) {
            if (!b.prefix || b.prefix === cmp.name) {
              for (const pv of b.values) {
                const shortKey = pv.name.startsWith(`${cmp.name}.`) ? pv.name.slice(cmp.name.length + 1) : pv.name;
                parameters.push({
                  name: shortKey,
                  value: String(pv.value),
                  description: `SSP bound parameter (${pv.type})`,
                  group: "Parameters",
                });
                fields.push({
                  key: shortKey,
                  label: shortKey,
                  kind:
                    pv.type === "Real" || pv.type === "Integer"
                      ? "number"
                      : pv.type === "Boolean"
                        ? "boolean"
                        : "string",
                  defaultValue: pv.value,
                });
                values[shortKey] = pv.value;
              }
            }
          }

          return {
            classKind: "component",
            className: cmp.type || "FMUComponent",
            name: cmp.name,
            description: cmp.source,
            parameters,
            schema: {
              title: `SSP Component (${cmp.name})`,
              tabs: [
                {
                  id: "general",
                  label: "General",
                  groups: [{ id: "fmu", label: "Configuration", fields }],
                },
              ],
            },
            values,
          };
        }
      } catch {
        return null;
      }
      return null;
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      try {
        const text = await readSsdSource(params.uri);
        if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
        const { applySspDiagramEdits } = await import("@modelscript/ssp/diagram");
        const rawEdits = applySspDiagramEdits(
          text,
          params.actions as unknown as Parameters<typeof applySspDiagramEdits>[1],
        );
        const hasStructural = params.actions.some(
          (a) =>
            a.type === "connect" ||
            a.type === "disconnect" ||
            a.type === "addComponent" ||
            a.type === "deleteComponents" ||
            a.type === "updateName",
        );
        return {
          seq: params.seq,
          edits: deduplicateAndSort(rawEdits),
          renderHint: hasStructural ? "immediate" : "none",
        };
      } catch {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }
    },

    async getPalette(): Promise<DiagramPalette> {
      const { getSspPaletteCategories } = await import("@modelscript/ssp/diagram");
      return {
        categories: getSspPaletteCategories(),
      };
    },
  };
}
