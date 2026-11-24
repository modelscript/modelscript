// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { executeSparqlQuery, type GenericSyntaxNode } from "@modelscript/sparql";
import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import { DataFactory, Writer } from "n3";
import { createRequire } from "node:module";

import { SqliteRdfSourceCache } from "../database-rdf.js";
import type { LibraryDatabase } from "../database.js";

const require = createRequire(import.meta.url);

type SparqlQueryForm = "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE" | "UNKNOWN";

/**
 * Strips leading `#` comments, `BASE <...>`, and `PREFIX ...: <...>` prologues
 * to reliably identify the W3C SPARQL 1.1 query form.
 */
export function detectSparqlQueryForm(query: string): SparqlQueryForm {
  let rest = query;
  while (rest.length > 0) {
    rest = rest.trimStart();
    if (rest.startsWith("#")) {
      const nl = rest.indexOf("\n");
      rest = nl === -1 ? "" : rest.slice(nl + 1);
      continue;
    }
    const prefixMatch = rest.match(/^PREFIX\s+[A-Za-z0-9_-]*:\s*<[^>]*>/i);
    if (prefixMatch) {
      rest = rest.slice(prefixMatch[0].length);
      continue;
    }
    const baseMatch = rest.match(/^BASE\s*<[^>]*>/i);
    if (baseMatch) {
      rest = rest.slice(baseMatch[0].length);
      continue;
    }
    break;
  }
  const head = rest.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  if (head === "SELECT" || head === "ASK" || head === "CONSTRUCT" || head === "DESCRIBE") {
    return head;
  }
  return "UNKNOWN";
}

let cachedSparqlParserPromise: Promise<{ parse(text: string): { rootNode: GenericSyntaxNode } }> | null = null;

function getSparqlParser(): Promise<{ parse(text: string): { rootNode: GenericSyntaxNode } }> {
  if (!cachedSparqlParserPromise) {
    const wasmPath = require.resolve("@modelscript/sparql/parser.wasm");
    cachedSparqlParserPromise = createWasmParser(wasmPath).then(
      ({ parser }) => parser as unknown as { parse(text: string): { rootNode: GenericSyntaxNode } },
    );
  }
  return cachedSparqlParserPromise;
}

/**
 * Creates the Express router exposing W3C SPARQL 1.1 `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE`
 * query endpoints (`/api/v1/libraries/sparql?library=...&version=...`,
 * `/api/v1/libraries/:name/:version/sparql`, and
 * `/api/v1/libraries/:scope/:name/:version/sparql`) backed by `SqliteRdfSource` and our native
 * `@modelscript/sparql` WebAssembly GLR parser + algebra engine.
 */
export function sparqlRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const urlencodedParser = express.urlencoded({ extended: false });
  const rdfSourceCache = new SqliteRdfSourceCache(database.db, {
    maxEntries: 16,
    ttlMs: 60_000,
  });

  router.all(
    ["/", "/:name/:version/sparql", "/:scope/:name/:version/sparql"],
    (req: Request, _res: Response, next) => {
      if (req.path === "/" && !req.baseUrl.endsWith("/sparql")) {
        next("route");
        return;
      }
      next();
    },
    urlencodedParser,
    async (req: Request, res: Response): Promise<void> => {
      const scope = req.params["scope"];
      const rawName =
        req.params["name"] ??
        (typeof req.query["library"] === "string" ? req.query["library"] : undefined) ??
        (typeof req.query["name"] === "string" ? req.query["name"] : undefined) ??
        (typeof req.body?.library === "string" ? req.body.library : undefined);
      const name = typeof scope === "string" && typeof rawName === "string" ? `${scope}/${rawName}` : rawName;
      const version =
        req.params["version"] ??
        (typeof req.query["version"] === "string" ? req.query["version"] : undefined) ??
        (typeof req.body?.version === "string" ? req.body.version : undefined);

      if (typeof name !== "string" || !name.trim() || typeof version !== "string" || !version.trim()) {
        res.status(400).json({
          error:
            "Package name and version are required (provide /:name/:version/sparql, /:scope/:name/:version/sparql, or ?library=<name>&version=<version>)",
        });
        return;
      }

      const MAX_SPARQL_BYTES = 64 * 1024;
      let query: string | undefined;
      if (req.method === "GET") {
        query = typeof req.query["query"] === "string" ? req.query["query"] : undefined;
      } else {
        const contentType = req.headers["content-type"] ?? "";
        if (contentType.includes("application/sparql-query")) {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          for await (const chunk of req) {
            const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            totalBytes += buf.length;
            if (totalBytes > MAX_SPARQL_BYTES) {
              res.status(413).json({ error: "SPARQL query exceeds maximum size of 64 KB" });
              return;
            }
            chunks.push(buf);
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

      if (Buffer.byteLength(query, "utf8") > MAX_SPARQL_BYTES) {
        res.status(413).json({ error: "SPARQL query exceeds maximum size of 64 KB" });
        return;
      }

      const queryForm = detectSparqlQueryForm(query);
      if (queryForm === "UNKNOWN") {
        res.status(400).json({ error: "Only SELECT, ASK, CONSTRUCT, and DESCRIBE queries are supported" });
        return;
      }

      const source = rdfSourceCache.get(name, version);

      try {
        const parser = await getSparqlParser();
        const result = executeSparqlQuery(parser, query, source.asSparqlSource(), {
          disallowService: true,
          maxBindings: 5000,
        });

        if (result.queryType === "SELECT" || result.queryType === "ASK") {
          res.setHeader("Content-Type", "application/sparql-results+json");
          res.json(result.json);
        } else {
          const accept = req.accepts(["text/turtle", "application/n-triples"]);
          const format = accept === "application/n-triples" ? "N-Triples" : "Turtle";
          const contentType = format === "N-Triples" ? "application/n-triples" : "text/turtle";

          const writer = new Writer({ format });
          for (const q of result.quads) {
            const subj =
              q.subject.termType === "BlankNode"
                ? DataFactory.blankNode(q.subject.value)
                : DataFactory.namedNode(q.subject.value);
            const pred = DataFactory.namedNode(q.predicate.value);
            const obj =
              q.object.termType === "NamedNode"
                ? DataFactory.namedNode(q.object.value)
                : q.object.termType === "BlankNode"
                  ? DataFactory.blankNode(q.object.value)
                  : q.object.language
                    ? DataFactory.literal(q.object.value, q.object.language)
                    : q.object.datatype
                      ? DataFactory.literal(q.object.value, DataFactory.namedNode(q.object.datatype))
                      : DataFactory.literal(q.object.value);
            writer.addQuad(subj, pred, obj);
          }

          const serialized = await new Promise<string>((resolve, reject) => {
            writer.end((err, out) => (err ? reject(err) : resolve(out ?? "")));
          });

          res.setHeader("Content-Type", contentType);
          res.send(serialized);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "SPARQL query execution failed";
        res.status(400).json({ error: message });
      }
    },
  );

  return router;
}
