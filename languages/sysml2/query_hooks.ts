import type { QueryHooks } from "@modelscript/polyglot/runtime";

// Import the language definition to access query lambdas directly.
// The functions are NOT serialized — they execute from the original source.
import langDef from "./language.js";

/**
 * Query hooks extracted from language.ts def() rules.
 * Each entry maps a grammar rule name to its query functions.
 */
function buildQueryHooks(): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langDef.rules) return hooks;

  // MetadataUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["MetadataUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("MetadataUsage", merged);
      }
    }
  }

  // MetadataDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["MetadataDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("MetadataDefinition", merged);
      }
    }
  }

  // Package: members, ownedDefinitions, ownedUsages, imports, allRequirements, satisfiedRequirements, unsatisfiedRequirements, verifiedRequirements, unverifiedRequirements, lint__packageNaming, lint__emptyPackage, lint__unverifiedRequirement
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["Package"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("Package", merged);
      }
    }
  }

  // LibraryPackage: members, ownedDefinitions, ownedUsages, imports, allRequirements, satisfiedRequirements, unsatisfiedRequirements, verifiedRequirements, unverifiedRequirements, lint__packageNaming, lint__emptyPackage, lint__unverifiedRequirement
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["LibraryPackage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("LibraryPackage", merged);
      }
    }
  }

  // DefaultReferenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["DefaultReferenceUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("DefaultReferenceUsage", merged);
      }
    }
  }

  // ReferenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ReferenceUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ReferenceUsage", merged);
      }
    }
  }

  // AttributeDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AttributeDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AttributeDefinition", merged);
      }
    }
  }

  // AttributeUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AttributeUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AttributeUsage", merged);
      }
    }
  }

  // EnumerationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["EnumerationDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("EnumerationDefinition", merged);
      }
    }
  }

  // EnumerationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["EnumerationUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("EnumerationUsage", merged);
      }
    }
  }

  // OccurrenceDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["OccurrenceDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("OccurrenceDefinition", merged);
      }
    }
  }

  // OccurrenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["OccurrenceUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("OccurrenceUsage", merged);
      }
    }
  }

  // ItemDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ItemDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ItemDefinition", merged);
      }
    }
  }

  // ItemUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ItemUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ItemUsage", merged);
      }
    }
  }

  // PartDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["PartDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PartDefinition", merged);
      }
    }
  }

  // PartUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["PartUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PartUsage", merged);
      }
    }
  }

  // PortDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["PortDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PortDefinition", merged);
      }
    }
  }

  // PortUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["PortUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PortUsage", merged);
      }
    }
  }

  // ConnectionDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConnectionDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectionDefinition", merged);
      }
    }
  }

  // ConnectionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConnectionUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectionUsage", merged);
      }
    }
  }

  // BindingConnectorAsUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["BindingConnectorAsUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("BindingConnectorAsUsage", merged);
      }
    }
  }

  // SuccessionAsUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["SuccessionAsUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SuccessionAsUsage", merged);
      }
    }
  }

  // InterfaceDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["InterfaceDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("InterfaceDefinition", merged);
      }
    }
  }

  // InterfaceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["InterfaceUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("InterfaceUsage", merged);
      }
    }
  }

  // AllocationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AllocationDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AllocationDefinition", merged);
      }
    }
  }

  // AllocationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, resolvedSource, resolvedTarget, lint__usageNaming, lint__multiplicityBounds, lint__allocationTargetUnresolved, lint__allocationSourceUnresolved, lint__portInterfaceMismatch
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AllocationUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AllocationUsage", merged);
      }
    }
  }

  // FlowDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["FlowDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("FlowDefinition", merged);
      }
    }
  }

  // FlowUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["FlowUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("FlowUsage", merged);
      }
    }
  }

  // SuccessionFlowUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["SuccessionFlowUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SuccessionFlowUsage", merged);
      }
    }
  }

  // ActionDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ActionDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ActionDefinition", merged);
      }
    }
  }

  // ActionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ActionUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ActionUsage", merged);
      }
    }
  }

  // AcceptActionNode: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AcceptActionNode"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AcceptActionNode", merged);
      }
    }
  }

  // SendActionNode: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["SendActionNode"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SendActionNode", merged);
      }
    }
  }

  // AssignActionNode: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AssignActionNode"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AssignActionNode", merged);
      }
    }
  }

  // PerformActionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["PerformActionUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PerformActionUsage", merged);
      }
    }
  }

  // CalculationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, parameters, returnParameter, resultExpression, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["CalculationDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CalculationDefinition", merged);
      }
    }
  }

  // CalculationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, parameters, returnParameter, resultExpression, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["CalculationUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CalculationUsage", merged);
      }
    }
  }

  // ConstraintDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, constraintResult, dynamicConstraintResult, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConstraintDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConstraintDefinition", merged);
      }
    }
  }

  // ConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult, dynamicConstraintResult, lint__usageNaming, lint__multiplicityBounds, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConstraintUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConstraintUsage", merged);
      }
    }
  }

  // AssertConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult, dynamicConstraintResult, lint__usageNaming, lint__multiplicityBounds, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AssertConstraintUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AssertConstraintUsage", merged);
      }
    }
  }

  // RequirementDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, subject, assumeConstraints, requireConstraints, actors, stakeholders, isSatisfied, satisfiedBy, isVerified, verifiedBy, verificationStatus, constraintsMet, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__missingSubject, lint__cyclicSatisfaction, lint__requirementConstraintViolated, lint__requirementWithoutConstraint, lint__evolutionCheck
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["RequirementDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementDefinition", merged);
      }
    }
  }

  // RequirementConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult, dynamicConstraintResult
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["RequirementConstraintUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementConstraintUsage", merged);
      }
    }
  }

  // RequirementUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, subject, assumeConstraints, requireConstraints, isSatisfied, satisfiedBy, isVerified, verifiedBy, verificationStatus, constraintsMet, lint__usageNaming, lint__multiplicityBounds, lint__missingSubject, lint__cyclicSatisfaction, lint__requirementConstraintViolated, lint__requirementWithoutConstraint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["RequirementUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementUsage", merged);
      }
    }
  }

  // SatisfyRequirementUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, satisfiedRequirement, satisfyingSubject, lint__usageNaming, lint__multiplicityBounds, lint__invalidTarget, lint__satisfyingViolatedRequirement
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["SatisfyRequirementUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SatisfyRequirementUsage", merged);
      }
    }
  }

  // ConcernDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConcernDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConcernDefinition", merged);
      }
    }
  }

  // ConcernUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConcernUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConcernUsage", merged);
      }
    }
  }

  // CaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["CaseDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CaseDefinition", merged);
      }
    }
  }

  // CaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["CaseUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CaseUsage", merged);
      }
    }
  }

  // AnalysisCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AnalysisCaseDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AnalysisCaseDefinition", merged);
      }
    }
  }

  // AnalysisCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["AnalysisCaseUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AnalysisCaseUsage", merged);
      }
    }
  }

  // VerificationCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, verifiedRequirements, objective, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__emptyVerificationCase, lint__missingObjective
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["VerificationCaseDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("VerificationCaseDefinition", merged);
      }
    }
  }

  // VerificationCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, verifiedRequirements, objective, lint__usageNaming, lint__multiplicityBounds, lint__emptyVerificationCase, lint__verificationResult
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["VerificationCaseUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("VerificationCaseUsage", merged);
      }
    }
  }

  // VerifyRequirementUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__verifyTargetNotRequirement
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["VerifyRequirementUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("VerifyRequirementUsage", merged);
      }
    }
  }

  // UseCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["UseCaseDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("UseCaseDefinition", merged);
      }
    }
  }

  // UseCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["UseCaseUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("UseCaseUsage", merged);
      }
    }
  }

  // IncludeUseCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["IncludeUseCaseUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("IncludeUseCaseUsage", merged);
      }
    }
  }

  // StateDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, entryAction, doAction, exitAction, transitions, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["StateDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("StateDefinition", merged);
      }
    }
  }

  // StateUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, entryAction, doAction, exitAction, transitions, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["StateUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("StateUsage", merged);
      }
    }
  }

  // ExhibitStateUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, entryAction, doAction, exitAction, transitions, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ExhibitStateUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ExhibitStateUsage", merged);
      }
    }
  }

  // TransitionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["TransitionUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("TransitionUsage", merged);
      }
    }
  }

  // ViewDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ViewDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewDefinition", merged);
      }
    }
  }

  // ViewUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ViewUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewUsage", merged);
      }
    }
  }

  // ViewpointDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ViewpointDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewpointDefinition", merged);
      }
    }
  }

  // ViewpointUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ViewpointUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewpointUsage", merged);
      }
    }
  }

  // RenderingDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, extractTopology, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["RenderingDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RenderingDefinition", merged);
      }
    }
  }

  // RenderingUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming, lint__multiplicityBounds
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["RenderingUsage"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RenderingUsage", merged);
      }
    }
  }

  return hooks;
}

export const QUERY_HOOKS = buildQueryHooks();
