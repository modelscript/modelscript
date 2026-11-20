// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  getHostDocumentText,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramBackendHost,
  type DiagramData,
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramPalette,
  type PropertyFieldConfig,
  type PropertyGroupConfig,
  type PropertyTabConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";

function getUnifiedIndexFromDeps(backends: DiagramBackendHost): any {
  return (
    backends.getUnifiedIndex?.() ??
    backends.generic?.deps?.getUnifiedIndex?.() ??
    backends.modelica?.deps?.getUnifiedIndex?.()
  );
}

export function createPscadDiagramBackend(backends: DiagramBackendHost): DiagramBackend {
  const createDropBatchState = () => backends.crossLanguageDrop?.createDropBatchState?.() ?? {};
  const mergeCoincidentInsertEdits = (edits: TextEdit[]) =>
    backends.crossLanguageDrop?.mergeCoincidentInsertEdits?.(edits) ?? edits;
  const computePscadComponentDropEdits = (opts: any): TextEdit[] =>
    backends.crossLanguageDrop?.computePscadComponentDropEdits?.(opts) ?? [];

  const readPscxSource = async (targetUri: string): Promise<string | null> => {
    const memText = getHostDocumentText(backends, targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs errors
    }
    return null;
  };

  const formatDiagramData = (rawDiagram: any): DiagramData => {
    const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
    const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
    return {
      nodes,
      edges,
      coordinateSystem: null,
      diagramBackground: null,
      cells: rawDiagram.cells,
      metadata: rawDiagram.metadata,
    } as any;
  };

  return {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx } = await import("@modelscript/pscad");
        const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
        const project = parsePscx(text);
        const rawDiagram = buildPscadDiagram(project, params.className);
        return formatDiagramData(rawDiagram);
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx, getMasterComponentSchema, getUserDefinitionForm } = await import("@modelscript/pscad");
        const project = parsePscx(text);
        const mod =
          params.className && project.subModules.has(params.className)
            ? project.subModules.get(params.className)!
            : project.rootModule;

        const rawName = params.componentName;
        const strippedCmpId = rawName.startsWith("cmp_") ? rawName.slice(4) : rawName;
        const strippedBusId = rawName.startsWith("bus_") ? rawName.slice(4) : rawName;

        const allMods = [project.rootModule, ...Array.from(project.subModules.values())];
        const cmp =
          mod.components.find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName) ??
          allMods
            .flatMap((m) => m.components)
            .find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName);

        if (cmp) {
          const masterSchema = getMasterComponentSchema(cmp.definitionName);
          const userForm = getUserDefinitionForm(text, cmp.definitionName);
          const userFormParams = new Map<string, { defaultValue?: string; cond?: string; vis?: string }>();
          if (userForm) {
            for (const cat of userForm.categories) {
              for (const fp of cat.parameters) {
                userFormParams.set(fp.name, fp);
              }
            }
          }
          const mergedValues: Record<string, any> = {};
          if (masterSchema) {
            for (const p of masterSchema.parameters) {
              mergedValues[p.key] = p.defaultValue;
            }
          }
          for (const [k, fp] of userFormParams.entries()) {
            if (!(k in mergedValues) && fp.defaultValue !== undefined) {
              mergedValues[k] = fp.defaultValue;
            }
          }
          for (const [k, v] of Object.entries(cmp.parameters)) {
            mergedValues[k] = v;
          }

          const parameters: ComponentPropertyData["parameters"] = [];
          const tabs: PropertyTabConfig[] = [];

          if (masterSchema) {
            const seenKeys = new Set<string>();
            const tabMap = new Map<string, Map<string, PropertyFieldConfig[]>>();

            for (const p of masterSchema.parameters) {
              seenKeys.add(p.key);
              const currentVal = mergedValues[p.key] ?? p.defaultValue;
              const fp = userFormParams.get(p.key);
              parameters.push({
                name: p.key,
                localizedName: p.label,
                value: String(currentVal),
                defaultValue: String(p.defaultValue),
                description: p.description,
                unit: p.unit,
                tab: p.tab,
                group: p.group || "Configuration",
              });

              const tabName = p.tab || "General";
              const groupName = p.group || "Configuration";
              if (!tabMap.has(tabName)) tabMap.set(tabName, new Map());
              const groupMap = tabMap.get(tabName)!;
              if (!groupMap.has(groupName)) groupMap.set(groupName, []);

              const field: PropertyFieldConfig = {
                key: p.key,
                label: p.label,
                kind: p.kind === "select" ? "choice" : p.kind,
                description: p.description,
                defaultValue: p.defaultValue,
                unit: p.unit,
                choices: p.options?.map((o) => ({ label: o.label, value: o.value })),
                validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
                ...(fp?.cond ? { enabledIf: fp.cond } : {}),
                ...(fp?.vis ? { visibleIf: fp.vis } : {}),
              };
              groupMap.get(groupName)!.push(field);
            }

            // Include any additional instance-specific parameters not in the catalog schema
            for (const [k, v] of Object.entries(cmp.parameters)) {
              if (seenKeys.has(k)) continue;
              parameters.push({
                name: k,
                value: String(v),
                description: `PSCAD parameter '${k}'`,
                tab: "General",
                group: "Instance Parameters",
              });
              if (!tabMap.has("General")) tabMap.set("General", new Map());
              const gMap = tabMap.get("General")!;
              if (!gMap.has("Instance Parameters")) gMap.set("Instance Parameters", []);
              gMap.get("Instance Parameters")!.push({
                key: k,
                label: k,
                kind: typeof v === "number" ? "number" : "string",
                defaultValue: v,
              });
            }

            for (const [tabLabel, groupMap] of tabMap.entries()) {
              const groups: PropertyGroupConfig[] = [];
              for (const [groupLabel, fields] of groupMap.entries()) {
                groups.push({
                  id: groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  label: groupLabel,
                  fields,
                });
              }
              tabs.push({
                id: tabLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                label: tabLabel,
                groups,
              });
            }
          } else if (getUserDefinitionForm(text, cmp.definitionName)) {
            const form = getUserDefinitionForm(text, cmp.definitionName)!;
            const seenKeys = new Set<string>();
            for (const cat of form.categories) {
              if (!cat.visible) continue;
              const fields: PropertyFieldConfig[] = [];
              for (const p of cat.parameters) {
                seenKeys.add(p.name);
                const current = cmp.parameters[p.name];
                const value = current !== undefined ? String(current) : p.defaultValue;
                const numeric =
                  (p.type === "Real" || p.type === "Integer") && value.trim() !== "" && !isNaN(Number(value));
                parameters.push({
                  name: p.name,
                  localizedName: p.label,
                  value,
                  defaultValue: p.defaultValue,
                  description: p.help || p.label,
                  unit: p.unit || undefined,
                  tab: cat.name,
                  group: cat.name,
                });
                fields.push({
                  key: p.name,
                  label: p.label,
                  kind: numeric ? "number" : "string",
                  description: p.help || undefined,
                  defaultValue: numeric ? Number(p.defaultValue) : p.defaultValue,
                  unit: p.unit || undefined,
                  validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
                  enabledIf: p.cond || undefined,
                  visibleIf: p.vis || undefined,
                });
              }
              if (fields.length > 0) {
                tabs.push({
                  id: cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  label: cat.name,
                  groups: [{ id: "parameters", label: cat.name, fields }],
                });
              }
            }
            // Instance parameters the definition's form does not declare (e.g. Name, hidden defaults).
            const extra = Object.entries(cmp.parameters).filter(([k]) => !seenKeys.has(k));
            if (extra.length > 0) {
              tabs.push({
                id: "instance",
                label: "Instance",
                groups: [
                  {
                    id: "instance_parameters",
                    label: "Instance Parameters",
                    fields: extra.map(([k, v]) => {
                      parameters.push({ name: k, value: String(v), description: `PSCAD parameter '${k}'` });
                      return {
                        key: k,
                        label: k,
                        kind: typeof v === "number" ? ("number" as const) : ("string" as const),
                        defaultValue: v,
                      };
                    }),
                  },
                ],
              });
            }
          } else {
            const fields: PropertyFieldConfig[] = Object.entries(cmp.parameters).map(([k, v]) => {
              parameters.push({
                name: k,
                value: String(v),
                description: `PSCAD parameter '${k}'`,
              });
              return {
                key: k,
                label: k,
                kind: typeof v === "number" ? "number" : "string",
                defaultValue: v,
              };
            });
            tabs.push({
              id: "general",
              label: "General",
              groups: [{ id: "configuration", label: "Configuration", fields }],
            });
          }

          return {
            classKind: "component",
            className: cmp.definitionName,
            localizedClassName: masterSchema?.label,
            name: cmp.instanceName || cmp.id,
            description: masterSchema?.description || `PSCAD ${cmp.definitionName} (${cmp.id})`,
            parameters,
            schema: {
              title: masterSchema?.label || cmp.instanceName || cmp.definitionName,
              tabs,
            },
            values: mergedValues,
          };
        }

        const bus =
          mod.buses.find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName) ??
          allMods.flatMap((m) => m.buses).find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName);
        if (bus) {
          return {
            classKind: "bus",
            className: "Bus",
            name: bus.name,
            description: `PSCAD Electrical Bus (${bus.phaseCount}-phase)`,
            parameters: [
              { name: "Name", value: bus.name, description: "Bus identifier" },
              {
                name: "BaseKV",
                value: String(bus.voltageBaseKv ?? 230.0),
                unit: "kV",
                description: "Base line-to-line RMS voltage",
              },
            ],
            schema: {
              title: `3-Phase Electrical Bus (${bus.name})`,
              tabs: [
                {
                  id: "general",
                  label: "General",
                  groups: [
                    {
                      id: "ratings",
                      label: "Bus Ratings",
                      fields: [
                        { key: "Name", label: "Bus Name", kind: "string", defaultValue: bus.name },
                        {
                          key: "BaseKV",
                          label: "Base Voltage (L-L RMS)",
                          kind: "number",
                          unit: "kV",
                          defaultValue: bus.voltageBaseKv ?? 230.0,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            values: {
              Name: bus.name,
              BaseKV: bus.voltageBaseKv ?? 230.0,
            },
          };
        }
      } catch {
        return null;
      }
      return null;
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
        const { getMasterComponentSchema, planDiagramActions } = await import("@modelscript/pscad");
        const unifiedIndex = getUnifiedIndexFromDeps(backends);
        const dropBatchState = createDropBatchState();
        const foreignEdits: TextEdit[] = [];
        const nativeActions: DiagramApplyEditsParams["actions"] = [];

        const activeSection = (params as { className?: string }).className;
        for (const rawAction of params.actions) {
          const action =
            activeSection && !(rawAction as { section?: string }).section
              ? { ...rawAction, section: activeSection }
              : rawAction;
          if (action.type === "addComponent") {
            const dropEdits = computePscadComponentDropEdits({
              docText: text,
              rawClassName: action.className,
              x: action.x,
              y: action.y,
              instanceName: action.name,
              section: action.section,
              hasNativeSchema: Boolean(getMasterComponentSchema(action.className)),
              schematicEndLine: 0,
              unifiedIndex,
              batchState: dropBatchState,
            });
            if (dropEdits !== null) {
              foreignEdits.push(...dropEdits);
              continue;
            }
          }
          nativeActions.push(action);
        }

        const nativeResult =
          nativeActions.length > 0
            ? planDiagramActions(text, nativeActions as never)
            : { edits: [], renderHint: "none" as const, unresolved: [] };

        const renderHint: "none" | "immediate" | "debounced" =
          foreignEdits.length > 0 || nativeResult.renderHint === "immediate" ? "immediate" : nativeResult.renderHint;
        const allEdits: TextEdit[] = [...(nativeResult.edits as TextEdit[]), ...foreignEdits];

        return {
          seq: params.seq,
          edits: deduplicateAndSort(mergeCoincidentInsertEdits(allEdits)),
          renderHint,
        };
      } catch {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx } = await import("@modelscript/pscad");
        const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
        const project = parsePscx(text);

        const candidateId = params.componentId || params.nodeId || params.componentName || "";
        const strippedId = candidateId.startsWith("cmp_") ? candidateId.slice(4) : candidateId;

        const allComponents = [
          ...project.rootModule.components,
          ...Array.from(project.subModules.values()).flatMap((m) => m.components),
        ];

        let targetModuleName = "";
        if (candidateId) {
          const cmp = allComponents.find(
            (c) => c.id === strippedId || c.id === candidateId || c.instanceName === candidateId,
          );
          if (cmp) {
            const cleanDef = cmp.definitionName.split(":").pop() || cmp.definitionName;
            if (project.subModules.has(cleanDef)) {
              targetModuleName = cleanDef;
            } else if (cmp.instanceName && project.subModules.has(cmp.instanceName)) {
              targetModuleName = cmp.instanceName;
            }
          } else if (project.subModules.has(strippedId)) {
            targetModuleName = strippedId;
          }
        }
        if (!targetModuleName && params.className && project.subModules.has(params.className)) {
          targetModuleName = params.className;
        }

        if (!targetModuleName || !project.subModules.has(targetModuleName)) {
          return null;
        }

        const rawDiagram = buildPscadDiagram(project, targetModuleName);
        return {
          data: formatDiagramData(rawDiagram),
          breadcrumbs: [
            { id: "Main", label: project.rootModule.name || "Main", uri: params.uri },
            { id: targetModuleName, label: targetModuleName, uri: params.uri },
          ],
          targetUri: params.uri,
          targetClassName: targetModuleName,
        };
      } catch {
        return null;
      }
    },

    async getPalette(): Promise<DiagramPalette> {
      const { getPscadPaletteCategories } = await import("@modelscript/pscad");
      return {
        categories: getPscadPaletteCategories(),
      };
    },
  };
}
