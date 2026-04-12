/* eslint-disable */
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

  // MetadataUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["MetadataUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("MetadataUsage", merged);
      }
    }
  }

  // MetadataDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["MetadataDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["Package"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["LibraryPackage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("LibraryPackage", merged);
      }
    }
  }

  // DefaultReferenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["DefaultReferenceUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("DefaultReferenceUsage", merged);
      }
    }
  }

  // ReferenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ReferenceUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ReferenceUsage", merged);
      }
    }
  }

  // AttributeDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AttributeDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AttributeDefinition", merged);
      }
    }
  }

  // AttributeUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AttributeUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AttributeUsage", merged);
      }
    }
  }

  // EnumerationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["EnumerationDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("EnumerationDefinition", merged);
      }
    }
  }

  // EnumerationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["EnumerationUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("EnumerationUsage", merged);
      }
    }
  }

  // OccurrenceDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["OccurrenceDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("OccurrenceDefinition", merged);
      }
    }
  }

  // OccurrenceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["OccurrenceUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("OccurrenceUsage", merged);
      }
    }
  }

  // ItemDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ItemDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ItemDefinition", merged);
      }
    }
  }

  // ItemUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ItemUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ItemUsage", merged);
      }
    }
  }

  // PartDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["PartDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PartDefinition", merged);
      }
    }
  }

  // PartUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["PartUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PartUsage", merged);
      }
    }
  }

  // PortDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["PortDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PortDefinition", merged);
      }
    }
  }

  // PortUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["PortUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PortUsage", merged);
      }
    }
  }

  // ConnectionDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConnectionDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectionDefinition", merged);
      }
    }
  }

  // ConnectionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConnectionUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectionUsage", merged);
      }
    }
  }

  // BindingConnectorAsUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["BindingConnectorAsUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("BindingConnectorAsUsage", merged);
      }
    }
  }

  // SuccessionAsUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["SuccessionAsUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SuccessionAsUsage", merged);
      }
    }
  }

  // InterfaceDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["InterfaceDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("InterfaceDefinition", merged);
      }
    }
  }

  // InterfaceUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["InterfaceUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("InterfaceUsage", merged);
      }
    }
  }

  // AllocationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AllocationDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AllocationDefinition", merged);
      }
    }
  }

  // AllocationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AllocationUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AllocationUsage", merged);
      }
    }
  }

  // FlowDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["FlowDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("FlowDefinition", merged);
      }
    }
  }

  // FlowUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["FlowUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("FlowUsage", merged);
      }
    }
  }

  // SuccessionFlowUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["SuccessionFlowUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SuccessionFlowUsage", merged);
      }
    }
  }

  // ActionDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ActionDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ActionDefinition", merged);
      }
    }
  }

  // ActionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ActionUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["AcceptActionNode"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["SendActionNode"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["AssignActionNode"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AssignActionNode", merged);
      }
    }
  }

  // PerformActionUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["PerformActionUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("PerformActionUsage", merged);
      }
    }
  }

  // CalculationDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, parameters, returnParameter, resultExpression, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["CalculationDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CalculationDefinition", merged);
      }
    }
  }

  // CalculationUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, parameters, returnParameter, resultExpression, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["CalculationUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CalculationUsage", merged);
      }
    }
  }

  // ConstraintDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, constraintResult, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConstraintDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConstraintDefinition", merged);
      }
    }
  }

  // ConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult, lint__usageNaming, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConstraintUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConstraintUsage", merged);
      }
    }
  }

  // AssertConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult, lint__usageNaming, lint__constraintViolated
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AssertConstraintUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AssertConstraintUsage", merged);
      }
    }
  }

  // RequirementDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, subject, assumeConstraints, requireConstraints, actors, stakeholders, isSatisfied, satisfiedBy, isVerified, verifiedBy, verificationStatus, constraintsMet, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__missingSubject, lint__cyclicSatisfaction, lint__requirementConstraintViolated, lint__requirementWithoutConstraint, lint__evolutionCheck
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["RequirementDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementDefinition", merged);
      }
    }
  }

  // RequirementConstraintUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, constraintResult
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["RequirementConstraintUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementConstraintUsage", merged);
      }
    }
  }

  // RequirementUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, subject, assumeConstraints, requireConstraints, isSatisfied, satisfiedBy, isVerified, verifiedBy, verificationStatus, constraintsMet, lint__usageNaming, lint__missingSubject, lint__cyclicSatisfaction, lint__requirementConstraintViolated, lint__requirementWithoutConstraint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["RequirementUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RequirementUsage", merged);
      }
    }
  }

  // SatisfyRequirementUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, satisfiedRequirement, satisfyingSubject, lint__usageNaming, lint__invalidTarget, lint__satisfyingViolatedRequirement
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["SatisfyRequirementUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("SatisfyRequirementUsage", merged);
      }
    }
  }

  // ConcernDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConcernDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConcernDefinition", merged);
      }
    }
  }

  // ConcernUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConcernUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConcernUsage", merged);
      }
    }
  }

  // CaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["CaseDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CaseDefinition", merged);
      }
    }
  }

  // CaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["CaseUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("CaseUsage", merged);
      }
    }
  }

  // AnalysisCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AnalysisCaseDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AnalysisCaseDefinition", merged);
      }
    }
  }

  // AnalysisCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["AnalysisCaseUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("AnalysisCaseUsage", merged);
      }
    }
  }

  // VerificationCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, verifiedRequirements, objective, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization, lint__emptyVerificationCase, lint__missingObjective
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["VerificationCaseDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("VerificationCaseDefinition", merged);
      }
    }
  }

  // VerificationCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, verifiedRequirements, objective, lint__usageNaming, lint__emptyVerificationCase
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["VerificationCaseUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["VerifyRequirementUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("VerifyRequirementUsage", merged);
      }
    }
  }

  // UseCaseDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["UseCaseDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("UseCaseDefinition", merged);
      }
    }
  }

  // UseCaseUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["UseCaseUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["IncludeUseCaseUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("IncludeUseCaseUsage", merged);
      }
    }
  }

  // StateDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, entryAction, doAction, exitAction, transitions, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["StateDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("StateDefinition", merged);
      }
    }
  }

  // StateUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, entryAction, doAction, exitAction, transitions, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["StateUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("StateUsage", merged);
      }
    }
  }

  // ExhibitStateUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, entryAction, doAction, exitAction, transitions, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ExhibitStateUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
    const rule = langDef.rules!["TransitionUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("TransitionUsage", merged);
      }
    }
  }

  // ViewDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ViewDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewDefinition", merged);
      }
    }
  }

  // ViewUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ViewUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewUsage", merged);
      }
    }
  }

  // ViewpointDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ViewpointDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewpointDefinition", merged);
      }
    }
  }

  // ViewpointUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ViewpointUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ViewpointUsage", merged);
      }
    }
  }

  // RenderingDefinition: members, ownedDefinitions, ownedUsages, imports, ownedParts, ownedAttributes, ownedPorts, ownedActions, ownedConstraints, ownedConnections, superclassifiers, lint__definitionNaming, lint__emptyDefinition, lint__duplicateFeatureName, lint__circularSpecialization
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["RenderingDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("RenderingDefinition", merged);
      }
    }
  }

  // RenderingUsage: ownedFeatures, resolvedType, redefinedFeatures, subsettedFeatures, lint__usageNaming
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["RenderingUsage"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
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
