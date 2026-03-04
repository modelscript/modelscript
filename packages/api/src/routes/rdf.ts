// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { DataFactory, Writer } from "n3";

import type { LibraryDatabase } from "../database.js";

const { namedNode, literal } = DataFactory;

/**
 * Determine whether a string looks like a URI (named node) or a literal.
 */
function isUri(value: string): boolean {
  return value.startsWith("urn:") || value.startsWith("http://") || value.startsWith("https://");
}

export function rdfRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/libraries/:name/:version/rdf
   *
   * Serialize the entire library metadata as RDF.
   * Supports content negotiation via Accept header:
   *   - text/turtle (default)
   *   - application/n-triples
   */
  router.get("/:name/:version/rdf", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    const triples = database.getLibraryTriples(name, version);
    if (triples.length === 0) {
      res.status(404).json({ error: `No metadata found for ${name}@${version}` });
      return;
    }

    // Choose format based on Accept header
    const accept = req.accepts(["text/turtle", "application/n-triples"]);
    const format = accept === "application/n-triples" ? "N-Triples" : "Turtle";
    const contentType = format === "N-Triples" ? "application/n-triples" : "text/turtle";

    const writer = new Writer({
      format,
      prefixes: {
        modelica: "https://modelica.org/ontology#",
        lib: `urn:modelica:${name}:${version}:`,
      },
    });

    for (const triple of triples) {
      const subject = namedNode(triple.s);
      const predicate = namedNode(triple.p);
      const object = isUri(triple.o) ? namedNode(triple.o) : literal(triple.o);
      writer.addQuad(subject, predicate, object);
    }

    writer.end((error, result) => {
      if (error) {
        res.status(500).json({ error: "Failed to serialize RDF" });
        return;
      }
      res.setHeader("Content-Type", contentType);
      res.send(result);
    });
  });

  return router;
}
