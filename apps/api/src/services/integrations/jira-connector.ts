// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SpaceEcoProposalRecord, SpaceIssueRecord, SpaceRecord } from "../../database.js";
import type { EcoSimulationResult } from "../spaces/eco-simulation-gate-service.js";

/**
 * Authentication options for Jira REST API.
 * Jira Cloud: requires email + apiToken (HTTP Basic Auth).
 * Jira Server / Data Center: requires apiToken / PAT (HTTP Bearer Auth).
 */
export interface JiraAuthOptions {
  email?: string | undefined;
  apiToken: string;
}

export interface JiraConnectorConfig {
  baseUrl: string;
  auth: JiraAuthOptions;
  timeoutMs?: number | undefined;
}

export interface JiraSearchOptions {
  jql?: string | undefined;
  maxResults?: number | undefined;
  startAt?: number | undefined;
  fields?: string[] | undefined;
}

export interface NormalizedJiraIssue {
  key: string;
  id: string;
  title: string;
  description: string;
  status: "open" | "closed";
  rawStatus: string;
  statusCategory: string;
  severity: SpaceIssueRecord["severity"];
  rawPriority: string;
  assignee: { displayName?: string | undefined; emailAddress?: string | undefined; name?: string | undefined } | null;
  creator: { displayName?: string | undefined; emailAddress?: string | undefined; name?: string | undefined } | null;
  labels: string[];
  impactedModels: string[];
  browseUrl: string;
  updatedAt: string;
  createdAt: string;
}

export interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: NormalizedJiraIssue[];
}

/**
 * Lightweight Atlassian Document Format (ADF) to standard GitHub-Flavored Markdown converter.
 * Handles nested ADF blocks (paragraphs, lists, codeblocks, tables, marks) and falls back gracefully.
 */
export function parseAdfToMarkdown(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") {
    // If it's already a string, check if it's JSON-encoded ADF
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "doc") {
          return parseAdfNode(parsed).trim();
        }
      } catch {
        // Not valid JSON, treat as raw text
      }
    }
    return content;
  }
  if (typeof content === "object") {
    return parseAdfNode(content as AdfNode).trim();
  }
  return String(content);
}

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown> | undefined;
}

interface AdfNode {
  type: string;
  text?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  content?: AdfNode[] | undefined;
  marks?: AdfMark[] | undefined;
}

function parseAdfNode(node: AdfNode): string {
  if (!node) return "";

  if (node.type === "text") {
    let txt = node.text || "";
    if (node.marks && Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === "strong") txt = `**${txt}**`;
        else if (mark.type === "em") txt = `*${txt}*`;
        else if (mark.type === "code") txt = `\`${txt}\``;
        else if (mark.type === "strike") txt = `~~${txt}~~`;
        else if (mark.type === "link" && mark.attrs?.["href"]) {
          txt = `[${txt}](${String(mark.attrs["href"])})`;
        }
      }
    }
    return txt;
  }

  const children = (node.content || []).map((c) => parseAdfNode(c));

  switch (node.type) {
    case "doc":
      return children.join("\n\n");
    case "paragraph":
      return children.join("");
    case "heading": {
      const level = Number(node.attrs?.["level"]);
      const prefix =
        level === 1 ? "#" :
        level === 2 ? "##" :
        level === 3 ? "###" :
        level === 4 ? "####" :
        level === 5 ? "#####" :
        level === 6 ? "######" : "#";
      return `${prefix} ${children.join("")}`;
    }
    case "bulletList":
      return children.map((c) => `* ${c}`).join("\n");
    case "orderedList":
      return children.map((c, i) => `${i + 1}. ${c}`).join("\n");
    case "listItem":
      return children.join("\n  ");
    case "codeBlock": {
      const lang = String(node.attrs?.["language"] || "");
      return `\`\`\`${lang}\n${children.join("")}\n\`\`\``;
    }
    case "blockquote":
      return children.map((c) => `> ${c}`).join("\n");
    case "rule":
      return "---";
    case "hardBreak":
      return "\n";
    case "table":
      return children.join("\n");
    case "tableRow":
      return `| ${children.join(" | ")} |`;
    case "tableHeader":
    case "tableCell":
      return children.join(" ");
    case "inlineCard":
    case "blockCard": {
      const url = String(node.attrs?.["url"] || "");
      return url ? `[${url}](${url})` : "";
    }
    default:
      return children.join("");
  }
}

