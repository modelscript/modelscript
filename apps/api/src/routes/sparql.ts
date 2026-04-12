// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { DataFactory } from "n3";

import { SqliteRdfSource } from "../database-rdf.js";
import type { LibraryDatabase } from "../database.js";

export function sparqlRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET/POST /api/v1/libraries/:name/:version/sparql
   *
   * Execute a SPARQL query against the library metadata.
   */
  router.all("/:name/:version/sparql", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    // Extract the SPARQL query from the request
    let query: string | undefined;
    if (req.method === "GET") {
      query = typeof req.query["query"] === "string" ? req.query["query"] : undefined;
    } else {
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.includes("application/sparql-query")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        query = Buffer.concat(chunks).toString("utf-8");
      } else {
        query = typeof req.body?.query === "string" ? req.body.query : undefined;
      }
    }

    if (!query) {
      res.status(400).json({ error: "A SPARQL query must be provided via ?query= parameter or request body" });
      return;
    }

    // Build streaming SQL-backed source
    // Note: LibraryDatabase.#db is private, so we need to either expose it or use a getter.
    // I will add a getter to LibraryDatabase in the next step, for now I assume it's available or we pass the Database proxy.
    const source = new SqliteRdfSource(database.db, name, version);

    try {
      // Dynamically import comunica to avoid top-level import issues
      const { QueryEngine } = await import("@comunica/query-sparql-rdfjs");
      const engine = new QueryEngine();

      const queryType = query.trim().toUpperCase();

      if (queryType.startsWith("SELECT") || queryType.startsWith("PREFIX")) {
        const bindingsStream = await engine.queryBindings(query, { sources: [source] });
        const bindings = await bindingsStream.toArray();

        const firstBinding = bindings[0];
        const variables = firstBinding ? [...firstBinding.keys()].map((v) => v.value) : [];

        const results = bindings.map((binding) => {
          const row: Record<string, { type: string; value: string }> = {};
          for (const variable of variables) {
            const term = binding.get(variable) ?? binding.get(DataFactory.variable(variable));
            if (term) {
              row[variable] = {
                type: term.termType === "NamedNode" ? "uri" : "literal",
                value: term.value,
              };
            }
          }
          return row;
        });

        res.setHeader("Content-Type", "application/sparql-results+json");
        res.json({
          head: { vars: variables },
          results: { bindings: results },
        });
      } else if (queryType.startsWith("ASK")) {
        const result = await engine.queryBoolean(query, { sources: [source] });
        res.setHeader("Content-Type", "application/sparql-results+json");
        res.json({ head: {}, boolean: result });
      } else {
        res.status(400).json({ error: "Only SELECT, ASK, and PREFIX queries are supported" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "SPARQL query execution failed";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
