// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Router } from "express";
import { Router as createRouter } from "express";
import { GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";

import type { LibraryDatabase } from "../database.js";

const ModelicaModifierType = new GraphQLObjectType({
  name: "ModelicaModifier",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    value: { type: GraphQLString },
  },
});

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

export function graphqlRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST/GET /api/v1/libraries/:name/:version/graphql
   *
   * GraphQL endpoint for querying class metadata.
   */
  router.all("/:name/:version/graphql", (req, res, next) => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

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
            resolve: (_root, args: { kind?: string; q?: string }) => {
              let results = database.getAllClasses(name, version);

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