/**
 * Extracts physical model, component, or subsystem identifiers from issue text or custom fields.
 * Supports patterns such as:
 * - @model:Modelica.Electrical.Analog.Basic.Resistor
 * - model: Aerospace.Propulsion.Compressor
 * - component: Valve
 * - subsystem: FlightControl
 */
export function extractImpactedModels(text: string, customFieldValue?: string | string[] | null | undefined): string[] {
  const models = new Set<string>();

  if (customFieldValue) {
    if (Array.isArray(customFieldValue)) {
      for (const item of customFieldValue) {
        if (typeof item === "string" && item.trim()) {
          models.add(item.trim());
        }
      }
    } else if (typeof customFieldValue === "string") {
      const parts = customFieldValue.split(/[\s,;]+/);
      for (const p of parts) {
        if (p.trim()) models.add(p.trim());
      }
    }
  }

  if (text) {
    // 1. Explicit tags: @model:..., model:..., component:..., subsystem:...
    const tagRegex = /(?:@model:|model:|component:|subsystem:)\s*([a-zA-Z0-9_.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(text)) !== null) {
      if (match[1]) {
        const cleaned = match[1].replace(/[.,;:!?)\]}]+$/, "").trim();
        if (cleaned.length > 1) {
          models.add(cleaned);
        }
      }
    }

    // 2. FQN code patterns in backticks, e.g. `Modelica.Fluid.Valves.TwoWay`
    const codeRegex = /`([A-Z][a-zA-Z0-9_]+(?:\.[A-Z][a-zA-Z0-9_]+)+)`/g;
    while ((match = codeRegex.exec(text)) !== null) {
      if (match[1]) {
        const cleaned = match[1].replace(/[.,;:!?)\]}]+$/, "").trim();
        if (cleaned.length > 1) {
          models.add(cleaned);
        }
      }
    }
  }

  return Array.from(models);
}

/**
 * Maps Jira priorities to Ansatz severity levels.
 */
export function mapJiraPriorityToSeverity(priorityName: string | undefined | null): SpaceIssueRecord["severity"] {
  const p = (priorityName || "").toLowerCase().trim();
  if (p === "blocker" || p === "highest" || p === "critical" || p === "safety") {
    return "safety_critical";
  }
  if (p === "high" || p === "urgent") {
    return "major";
  }
  if (p === "low" || p === "lowest" || p === "trivial" || p === "minor") {
    return "minor";
  }
  return "standard";
}

/**
 * Maps Jira status categories and names to Ansatz open/closed issue status.
 */
export function mapJiraStatusToState(
  statusCategoryKey: string | undefined | null,
  statusName: string | undefined | null,
): "open" | "closed" {
  const cat = (statusCategoryKey || "").toLowerCase().trim();
  const name = (statusName || "").toLowerCase().trim();

  if (cat === "done" || cat === "complete" || cat === "closed") {
    return "closed";
  }
  if (name === "closed" || name === "done" || name === "resolved" || name === "verified" || name === "finished") {
    return "closed";
  }
  return "open";
}

/**
 * Connector client for Atlassian Jira Cloud & Data Center REST APIs.
 */
export class JiraConnector {
  readonly #baseUrl: string;
  readonly #auth: JiraAuthOptions;
  readonly #timeoutMs: number;

  constructor(config: JiraConnectorConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#auth = config.auth;
    this.#timeoutMs = config.timeoutMs || 15000;
  }

