// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Router } from "express";
import { Router as createRouter } from "express";
import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  parse,
  type FragmentDefinitionNode,
  type SelectionSetNode,
} from "graphql";
import { createHandler } from "graphql-http/lib/use/express";

import type { LibraryDatabase } from "../database.js";

/** GraphQL object type representing a key-value modification on a Modelica component. */
const ModelicaModifierType = new GraphQLObjectType({
  name: "ModelicaModifier",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    value: { type: GraphQLString },
  },
});

/** GraphQL object type representing a component declaration inside a Modelica class. */
const ModelicaComponentType = new GraphQLObjectType({
  name: "ModelicaComponent",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    typeName: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    causality: { type: GraphQLString },
    variability: { type: GraphQLString },
    modifiers: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ModelicaModifierType))) },
  },
});

/** GraphQL object type representing an indexed Modelica class definition. */
const ModelicaClassType = new GraphQLObjectType({
  name: "ModelicaClass",
  fields: {
    className: { type: new GraphQLNonNull(GraphQLString) },
    classKind: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    extends: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    components: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ModelicaComponentType))) },
  },
});

/**
 * Creates the Express router exposing `/api/v1/libraries/:name/:version/graphql` for querying
 * indexed Modelica package classes, inheritance hierarchies, and component declarations.
 */
export function graphqlRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST/GET /api/v1/libraries/:name/:version/graphql
   *
   * GraphQL endpoint for querying class metadata.
   */
  router.all(["/:name/:version/graphql", "/:scope/:name/:version/graphql"], (req, res, next) => {
    const scope = req.params["scope"];
    const rawName = req.params["name"];
    const name = typeof scope === "string" && typeof rawName === "string" ? `${scope}/${rawName}` : rawName;
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const rawQuery =
      typeof req.body?.query === "string"
        ? req.body.query
        : typeof req.query["query"] === "string"
          ? req.query["query"]
          : "";
    if (rawQuery.length > 32 * 1024) {
      res.status(413).json({ errors: [{ message: "GraphQL query exceeds maximum length of 32 KB" }] });
      return;
    }
    if (rawQuery) {
      let depth = 0;
      let maxDepth = 0;
      for (let i = 0; i < rawQuery.length; i++) {
        const ch = rawQuery[i];
        if (ch === "{") {
          depth++;
          if (depth > maxDepth) maxDepth = depth;
        } else if (ch === "}") {
          depth = Math.max(0, depth - 1);
        }
      }
      if (maxDepth > 12) {
        res.status(400).json({ errors: [{ message: "GraphQL query exceeds maximum nesting depth of 12" }] });
        return;
      }

      try {
        const doc = parse(rawQuery);
        const fragments = new Map<string, FragmentDefinitionNode>();
        for (const def of doc.definitions) {
          if (def.kind === Kind.FRAGMENT_DEFINITION) {
            fragments.set(def.name.value, def);
          }
        }
        let aliasCount = 0;
        let totalSelections = 0;
        const measureSelectionDepth = (
          selSet: SelectionSetNode | undefined,
          currentDepth: number,
          visitedFragments: Set<string>,
        ): number => {
          if (!selSet) return currentDepth;
          let deepest = currentDepth;
          for (const sel of selSet.selections) {
            totalSelections++;
            if (sel.kind === Kind.FIELD) {
              if (sel.alias) aliasCount++;
              const d = measureSelectionDepth(sel.selectionSet, currentDepth + 1, visitedFragments);
              if (d > deepest) deepest = d;
            } else if (sel.kind === Kind.INLINE_FRAGMENT) {
              const d = measureSelectionDepth(sel.selectionSet, currentDepth + 1, visitedFragments);
              if (d > deepest) deepest = d;
            } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
              const fragName = sel.name.value;
              if (visitedFragments.has(fragName)) {
                return 999; // Cyclic fragment
              }
              const fragDef = fragments.get(fragName);
              if (fragDef) {
                const nextVisited = new Set(visitedFragments);
                nextVisited.add(fragName);
                const d = measureSelectionDepth(fragDef.selectionSet, currentDepth + 1, nextVisited);
                if (d > deepest) deepest = d;
              }
            }
          }
          return deepest;
        };

        for (const def of doc.definitions) {
          if (def.kind === Kind.OPERATION_DEFINITION) {
            const astDepth = measureSelectionDepth(def.selectionSet, 0, new Set());
            if (astDepth > 12) {
              res.status(400).json({ errors: [{ message: "GraphQL query exceeds maximum nesting depth of 12" }] });
              return;
            }
          }
        }
        if (aliasCount > 30 || totalSelections > 250) {
          res.status(400).json({
            errors: [{ message: "GraphQL query exceeds maximum allowed field alias or selection complexity" }],
          });
          return;
        }
      } catch {
        // Syntax errors will be handled by graphql-http
      }
    }

    let cachedAllClasses: ReturnType<typeof database.getAllClasses> | null = null;
    const getAllClassesMemo = () => {
      if (!cachedAllClasses) {
        cachedAllClasses = database.getAllClasses(name, version);
      }
      return cachedAllClasses;
    };

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          classes: {
            type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ModelicaClassType))),
            args: {
              kind: { type: GraphQLString },
              q: { type: GraphQLString },
            },
            resolve: (_root, args: { kind?: string | undefined; q?: string | undefined }) => {
              let results = getAllClassesMemo();

              if (args.kind) {
                results = results.filter((c) => c.classKind === args.kind);
              }
              if (args.q) {
                const q = args.q.toLowerCase();
                results = results.filter((c) => c.className.toLowerCase().includes(q));
              }

              return results;
            },
          },
          class: {
            type: ModelicaClassType,
            args: {
              name: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: (_root, args: { name: string }) => {
              const cls = database.getClass(name, version, args.name);
              if (!cls) return null;
              return {
                className: args.name,
                classKind: cls.classKind,
                description: cls.description,
                extends: cls.extends,
                components: cls.components.map((c) => ({
                  name: c.component_name,
                  typeName: c.type_name,
                  description: c.description,
                  causality: c.causality,
                  variability: c.variability,
                  modifiers: c.modifiers.map((m) => ({
                    name: m.modifier_name,
                    value: m.modifier_value,
                  })),
                })),
              };
            },
          },
        },
      }),
    });

    const handler = createHandler({ schema });
    handler(req, res, next);
  });

  return router;
}
