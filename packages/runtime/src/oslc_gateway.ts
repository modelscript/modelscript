// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native OSLC Core 3.0 Linked Data Gateway for @modelscript/runtime.
 *
 * Implements W3C Linked Data Platform (LDP) and Open Services for Lifecycle Collaboration (OSLC)
 * interfaces for enterprise coexistence with Siemens Teamcenter, PTC Windchill, IBM DOORS Next,
 * and Jama Connect.
 *
 * Exposes:
 * - OSLC-RM (Requirements Management: http://open-services.net/ns/rm#)
 * - OSLC-QM (Quality Management: http://open-services.net/ns/qm#)
 * - OSLC-AM (Architecture Management: http://open-services.net/ns/am#)
 * with lossless JSON-LD / Turtle export and an embedded HTTP REST server with content negotiation.
 */

import http from "node:http";
import { URL } from "node:url";
import type { ReqIfRequirement, ReqIfSpecification } from "./reqif.js";
import { DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export const OSLC_PREFIXES = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  dcterms: "http://purl.org/dc/terms/",
  oslc: "http://open-services.net/ns/core#",
  oslc_rm: "http://open-services.net/ns/rm#",
  oslc_qm: "http://open-services.net/ns/qm#",
  oslc_am: "http://open-services.net/ns/am#",
  ms: "https://modelscript.org/ns/thread#",
};

export interface OslcRequirementResource {
  uri: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  created: string;
  modified: string;
  satisfiedBy: string[];
  verifiedBy: string[];
  elaboratedBy: string[];
  attributes: Record<string, string | number | boolean>;
}

export interface OslcTestResultResource {
  uri: string;
  identifier: string;
  title: string;
  status: "Passed" | "Failed" | "Inconclusive" | "Error";
  created: string;
  executionDurationMs: number;
  verifiesRequirements: string[];
  testedResources: string[];
  metricValues: Record<string, number>;
  details: string;
}

export interface OslcArchitectureResource {
  uri: string;
  identifier: string;
  title: string;
  elementType: string;
  domain: string;
  format: string;
  created: string;
  sourceFile?: string;
  allocates: string[];
  satisfiedRequirements: string[];
  properties: Record<string, any>;
}

export class OslcGateway {
  private baseUri: string;
  private requirements: Map<string, OslcRequirementResource> = new Map();
  private testResults: Map<string, OslcTestResultResource> = new Map();
  private architectureElements: Map<string, OslcArchitectureResource> = new Map();
  private server: http.Server | null = null;

  constructor(baseUri: string = "http://localhost:8080") {
    this.baseUri = baseUri.replace(/\/$/, "");
  }

  setBaseUri(uri: string): void {
    this.baseUri = uri.replace(/\/$/, "");
  }

  getBaseUri(): string {
    return this.baseUri;
  }

  // --------------------------------------------------------------------------
  // Ingestion Methods
  // --------------------------------------------------------------------------

  registerRequirement(
    req: Partial<OslcRequirementResource> & { identifier: string; title: string },
  ): OslcRequirementResource {
    const id = req.identifier;
    const uri = req.uri || `${this.baseUri}/oslc/rm/requirements/${encodeURIComponent(id)}`;
    const now = new Date().toISOString();

    const resource: OslcRequirementResource = {
      uri,
      identifier: id,
      title: req.title,
      description: req.description || "",
      status: req.status || "Approved",
      created: req.created || now,
      modified: req.modified || now,
      satisfiedBy: req.satisfiedBy || [],
      verifiedBy: req.verifiedBy || [],
      elaboratedBy: req.elaboratedBy || [],
      attributes: req.attributes || {},
    };

    this.requirements.set(id, resource);
    return resource;
  }

  registerTestResult(
    result: Partial<OslcTestResultResource> & {
      identifier: string;
      title: string;
      status: "Passed" | "Failed" | "Inconclusive" | "Error";
    },
  ): OslcTestResultResource {
    const id = result.identifier;
    const uri = result.uri || `${this.baseUri}/oslc/qm/results/${encodeURIComponent(id)}`;
    const now = new Date().toISOString();

    const resource: OslcTestResultResource = {
      uri,
      identifier: id,
      title: result.title,
      status: result.status,
      created: result.created || now,
      executionDurationMs: result.executionDurationMs || 0,
      verifiesRequirements: result.verifiesRequirements || [],
      testedResources: result.testedResources || [],
      metricValues: result.metricValues || {},
      details: result.details || "",
    };

    this.testResults.set(id, resource);
    return resource;
  }

  registerArchitectureElement(
    elem: Partial<OslcArchitectureResource> & { identifier: string; title: string; domain: string },
  ): OslcArchitectureResource {
    const id = elem.identifier;
    const uri = elem.uri || `${this.baseUri}/oslc/am/elements/${encodeURIComponent(id)}`;
    const now = new Date().toISOString();

    const resource: OslcArchitectureResource = {
      uri,
      identifier: id,
      title: elem.title,
      elementType: elem.elementType || "ModelElement",
      domain: elem.domain,
      format: elem.format || "application/octet-stream",
      created: elem.created || now,
      sourceFile: elem.sourceFile,
      allocates: elem.allocates || [],
      satisfiedRequirements: elem.satisfiedRequirements || [],
      properties: elem.properties || {},
    };

    this.architectureElements.set(id, resource);
    return resource;
  }

  /**
   * Imports an entire OMG ReqIF specification into OSLC-RM requirement resources.
   */
  importReqIf(spec: ReqIfSpecification): void {
    const traverse = (req: ReqIfRequirement, parentUri?: string) => {
      const res = this.registerRequirement({
        identifier: req.id,
        title: req.name || req.id,
        description: req.text || "",
        status: req.status || "Approved",
        satisfiedBy: (req.satisfiedBy || []).map((s) =>
          s.startsWith("http") ? s : `${this.baseUri}/oslc/am/elements/${s}`,
        ),
        verifiedBy: (req.verifiedBy || []).map((v) =>
          v.startsWith("http") ? v : `${this.baseUri}/oslc/qm/results/${v}`,
        ),
        elaboratedBy: parentUri ? [parentUri] : [],
        attributes: {
          ...req.attributes,
          ...(req.asilLevel ? { asilLevel: req.asilLevel } : {}),
          ...(req.limitValue !== undefined ? { limitValue: req.limitValue } : {}),
          ...(req.comparator ? { comparator: req.comparator } : {}),
        },
      });

      if (req.children && req.children.length > 0) {
        for (const child of req.children) {
          traverse(child, res.uri);
        }
      }
    };

    for (const req of spec.requirements) {
      traverse(req);
    }

    // Process explicit relations
    if (spec.relations) {
      for (const rel of spec.relations) {
        const sourceReq = this.requirements.get(rel.sourceId);
        if (sourceReq) {
          const targetUri = rel.targetId.startsWith("http")
            ? rel.targetId
            : `${this.baseUri}/oslc/am/elements/${rel.targetId}`;
          if (rel.type.toLowerCase() === "satisfies" && !sourceReq.satisfiedBy.includes(targetUri)) {
            sourceReq.satisfiedBy.push(targetUri);
          } else if (rel.type.toLowerCase() === "verifies" && !sourceReq.verifiedBy.includes(targetUri)) {
            sourceReq.verifiedBy.push(targetUri);
          }
        }
      }
    }
  }

  /**
   * Imports active hypergraph links into OSLC Architecture Management resources.
   */
  importHypergraph(
    hypergraph: DigitalThreadHypergraph,
    nodeResolver?: (domain: ThreadDomain, nodeId: number) => { name: string; type: string; file?: string },
  ): void {
    const total = hypergraph.getThreadCount();
    for (let slot = 0; slot < total; slot++) {
      if (hypergraph.isRemoved(slot)) continue;
      const rec = hypergraph.getRecord(slot);
      if (!rec) continue;

      const elementsInThread: string[] = [];

      for (let d = 0; d < 8; d++) {
        const nodeId = rec.domainNodes[d];
        if (nodeId) {
          const domainName = ThreadDomain[d] || `Domain_${d}`;
          const resolved = nodeResolver
            ? nodeResolver(d, nodeId)
            : { name: `${domainName}_Node_${nodeId}`, type: "Element" };
          const elemId = `${domainName}_${nodeId}`;
          const elem = this.registerArchitectureElement({
            identifier: elemId,
            title: resolved.name,
            elementType: resolved.type,
            domain: domainName,
            sourceFile: resolved.file,
          });
          elementsInThread.push(elem.uri);
        }
      }

      // Link thread siblings via allocates
      for (const uri of elementsInThread) {
        for (const targetUri of elementsInThread) {
          if (uri !== targetUri) {
            const el = Array.from(this.architectureElements.values()).find((e) => e.uri === uri);
            if (el && !el.allocates.includes(targetUri)) {
              el.allocates.push(targetUri);
            }
          }
        }
      }
    }
  }

  getRequirement(id: string): OslcRequirementResource | undefined {
    return this.requirements.get(id);
  }

  getTestResult(id: string): OslcTestResultResource | undefined {
    return this.testResults.get(id);
  }

  getArchitectureElement(id: string): OslcArchitectureResource | undefined {
    return this.architectureElements.get(id);
  }

  getAllRequirements(): OslcRequirementResource[] {
    return Array.from(this.requirements.values());
  }

  getAllTestResults(): OslcTestResultResource[] {
    return Array.from(this.testResults.values());
  }

  getAllArchitectureElements(): OslcArchitectureResource[] {
    return Array.from(this.architectureElements.values());
  }

  // --------------------------------------------------------------------------
  // Serialization: JSON-LD
  // --------------------------------------------------------------------------

  exportJsonLd(domain: "rm" | "qm" | "am" | "all" = "all"): object {
    const graph: any[] = [];

    if (domain === "rm" || domain === "all") {
      for (const req of this.requirements.values()) {
        const item: any = {
          "@id": req.uri,
          "@type": ["oslc_rm:Requirement", "oslc:Resource"],
          "dcterms:identifier": req.identifier,
          "dcterms:title": req.title,
          "dcterms:description": req.description,
          "oslc:instanceShape": `${this.baseUri}/oslc/shapes/Requirement`,
          "oslc_rm:status": req.status,
          "dcterms:created": req.created,
          "dcterms:modified": req.modified,
        };
        if (req.satisfiedBy.length > 0) {
          item["oslc_rm:satisfiedBy"] = req.satisfiedBy.map((uri) => ({ "@id": uri }));
        }
        if (req.verifiedBy.length > 0) {
          item["oslc_rm:validatedBy"] = req.verifiedBy.map((uri) => ({ "@id": uri }));
        }
        if (req.elaboratedBy.length > 0) {
          item["oslc_rm:elaboratedBy"] = req.elaboratedBy.map((uri) => ({ "@id": uri }));
        }
        if (Object.keys(req.attributes).length > 0) {
          item["ms:attributes"] = req.attributes;
        }
        graph.push(item);
      }
    }

    if (domain === "qm" || domain === "all") {
      for (const res of this.testResults.values()) {
        const item: any = {
          "@id": res.uri,
          "@type": ["oslc_qm:TestResult", "oslc:Resource"],
          "dcterms:identifier": res.identifier,
          "dcterms:title": res.title,
          "oslc_qm:status": res.status,
          "dcterms:created": res.created,
          "oslc_qm:executionDuration": res.executionDurationMs,
          "oslc_qm:reportsOnTestExecutionRecord": res.testedResources.map((uri) => ({ "@id": uri })),
          "oslc_qm:verifiesRequirement": res.verifiesRequirements.map((uri) => ({ "@id": uri })),
        };
        if (Object.keys(res.metricValues).length > 0) {
          item["ms:metricValues"] = res.metricValues;
        }
        if (res.details) {
          item["dcterms:description"] = res.details;
        }
        graph.push(item);
      }
    }

    if (domain === "am" || domain === "all") {
      for (const elem of this.architectureElements.values()) {
        const item: any = {
          "@id": elem.uri,
          "@type": ["oslc_am:Resource", "oslc:Resource"],
          "dcterms:identifier": elem.identifier,
          "dcterms:title": elem.title,
          "dcterms:format": elem.format,
          "ms:domain": elem.domain,
          "ms:elementType": elem.elementType,
          "dcterms:created": elem.created,
        };
        if (elem.sourceFile) {
          item["ms:sourceFile"] = elem.sourceFile;
        }
        if (elem.allocates.length > 0) {
          item["oslc_am:allocates"] = elem.allocates.map((uri) => ({ "@id": uri }));
        }
        if (elem.satisfiedRequirements.length > 0) {
          item["oslc_am:satisfiesRequirement"] = elem.satisfiedRequirements.map((uri) => ({ "@id": uri }));
        }
        if (Object.keys(elem.properties).length > 0) {
          item["ms:properties"] = elem.properties;
        }
        graph.push(item);
      }
    }

    return {
      "@context": {
        ...OSLC_PREFIXES,
      },
      "@graph": graph,
    };
  }

  // --------------------------------------------------------------------------
  // Serialization: RDF Turtle
  // --------------------------------------------------------------------------

  exportTurtle(domain: "rm" | "qm" | "am" | "all" = "all"): string {
    const lines: string[] = [];

    // Prefix declarations
    lines.push("@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .");
    lines.push("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .");
    lines.push("@prefix dcterms: <http://purl.org/dc/terms/> .");
    lines.push("@prefix oslc: <http://open-services.net/ns/core#> .");
    lines.push("@prefix oslc_rm: <http://open-services.net/ns/rm#> .");
    lines.push("@prefix oslc_qm: <http://open-services.net/ns/qm#> .");
    lines.push("@prefix oslc_am: <http://open-services.net/ns/am#> .");
    lines.push("@prefix ms: <https://modelscript.org/ns/thread#> .");
    lines.push("");

    const escapeStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

    if (domain === "rm" || domain === "all") {
      for (const req of this.requirements.values()) {
        lines.push(`<${req.uri}>`);
        lines.push(`    a oslc_rm:Requirement, oslc:Resource ;`);
        lines.push(`    dcterms:identifier "${escapeStr(req.identifier)}" ;`);
        lines.push(`    dcterms:title "${escapeStr(req.title)}" ;`);
        if (req.description) {
          lines.push(`    dcterms:description "${escapeStr(req.description)}" ;`);
        }
        lines.push(`    oslc_rm:status "${escapeStr(req.status)}" ;`);
        lines.push(`    dcterms:created "${req.created}" ;`);
        lines.push(`    dcterms:modified "${req.modified}" ;`);

        for (const sat of req.satisfiedBy) {
          lines.push(`    oslc_rm:satisfiedBy <${sat}> ;`);
        }
        for (const ver of req.verifiedBy) {
          lines.push(`    oslc_rm:validatedBy <${ver}> ;`);
        }
        for (const elab of req.elaboratedBy) {
          lines.push(`    oslc_rm:elaboratedBy <${elab}> ;`);
        }

        // Strip trailing semicolon from last statement and terminate with dot
        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].replace(/ ;$/, " .");
        lines.push("");
      }
    }

    if (domain === "qm" || domain === "all") {
      for (const res of this.testResults.values()) {
        lines.push(`<${res.uri}>`);
        lines.push(`    a oslc_qm:TestResult, oslc:Resource ;`);
        lines.push(`    dcterms:identifier "${escapeStr(res.identifier)}" ;`);
        lines.push(`    dcterms:title "${escapeStr(res.title)}" ;`);
        lines.push(`    oslc_qm:status "${escapeStr(res.status)}" ;`);
        lines.push(`    dcterms:created "${res.created}" ;`);
        lines.push(`    oslc_qm:executionDuration ${res.executionDurationMs} ;`);

        for (const reqUri of res.verifiesRequirements) {
          lines.push(`    oslc_qm:verifiesRequirement <${reqUri}> ;`);
        }
        for (const testUri of res.testedResources) {
          lines.push(`    oslc_qm:reportsOnTestExecutionRecord <${testUri}> ;`);
        }
        if (res.details) {
          lines.push(`    dcterms:description "${escapeStr(res.details)}" ;`);
        }

        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].replace(/ ;$/, " .");
        lines.push("");
      }
    }

    if (domain === "am" || domain === "all") {
      for (const elem of this.architectureElements.values()) {
        lines.push(`<${elem.uri}>`);
        lines.push(`    a oslc_am:Resource, oslc:Resource ;`);
        lines.push(`    dcterms:identifier "${escapeStr(elem.identifier)}" ;`);
        lines.push(`    dcterms:title "${escapeStr(elem.title)}" ;`);
        lines.push(`    dcterms:format "${escapeStr(elem.format)}" ;`);
        lines.push(`    ms:domain "${escapeStr(elem.domain)}" ;`);
        lines.push(`    ms:elementType "${escapeStr(elem.elementType)}" ;`);
        lines.push(`    dcterms:created "${elem.created}" ;`);

        if (elem.sourceFile) {
          lines.push(`    ms:sourceFile "${escapeStr(elem.sourceFile)}" ;`);
        }
        for (const alloc of elem.allocates) {
          lines.push(`    oslc_am:allocates <${alloc}> ;`);
        }
        for (const sat of elem.satisfiedRequirements) {
          lines.push(`    oslc_am:satisfiesRequirement <${sat}> ;`);
        }

        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].replace(/ ;$/, " .");
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  // --------------------------------------------------------------------------
  // Embedded HTTP REST Server with Content Negotiation
  // --------------------------------------------------------------------------

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const acceptHeader = (req.headers["accept"] || "").toLowerCase();

    const prefersTurtle = acceptHeader.includes("text/turtle");
    const prefersJsonLd = acceptHeader.includes("application/ld+json");

    const sendResponse = (
      statusCode: number,
      data: any,
      isGraphOrTurtle: boolean = false,
      domain: "rm" | "qm" | "am" | "all" = "all",
    ) => {
      if (prefersTurtle) {
        res.writeHead(statusCode, {
          "Content-Type": "text/turtle; charset=utf-8",
          "OSLC-Core-Version": "3.0",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(isGraphOrTurtle ? this.exportTurtle(domain) : data);
      } else if (prefersJsonLd) {
        res.writeHead(statusCode, {
          "Content-Type": "application/ld+json; charset=utf-8",
          "OSLC-Core-Version": "3.0",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(isGraphOrTurtle ? this.exportJsonLd(domain) : data, null, 2));
      } else {
        res.writeHead(statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          "OSLC-Core-Version": "3.0",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(data, null, 2));
      }
    };

    // Route: Root / Catalog
    if (pathname === "/" || pathname === "/oslc/catalog") {
      const catalog = {
        "@context": { ...OSLC_PREFIXES },
        "@id": `${this.baseUri}/oslc/catalog`,
        "@type": ["oslc:ServiceProviderCatalog"],
        "dcterms:title": "ModelScript OSLC Gateway Catalog",
        "dcterms:description":
          "Federated OSLC Core 3.0 Gateway for Requirements, Simulation QM, and Multi-Domain Architecture Models",
        "oslc:serviceProvider": [
          {
            "@id": `${this.baseUri}/oslc/rm/provider`,
            "@type": "oslc:ServiceProvider",
            "dcterms:title": "Requirements Management Service Provider (OSLC-RM)",
            "oslc:details": `${this.baseUri}/oslc/rm/requirements`,
          },
          {
            "@id": `${this.baseUri}/oslc/qm/provider`,
            "@type": "oslc:ServiceProvider",
            "dcterms:title": "Quality & Verification Management Service Provider (OSLC-QM)",
            "oslc:details": `${this.baseUri}/oslc/qm/results`,
          },
          {
            "@id": `${this.baseUri}/oslc/am/provider`,
            "@type": "oslc:ServiceProvider",
            "dcterms:title": "Architecture & Digital Thread Service Provider (OSLC-AM)",
            "oslc:details": `${this.baseUri}/oslc/am/elements`,
          },
        ],
      };
      return sendResponse(200, catalog, false);
    }

    // Route: OSLC-RM Requirements
    if (pathname === "/oslc/rm/requirements") {
      if (req.method === "GET") {
        return sendResponse(200, Array.from(this.requirements.values()), true, "rm");
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const created = this.registerRequirement(parsed);
            res.writeHead(201, {
              Location: created.uri,
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify(created, null, 2));
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
    }

    if (pathname.startsWith("/oslc/rm/requirements/")) {
      const id = decodeURIComponent(pathname.replace("/oslc/rm/requirements/", ""));
      const reqResource = this.requirements.get(id);
      if (!reqResource) {
        return sendResponse(404, { error: `Requirement not found: ${id}` });
      }
      return sendResponse(200, reqResource);
    }

    // Route: OSLC-QM Test Results
    if (pathname === "/oslc/qm/results") {
      if (req.method === "GET") {
        return sendResponse(200, Array.from(this.testResults.values()), true, "qm");
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const created = this.registerTestResult(parsed);
            res.writeHead(201, {
              Location: created.uri,
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify(created, null, 2));
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
    }

    if (pathname.startsWith("/oslc/qm/results/")) {
      const id = decodeURIComponent(pathname.replace("/oslc/qm/results/", ""));
      const result = this.testResults.get(id);
      if (!result) {
        return sendResponse(404, { error: `TestResult not found: ${id}` });
      }
      return sendResponse(200, result);
    }

    // Route: OSLC-AM Elements
    if (pathname === "/oslc/am/elements") {
      if (req.method === "GET") {
        return sendResponse(200, Array.from(this.architectureElements.values()), true, "am");
      }
    }

    if (pathname.startsWith("/oslc/am/elements/")) {
      const id = decodeURIComponent(pathname.replace("/oslc/am/elements/", ""));
      const elem = this.architectureElements.get(id);
      if (!elem) {
        return sendResponse(404, { error: `Architecture element not found: ${id}` });
      }
      return sendResponse(200, elem);
    }

    // Route not found
    sendResponse(404, { error: "Resource Not Found" });
  }

  /**
   * Starts the embedded OSLC HTTP server.
   */
  async startServer(port: number = 8080, host: string = "localhost"): Promise<number> {
    if (this.server) {
      return (this.server.address() as any).port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, host, () => {
        const address = this.server!.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        this.setBaseUri(`http://${host}:${actualPort}`);
        resolve(actualPort);
      });
      this.server.on("error", reject);
    });
  }

  /**
   * Stops the embedded OSLC HTTP server.
   */
  async stopServer(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
