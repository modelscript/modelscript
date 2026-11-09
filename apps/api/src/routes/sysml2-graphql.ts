// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Router } from "express";
import { Router as createRouter } from "express";
import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import type { SysML2OmgService } from "../services/sysml2-omg-service.js";

export function createSysml2GraphQLSchema(omgService: SysML2OmgService): GraphQLSchema {
  const BranchType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgBranch",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID), resolve: (b) => b["@id"] },
      type: { type: new GraphQLNonNull(GraphQLString), resolve: (b) => b["@type"] },
      name: { type: new GraphQLNonNull(GraphQLString) },
      headCommitId: { type: GraphQLString },
      created: { type: new GraphQLNonNull(GraphQLString) },
    }),
  });

  const ProjectType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgProject",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID), resolve: (p) => p["@id"] },
      type: { type: new GraphQLNonNull(GraphQLString), resolve: (p) => p["@type"] },
      name: { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
      created: { type: new GraphQLNonNull(GraphQLString) },
      defaultBranch: {
        type: new GraphQLNonNull(BranchType),
        resolve: (p) => ({
          "@id": p.defaultBranch["@id"],
          "@type": "Branch",
          name: p.defaultBranch.name,
          headCommitId: p.defaultBranch.headCommitId,
          created: p.created,
        }),
      },
      branches: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(BranchType))),
        resolve: (p) => omgService.listBranches(p["@id"]),
      },
      commits: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(CommitType))),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: (p, args: { limit?: number; offset?: number }) => {
          let commits = omgService.listCommits(p["@id"]);
          if (args.offset) commits = commits.slice(args.offset);
          if (args.limit) commits = commits.slice(0, args.limit);
          return commits;
        },
      },
    }),
  });

  const ElementType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgElement",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID), resolve: (e) => e["@id"] },
      type: { type: new GraphQLNonNull(GraphQLString), resolve: (e) => e["@type"] },
      name: { type: GraphQLString },
      qualifiedName: { type: GraphQLString },
      isAbstract: { type: GraphQLBoolean, resolve: (e) => Boolean(e.isAbstract) },
      sourceUri: { type: GraphQLString },
      documentation: {
        type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
        resolve: (e) => e.documentation || [],
      },
    }),
  });

  const RelationshipType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgRelationship",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID), resolve: (r) => r["@id"] },
      type: { type: new GraphQLNonNull(GraphQLString), resolve: (r) => r["@type"] },
      relationshipType: { type: new GraphQLNonNull(GraphQLString) },
      sourceId: { type: GraphQLString, resolve: (r) => r.source?.[0]?.["@id"] },
      targetId: { type: GraphQLString, resolve: (r) => r.target?.[0]?.["@id"] },
    }),
  });

  const CommitDiffType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgCommitDiff",
    fields: () => ({
      baseCommitId: { type: new GraphQLNonNull(GraphQLString) },
      targetCommitId: { type: new GraphQLNonNull(GraphQLString) },
      addedElements: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ElementType))),
        resolve: (d) => d.addedElements || [],
      },
      modifiedElementsCount: {
        type: new GraphQLNonNull(GraphQLInt),
        resolve: (d) => (d.modifiedElements ? d.modifiedElements.length : 0),
      },
      deletedElementsCount: {
        type: new GraphQLNonNull(GraphQLInt),
        resolve: (d) => (d.deletedElements ? d.deletedElements.length : 0),
      },
    }),
  });

  const CommitType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgCommit",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID), resolve: (c) => c["@id"] },
      type: { type: new GraphQLNonNull(GraphQLString), resolve: (c) => c["@type"] },
      projectId: { type: new GraphQLNonNull(GraphQLString) },
      description: { type: new GraphQLNonNull(GraphQLString) },
      created: { type: new GraphQLNonNull(GraphQLString) },
      elements: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ElementType))),
        args: {
          type: { type: GraphQLString },
          search: { type: GraphQLString },
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: (c, args: { type?: string; search?: string; limit?: number; offset?: number }) => {
          const res = omgService.getElements(c.projectId, c["@id"], { type: args.type, name: args.search });
          let elems = res.elements;
          if (args.offset) elems = elems.slice(args.offset);
          if (args.limit) elems = elems.slice(0, args.limit);
          return elems;
        },
      },
      relationships: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(RelationshipType))),
        resolve: (c) => (omgService as any).relationships?.get(c["@id"]) || [],
      },
    }),
  });

  const MergeResultType: GraphQLObjectType = new GraphQLObjectType({
    name: "OmgMergeResult",
    fields: () => ({
      status: { type: new GraphQLNonNull(GraphQLString) },
      hasConflicts: { type: new GraphQLNonNull(GraphQLBoolean) },
      lcaCommitId: { type: GraphQLString },
      sourceBranchId: { type: new GraphQLNonNull(GraphQLString) },
      targetBranchId: { type: new GraphQLNonNull(GraphQLString) },
      mergeCommit: { type: CommitType },
    }),
  });

  const QueryType = new GraphQLObjectType({
    name: "Query",
    fields: {
      projects: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ProjectType))),
        resolve: () => omgService.listProjects(),
      },
      project: {
        type: ProjectType,
        args: {
          id: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { id: string }) => omgService.getProject(args.id),
      },
      commits: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(CommitType))),
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { projectId: string }) => omgService.listCommits(args.projectId),
      },
      commit: {
        type: CommitType,
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
          commitId: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { projectId: string; commitId: string }) =>
          omgService.getCommit(args.projectId, args.commitId),
      },
      element: {
        type: ElementType,
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
          commitId: { type: new GraphQLNonNull(GraphQLID) },
          elementId: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { projectId: string; commitId: string; elementId: string }) =>
          omgService.getElementById(args.projectId, args.commitId, args.elementId),
      },
      diff: {
        type: CommitDiffType,
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
          baseCommitId: { type: new GraphQLNonNull(GraphQLID) },
          targetCommitId: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { projectId: string; baseCommitId: string; targetCommitId: string }) =>
          omgService.diffCommits(args.projectId, args.baseCommitId, args.targetCommitId),
      },
    },
  });

  const MutationType = new GraphQLObjectType({
    name: "Mutation",
    fields: {
      createProject: {
        type: new GraphQLNonNull(ProjectType),
        args: {
          name: { type: new GraphQLNonNull(GraphQLString) },
          description: { type: GraphQLString },
        },
        resolve: (_root, args: { name: string; description?: string }) => {
          return omgService.createProject(args.name, args.description);
        },
      },
      ingestModel: {
        type: new GraphQLNonNull(CommitType),
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
          sourceText: { type: new GraphQLNonNull(GraphQLString) },
          message: { type: GraphQLString },
          branch: { type: GraphQLString },
        },
        resolve: async (_root, args: { projectId: string; sourceText: string; message?: string; branch?: string }) => {
          return omgService.ingestSysML2(
            args.projectId,
            args.message || "GraphQL Model Ingest",
            args.sourceText,
            undefined,
            args.branch,
          );
        },
      },
      mergeBranches: {
        type: new GraphQLNonNull(MergeResultType),
        args: {
          projectId: { type: new GraphQLNonNull(GraphQLID) },
          sourceBranchId: { type: new GraphQLNonNull(GraphQLID) },
          targetBranchId: { type: new GraphQLNonNull(GraphQLID) },
        },
        resolve: (_root, args: { projectId: string; sourceBranchId: string; targetBranchId: string }) => {
          return omgService.mergeBranches(args.projectId, args.sourceBranchId, args.targetBranchId);
        },
      },
    },
  });

  return new GraphQLSchema({
    query: QueryType,
    mutation: MutationType,
  });
}

export function sysml2GraphQLRouter(omgService: SysML2OmgService): Router {
  const router = createRouter();
  const schema = createSysml2GraphQLSchema(omgService);
  const handler = createHandler({ schema });

  router.use("/", handler);
  return router;
}