  #getAuthHeader(): string {
    if (this.#auth.email) {
      // Jira Cloud: Basic Auth (email:token)
      const creds = Buffer.from(`${this.#auth.email}:${this.#auth.apiToken}`, "utf-8").toString("base64");
      return `Basic ${creds}`;
    }
    // Jira Data Center / Personal Access Token: Bearer Auth
    return `Bearer ${this.#auth.apiToken}`;
  }

  async #fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: this.#getAuthHeader(),
          ...(init?.headers || {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Searches Jira issues using JQL query.
   */
  async searchIssues(
    options?: JiraSearchOptions & { modelCustomField?: string | undefined },
  ): Promise<JiraSearchResponse> {
    const jql = options?.jql || "ORDER BY updated DESC";
    const maxResults = Math.min(Math.max(options?.maxResults || 25, 1), 100);
    const startAt = Math.max(options?.startAt || 0, 0);

    const fields = [
      "summary",
      "description",
      "status",
      "priority",
      "assignee",
      "creator",
      "labels",
      "created",
      "updated",
      ...(options?.fields || []),
      ...(options?.modelCustomField ? [options.modelCustomField] : []),
    ];

    const endpoint = `${this.#baseUrl}/rest/api/3/search`;
    const body = JSON.stringify({
      jql,
      maxResults,
      startAt,
      fields,
    });

    let res = await this.#fetchWithTimeout(endpoint, {
      method: "POST",
      body,
    });

    // Fallback to REST API v2 if Jira Server/DC instance doesn't have v3
    if (res.status === 404) {
      const v2Endpoint = `${this.#baseUrl}/rest/api/2/search`;
      res = await this.#fetchWithTimeout(v2Endpoint, {
        method: "POST",
        body,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Jira search failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = (await res.json()) as {
      startAt?: number;
      maxResults?: number;
      total?: number;
      issues?: Array<Record<string, unknown>>;
    };

    const issues: NormalizedJiraIssue[] = (data.issues || []).map((raw) =>
      this.normalizeIssue(raw, options?.modelCustomField),
    );

    return {
      startAt: Number(data.startAt || 0),
      maxResults: Number(data.maxResults || maxResults),
      total: Number(data.total || issues.length),
      issues,
    };
  }

  /**
   * Normalizes a raw Jira issue object into Ansatz format.
   */
  normalizeIssue(raw: Record<string, unknown>, modelCustomField?: string): NormalizedJiraIssue {
    const key = String(raw["key"] || "");
    const id = String(raw["id"] || "");
    const fields = (raw["fields"] as Record<string, unknown>) || {};

    const title = String(fields["summary"] || `Jira Issue ${key}`);
    const rawDesc = fields["description"];
    const description = parseAdfToMarkdown(rawDesc);

    const statusObj = (fields["status"] as Record<string, unknown>) || {};
    const rawStatus = String(statusObj["name"] || "Open");
    const statusCategoryObj = (statusObj["statusCategory"] as Record<string, unknown>) || {};
    const statusCategory = String(statusCategoryObj["key"] || "");
    const status = mapJiraStatusToState(statusCategory, rawStatus);

    const priorityObj = (fields["priority"] as Record<string, unknown>) || {};
    const rawPriority = String(priorityObj["name"] || "Medium");
    const severity = mapJiraPriorityToSeverity(rawPriority);

    const rawLabels = fields["labels"];
    const labels: string[] = Array.isArray(rawLabels) ? rawLabels.map(String) : [];

    const customFieldValue = modelCustomField ? (fields[modelCustomField] as string | string[]) : undefined;
    const combinedText = `${title}\n${description}`;
    const impactedModels = extractImpactedModels(combinedText, customFieldValue);

    const assigneeObj = fields["assignee"] as Record<string, unknown> | null;
    const creatorObj = fields["creator"] as Record<string, unknown> | null;

    const browseUrl = `${this.#baseUrl}/browse/${key}`;

    return {
      key,
      id,
      title,
      description,
      status,
      rawStatus,
      statusCategory,
      severity,
      rawPriority,
      assignee: assigneeObj
        ? {
            displayName: assigneeObj["displayName"] ? String(assigneeObj["displayName"]) : undefined,
            emailAddress: assigneeObj["emailAddress"] ? String(assigneeObj["emailAddress"]) : undefined,
            name: assigneeObj["name"] ? String(assigneeObj["name"]) : undefined,
          }
        : null,
      creator: creatorObj
        ? {
            displayName: creatorObj["displayName"] ? String(creatorObj["displayName"]) : undefined,
            emailAddress: creatorObj["emailAddress"] ? String(creatorObj["emailAddress"]) : undefined,
            name: creatorObj["name"] ? String(creatorObj["name"]) : undefined,
          }
        : null,
      labels,
      impactedModels,
      browseUrl,
      updatedAt: String(fields["updated"] || new Date().toISOString()),
      createdAt: String(fields["created"] || new Date().toISOString()),
    };
  }

  /**
   * Posts an automated verification or status comment to Jira.
   */
  async postVerificationComment(issueKeyOrId: string, commentMarkdown: string): Promise<{ id: string }> {
    const endpoint = `${this.#baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}/comment`;

    // ADF payload for comment
    const adfBody = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: commentMarkdown,
              },
            ],
          },
        ],
      },
    };

    let res = await this.#fetchWithTimeout(endpoint, {
      method: "POST",
      body: JSON.stringify(adfBody),
    });

    if (res.status === 404 || res.status === 400) {
      // Fallback to v2 plain text body
      const v2Endpoint = `${this.#baseUrl}/rest/api/2/issue/${encodeURIComponent(issueKeyOrId)}/comment`;
      res = await this.#fetchWithTimeout(v2Endpoint, {
        method: "POST",
        body: JSON.stringify({ body: commentMarkdown }),
      });
    }

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Failed to post comment to Jira (${res.status}): ${err || res.statusText}`);
    }

    const data = (await res.json()) as { id?: string };
    return { id: String(data.id || "") };
  }
}

/**
 * Formats a Modelica / physics simulation verification comment for Jira.
 */
export function formatSimulationVerificationComment(
  eco: { eco_number: number; title: string },
  sim: EcoSimulationResult,
): string {
  const isPassed = sim.gateStatus === "passed";
  const checksMarkdown =
    sim.checks && sim.checks.length > 0
      ? sim.checks
          .map(
            (c) =>
              `- **${c.name}**: ${c.status === "passed" ? "PASSED ✅" : "FAILED ❌"} (Value: \`${c.value}\`, Margin: \`${c.margin}\`)`,
          )
          .join("\n")
      : "- Automated verification suite evaluated.";

  return [
    `### ⚡ Ansatz Simulation Verification Gate: ${isPassed ? "PASSED" : "FAILED"}`,
    "",
    `* **ECO**: #${eco.eco_number} "${eco.title}"`,
    `* **Gate Status**: ${isPassed ? "PASSED ✅" : "FAILED ❌"}`,
    `* **Solver**: ${sim.solver}`,
    `* **Max Relative Error**: \`${sim.maxRelError}\` (Tolerance: \`${sim.tolerance}\`)`,
    `* **Model Topology**: ${sim.variablesCount} Variables / ${sim.equationsCount} DAE Equations`,
    `* **Verification Timestamp**: ${sim.checkedAt}`,
    "",
    "#### Multi-Theory Physics Checks:",
    checksMarkdown,
    "",
    "*Automated simulation verification generated by [Ansatz Collaborative Systems Engineering Cloud](https://ansatz.social).* ",
  ].join("\n");
}

