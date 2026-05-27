/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, prefer-const, @typescript-eslint/prefer-for-of */
// @ts-nocheck
import { LspContext } from "../LspContext";

export function registerClassQueryEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/getExperiments",
    (): {
      experiments: {
        name: string;
        uri: string;
        type: "simulation" | "calibration";
        startTime?: number;
        stopTime?: number;
        interval?: number;
        tolerance?: number;
      }[];
    } => {
      const experiments: {
        name: string;
        uri: string;
        type: "simulation" | "calibration";
        startTime?: number;
        stopTime?: number;
        interval?: number;
        tolerance?: number;
      }[] = [];

      for (const [uri, instances] of context.workspaceManager.documentInstances) {
        for (const instance of instances) {
          if (!instance.instantiated) {
            try {
              instance.instantiate();
            } catch {
              continue;
            }
          }

          const isSimulatable =
            instance.classKind === ModelicaClassKind.MODEL ||
            instance.classKind === ModelicaClassKind.BLOCK ||
            instance.classKind === ModelicaClassKind.CLASS;
          if (!isSimulatable) continue;

          // Check for experiment annotation
          try {
            const docContext = context.workspaceManager.documentContexts.get(uri);
            if (!context) continue;

            const arena = flattenArenaFromInstance(instance, docContext);
            const exp = arena.experiment;
            // Only consider classes with actual experiment data (not the default empty {})
            if (
              exp &&
              (exp.startTime !== undefined ||
                exp.stopTime !== undefined ||
                exp.tolerance !== undefined ||
                exp.interval !== undefined)
            ) {
              // Detect calibration type by checking for __ModelScript_CalibrationResult
              // in the experiment annotation (this is what Phase 6 generates)
              const expAny = exp as Record<string, unknown>;
              const hasCalibration =
                "__ModelScript_CalibrationResult" in expAny || "__modelscript_calibration" in expAny;
              experiments.push({
                name: instance.compositeName || instance.name || "Unknown",
                uri,
                type: hasCalibration ? "calibration" : "simulation",
                startTime: exp.startTime,
                stopTime: exp.stopTime,
                interval: exp.interval,
                tolerance: exp.tolerance,
              });
            }
          } catch {
            // ignore errors during experiment discovery
          }
        }
      }

      return { experiments };
    },
  );

  context.connection.onRequest(
    "modelscript/searchClasses",
    (params: { query: string; limit?: number }): { results: TreeNodeInfo[] } => {
      const query = (params.query ?? "").toLowerCase();
      if (!query) return { results: [] };

      const limit = params.limit ?? 50;
      const unifiedIndex = context.workspaceManager.unifiedWorkspace.toTreeIndex();
      if (!unifiedIndex) return { results: [] };

      const results: TreeNodeInfo[] = [];

      for (const [id, entry] of unifiedIndex.symbols) {
        if (!isTreeVisible(entry)) continue;
        const compositeName = getCompositeName(entry, unifiedIndex);
        if (compositeName.toLowerCase().includes(query)) {
          results.push({
            id: compositeName,
            name: entry.name,
            compositeName,
            classKind: classKindFromEntry(entry),
            hasChildren: hasClassChildren(unifiedIndex, id),
            language: entry.language,
          });
          if (results.length >= limit) break;
        }
      }

      results.sort((a, b) => a.compositeName.localeCompare(b.compositeName));
      return { results };
    },
  );

  context.connection.onRequest(
    "modelscript/getClassSource",
    (params: { className: string }): { content: string | null; error?: string } => {
      try {
        const unifiedIndex = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        const parts = params.className.split(".");
        let entries = unifiedIndex.byName.get(parts[parts.length - 1]);
        let entry = undefined;

        if (entries) {
          for (const id of entries) {
            const e = unifiedIndex.symbols.get(id);
            if (e && getCompositeName(e, unifiedIndex) === params.className) {
              entry = e;
              break;
            }
          }
        }

        let uri = entry?.resourceId;
        if (!uri) {
          // Fallback: try to resolve file path via index
          uri =
            (context.workspaceManager.globalWorkspaceIndex as any).getFileUriForFQN?.(params.className) ||
            (context.workspaceManager.sysml2WorkspaceIndex as any).getFileUriForFQN?.(params.className);
        }

        if (uri && context.state.sharedContext) {
          let fsPath = uri.startsWith("file://") ? uri.substring(7) : uri.replace(/^modelica:\/?\/?/, "/");
          if (!fsPath.startsWith("/")) fsPath = "/" + fsPath;
          const text = context.state.sharedContext.fs.read(fsPath);
          return { content: text || null };
        }

        return { content: null, error: `Class not found: ${params.className}` };
      } catch (e) {
        return { content: null, error: String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/addComponent",
    async (params: { uri: string; className: string; x: number; y: number }) => {
      // SysML2 — dispatch handles element insert + layout storage
      if (params.uri.endsWith(".sysml")) {
        const result = await getDiagramDispatch().applyEdits({
          uri: params.uri,
          seq: 0,
          actions: [{ type: "addComponent", className: params.className, x: params.x, y: params.y }],
        });
        return result.edits;
      }

      // Modelica — uses context-aware name generation (defaultComponentName annotation)
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      const doc = context.documents.get(params.uri);
      if (!instances?.[0] || !doc) return [];

      const classInstance = instances[0];
      const docContext = context.workspaceManager.documentContexts.get(params.uri);

      try {
        // Get base name from defaultComponentName annotation or class name
        const shortName = params.className.split(".").pop() || "component";
        let baseName = shortName.toLowerCase();
        try {
          let droppedClass: any = null;
          if (context.workspaceManager.globalModelicaQueryEngine) {
            const db = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
            const parts = params.className.split(".");
            let currentId: any = null;
            for (const part of parts) {
              const resolver = db.query<any>("resolveSimpleName", currentId);
              const res = resolver ? resolver(part) : null;
              if (!res) {
                currentId = null;
                break;
              }
              currentId = res.id ?? null;
            }
            if (currentId != null) droppedClass = new ModelicaClassInstance(currentId, db);
          }

          if (isClassInstance(droppedClass)) {
            const defaultName = droppedClass.annotation("defaultComponentName") as string | null;
            if (defaultName) {
              baseName = (droppedClass as any).translate?.(defaultName) ?? defaultName;
            } else {
              baseName = (droppedClass.localizedName || shortName).toLowerCase();
            }
          }
        } catch {
          // proceed with default baseName
        }

        // Find unique name
        let name = baseName;
        let i = 1;
        const existingNames = new Set(Array.from(classInstance.components).map((c) => c.name));
        while (existingNames.has(name)) {
          name = `${baseName}${i}`;
          i++;
        }

        return computeComponentInsert(classInstance, params.className, name, params.x, params.y, doc.getText());
      } catch (e) {
        console.error("[diagram] addComponent error:", e);
        return [];
      }
    },
  );

  context.connection.onRequest(
    "modelscript/flatten",
    async (params: { name: string; uri?: string }): Promise<{ text: string | null; error?: string }> => {
      let instances = params.uri ? context.workspaceManager.documentInstances.get(params.uri) : undefined;

      // Fallback to finding instances via context if URI isn't provided or didn't work
      if (!instances && params.uri) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }

      if (!instances && !params.uri) {
        for (const insts of context.workspaceManager.documentInstances.values()) {
          if (insts && insts.length > 0) {
            instances = insts;
            break;
          }
        }
      }

      if (!instances || instances.length === 0) {
        return { text: null, error: "No Modelica class instances found in the active document." };
      }

      let classInstance = instances[0];
      if (params.name) {
        const found = instances.find((i) => i.name === params.name);
        if (found) classInstance = found;
      }

      try {
        // Ensure the full index is available before flattening
        if (!context.state.dependenciesReady && context.workspaceManager.globalWorkspaceIndex.pendingFileCount > 0) {
          context.connection.sendNotification("modelscript/status", {
            state: "loading",
            message: "Indexing dependencies for flattening...",
          });
          await context.workspaceManager.globalWorkspaceIndex.indexRemainingInBackground(50);
          context.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });

          const fullIndex = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
          injectPredefinedTypes(fullIndex);
          const engine = params.uri?.endsWith(".sysml")
            ? context.workspaceManager.globalSysML2QueryEngine
            : context.workspaceManager.globalModelicaQueryEngine;
          if (engine) {
            engine.updateIndex(fullIndex);
            const resolver = (engine as any).__resolverCache;
            if (resolver) resolver.updateIndex(fullIndex);
          }

          if (params.uri) {
            const doc = context.documents.get(params.uri);
            if (doc) await context.validationService.validateTextDocument(doc);
            instances = context.workspaceManager.documentInstances.get(params.uri);
            if (instances && instances.length > 0) {
              classInstance = params.name
                ? (instances.find((i) => i.name === params.name) ?? instances[0])
                : instances[0];
            }
          }
        }

        let context = params.uri ? context.workspaceManager.documentContexts.get(params.uri) : undefined;
        if (!docContext) {
          context = context.workspaceManager.documentContexts.values().next().value;
        }
        if (!docContext) {
          return { text: null, error: "No Modelica context found." };
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);
        return { text: printArenaDAE(arena) };
      } catch (e) {
        return { text: null, error: e instanceof Error ? e.stack : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/query",
    (params: {
      name: string;
      uri?: string;
    }): {
      name: string;
      kind: string;
      description: string;
      components: { name: string; type: string; description: string }[];
      childClasses: { name: string; kind: string }[];
      error?: string;
    } | null => {
      let ctx: Context | undefined;
      if (params.uri) ctx = context.workspaceManager.documentContexts.get(params.uri);
      if (!ctx) {
        for (const c of context.workspaceManager.documentContexts.values()) {
          ctx = c;
          break;
        }
      }
      if (!ctx) return null;

      try {
        if (!context.workspaceManager.globalModelicaQueryEngine) return null;
        const db = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
        const parts = params.name.split(".");
        let currentId: any = null;
        for (const part of parts) {
          const resolver = db.query<any>("resolveSimpleName", currentId);
          const res = resolver ? resolver(part) : null;
          if (!res) return null;
          currentId = res.id ?? null;
        }
        if (currentId == null) return null;
        const element = new ModelicaClassInstance(currentId, db);

        if (!isClassInstance(element)) return null;

        const components: { name: string; type: string; description: string }[] = [];
        const childClasses: { name: string; kind: string }[] = [];
        for (const child of element.elements) {
          if (child instanceof ModelicaComponentInstance) {
            components.push({
              name: child.name ?? "",
              type: child.classInstance?.name ?? "",
              description: child.description ?? "",
            });
          } else if (isClassInstance(child)) {
            childClasses.push({
              name: child.name ?? "",
              kind: child.classKind ?? "class",
            });
          }
        }

        return {
          name: params.name,
          kind: element.classKind ?? "class",
          description: element.description ?? "",
          components,
          childClasses,
        };
      } catch (e) {
        console.error("[mcp-bridge] query error:", e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/parse",
    (params: { code: string }): { classes: { name: string; kind: string }[]; syntaxErrors: string[] } => {
      let ctx: Context | undefined;
      for (const c of context.workspaceManager.documentContexts.values()) {
        ctx = c;
        break;
      }
      if (!ctx) return { classes: [], syntaxErrors: ["No Modelica context available."] };

      try {
        const tree = ctx.parse(".mo", params.code);
        const errors: string[] = [];
        const walk = (node: any) => {
          if (!node) return;
          if (typeof node.hasError === "function" ? !node.hasError() : node.hasError === false) return;
          if (node.isMissing || node.type === "ERROR") {
            errors.push(node.isMissing ? `Missing syntax element` : `Syntax error`);
          }
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) walk(children[i]);
        };
        walk(tree.rootNode);

        const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
        const classes: { name: string; kind: string }[] = [];
        if (storedDef) {
          for (const classDef of storedDef.classDefinitions) {
            classes.push({
              name: classDef.identifier?.text ?? "<anonymous>",
              kind: String(classDef.classPrefixes?.classKind ?? "class"),
            });
          }
        }
        return { classes, syntaxErrors: errors };
      } catch (e) {
        return { classes: [], syntaxErrors: [e instanceof Error ? e.message : String(e)] };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getClassHierarchy",
    (params: { uri: string; className?: string }): ClassHierarchyNode | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      return buildClassHierarchy(target);
    },
  );

  context.connection.onRequest(
    "modelscript/getComponentTree",
    (params: { uri: string; className?: string }): ComponentTreeNode | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      return buildComponentTree(target);
    },
  );
}

// @ts-nocheck