/**
 * Inspects an ECO and writes verification comments to any linked Jira tickets if configured.
 */
export async function postAutomatedSimulationCommentsIfConfigured(params: {
  space: SpaceRecord;
  eco: SpaceEcoProposalRecord;
  simulation: EcoSimulationResult;
  issues: SpaceIssueRecord[];
}): Promise<string[]> {
  const settings = params.space.settings?.["jira"] as Record<string, unknown> | undefined;
  if (!settings) return [];
  if (settings["autoCommentOnSimulation"] === false) return [];

  const baseUrl = String(settings["baseUrl"] ?? settings["jiraBaseUrl"] ?? "").trim();
  const apiToken = String(settings["apiToken"] ?? "").trim();
  const email = settings["email"] ? String(settings["email"]).trim() : undefined;

  if (!baseUrl || !apiToken) return [];

  const connector = new JiraConnector({
    baseUrl,
    auth: { email, apiToken },
  });

  const commentedKeys: string[] = [];
  const comment = formatSimulationVerificationComment(params.eco, params.simulation);

  for (const issue of params.issues) {
    if (issue.external_source !== "jira" || !issue.external_key) continue;

    const matchesPR = issue.linked_pr_number === params.eco.eco_number;
    const matchesModels = issue.impacted_models.some((m) => params.eco.impacted_models.includes(m));
    const matchesText =
      params.eco.title.includes(issue.external_key) || params.eco.description.includes(issue.external_key);

    if (matchesPR || matchesModels || matchesText) {
      try {
        await connector.postVerificationComment(issue.external_key, comment);
        commentedKeys.push(issue.external_key);
      } catch (err) {
        console.warn(`[JiraConnector] Failed to write simulation gate comment to ${issue.external_key}:`, err);
      }
    }
  }

  return commentedKeys;
}
