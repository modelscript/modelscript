// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AI Bot Markdown Mirror & llms.txt Route (llmstxt.org specification)
 *
 * Exposes high-density, token-efficient, clean Markdown endpoints for:
 *   - /posts/:id.md
 *   - /package/:scope?/:name.md
 *   - /package/:scope?/:name/classes/:className.md
 *   - /packages/llms.txt
 *   - /package/:scope?/:name/llms.txt
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { extractPostTitle } from "../util/og-renderer.js";
import { resolveRequestHost } from "../util/seo-injector.js";
import { isCorporateOrAirgapTier } from "../util/tier-presets.js";

export function markdownMirrorRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  function getParam(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0] || "";
    return param || "";
  }

  function getBaseContext(req: Request) {
    const settings = database.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    const host = resolveRequestHost(req);
    const isCorporate = isCorporateOrAirgapTier(settings);
    return { brandName, host, isCorporate };
  }

  // Content-negotiation: Intercept requests sending Accept: text/markdown
  router.use((req: Request, res: Response, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const acceptHeader = req.headers["accept"] || "";
    if (acceptHeader.includes("text/markdown")) {
      const postMatch = req.path.match(/^\/(?:posts|p)\/(\d+)$/);
      if (postMatch && postMatch[1]) {
        req.params = { id: postMatch[1] };
        return handlePostMarkdown(req, res);
      }
      const classMatch = req.path.match(/^\/packages?\/(@[^/]+\/[^/]+|[^/]+)(?:\/(?:v\/)?([^/]+))?\/classes\/([^/]+)$/);
      if (classMatch) {
        const full = classMatch[1]!;
        const scope = full.startsWith("@") ? full.split("/")[0] : undefined;
        const name = full.startsWith("@") ? full.split("/")[1] : full;
        req.params = {
          scope: scope as string,
          name: name as string,
          version: classMatch[2] as string,
          className: classMatch[3] as string,
        };
        return handleClassMarkdown(req, res);
      }
      const pkgMatch = req.path.match(/^\/packages?\/(@[^/]+\/[^/]+|[^/]+)$/);
      if (pkgMatch) {
        const full = pkgMatch[1]!;
        const scope = full.startsWith("@") ? full.split("/")[0] : undefined;
        const name = full.startsWith("@") ? full.split("/")[1] : full;
        req.params = { scope: scope as string, name: name as string };
        return handlePackageMarkdown(req, res);
      }
    }
    next();
  });

  // ── Post Markdown Mirror: /posts/:id.md or /p/:id.md ──
  const handlePostMarkdown = (req: Request, res: Response): void => {
    const rawId = getParam(req.params["id"]).replace(/\.md$/, "");
    const postId = Number(rawId);
    if (!postId || isNaN(postId)) {
      res.status(400).send("Invalid post ID");
      return;
    }

    const { brandName, host, isCorporate } = getBaseContext(req);
    const post = database.getPost(postId);
    if (!post) {
      res.status(404).send("# 404 Not Found\n\nPost does not exist.");
      return;
    }

    const title = extractPostTitle(post, "Engineering Simulation Post");
    const author = post.display_name || post.username || "Engineer";
    const authorUrl = `${host}/u/${post.username || ""}`;
    const postUrl = `${host}/posts/${postId}`;
    const pubDate = post.created_at || new Date().toISOString();

    let md = `---
title: "${title.replace(/"/g, '\\"')}"
author: "${author.replace(/"/g, '\\"')}"
author_url: "${authorUrl}"
date: "${pubDate}"
canonical_url: "${postUrl}"
platform: "${brandName}"
format: "text/markdown"
---

# ${title}

> Author: [${author}](${authorUrl}) | Published: ${pubDate} | Platform: [${brandName}](${host})
> Interactive URL: ${postUrl}

## Content

${post.content || "(No textual content)"}
`;

    if (post.artifact_view_id) {
      try {
        const art = database.getArtifactView(Number(post.artifact_view_id));
        if (art) {
          md += `\n## Attached Engineering Artifact: ${art.title || art.view_type}
- **Artifact Type**: \`${art.view_type}\`
- **Interactive WebAssembly View**: [Launch Simulator](${host}/render-artifact/${art.id})
`;
        }
      } catch {
        // ignore
      }
    }

    // Add BibTeX academic citation block for AI agents
    const citeKey = `ansatz_post_${postId}`;
    md += `\n## Citation (BibTeX)
\`\`\`bibtex
@article{${citeKey},
  author = {${author}},
  title = {{${title}}},
  journal = {${brandName} Engineering Network},
  year = {${new Date(pubDate).getFullYear()}},
  url = {${postUrl}}
}
\`\`\`
`;

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", isCorporate ? "private, no-store" : "public, max-age=3600");
    res.send(md);
  };

  router.get("/posts/:id.md", handlePostMarkdown);
  router.get("/p/:id.md", handlePostMarkdown);

  // ── Class Specification Markdown Mirror ──
  const handleClassMarkdown = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawName = getParam(req.params["name"]);
    const version = getParam(req.params["version"]);
    let className = getParam(req.params["className"]).replace(/\.md$/, "");

    if (!rawName || !className) {
      res.status(400).send("Missing package name or class name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${rawName}` : rawName;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const targetVersion =
      version || (versions.length > 0 ? versions[versions.length - 1]?.version : "1.0.0") || "1.0.0";
    const cls = database.getClass(fullPkgName, targetVersion, className);

    if (!cls) {
      res
        .status(404)
        .send(
          `# 404 Not Found\n\nClass \`${className}\` not found in package \`${fullPkgName}\` version \`${targetVersion}\`.`,
        );
      return;
    }

    const shortName = className.split(".").pop() ?? className;
    const stereotype = cls.classKind || "model";
    const classUrl = `${host}/package/${fullPkgName}/classes/${className}`;

    let md = `---
title: "${className} (${stereotype})"
package: "${fullPkgName}"
version: "${targetVersion}"
stereotype: "${stereotype}"
canonical_url: "${classUrl}"
platform: "${brandName}"
---

# ${className}

> Package: [${fullPkgName}](${host}/package/${fullPkgName}) | Version: \`${targetVersion}\` | Stereotype: \`«${stereotype}»\`
> Interactive Simulator: ${classUrl}

## Description
${cls.description || cls.documentation || "Ideal physical modeling component."}
`;

    if (cls.extends && cls.extends.length > 0) {
      md += `\n## Inheritance / Extends
${cls.extends.map((e) => `- \`${e}\``).join("\n")}
`;
    }

    const ports = (cls.components || []).filter(
      (c) => c.causality === "input" || c.causality === "output" || c.causality === "connector",
    );
    if (ports.length > 0) {
      md += `\n## Interface & Connectors (${ports.length})
| Name | Type | Causality | Description |
|---|---|---|---|
`;
      for (const p of ports) {
        md += `| \`${p.component_name}\` | \`${p.type_name}\` | ${p.causality || "connector"} | ${p.description || "—"} |\n`;
      }
    }

    const params = (cls.components || []).filter((c) => c.variability === "parameter" || c.variability === "constant");
    if (params.length > 0) {
      md += `\n## Parameters (${params.length})
| Parameter | Type | Variability | Description |
|---|---|---|---|
`;
      for (const p of params) {
        md += `| \`${p.component_name}\` | \`${p.type_name}\` | ${p.variability || "parameter"} | ${p.description || "—"} |\n`;
      }
    }

    const locals = (cls.components || []).filter(
      (c) =>
        c.causality !== "input" &&
        c.causality !== "output" &&
        c.causality !== "connector" &&
        c.variability !== "parameter" &&
        c.variability !== "constant",
    );
    if (locals.length > 0) {
      md += `\n## Internal Components / Variables (${locals.length})
| Variable | Type | Description |
|---|---|---|
`;
      for (const c of locals) {
        md += `| \`${c.component_name}\` | \`${c.type_name}\` | ${c.description || "—"} |\n`;
      }
    }

    // Mathematical definition & BibTeX citation
    md += `\n## Execution & Linear DAE Lowering
This model is compiled to linear WebAssembly DAE structures for real-time simulation using SUNDIALS CVODE, IDA, or WebGPU batched integrators.

\`\`\`bibtex
@software{ansatz_${fullPkgName.replace(/[^a-zA-Z0-9]/g, "_")}_${shortName},
  author = {${brandName} Registry},
  title = {{${className}: ${stereotype} specification in ${fullPkgName}}},
  version = {${targetVersion}},
  url = {${classUrl}}
}
\`\`\`
`;

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", isCorporate ? "private, no-store" : "public, max-age=86400");
    res.send(md);
  };

  router.get("/package/:scope/:name/classes/:className.md", handleClassMarkdown);
  router.get("/package/:name/classes/:className.md", handleClassMarkdown);
  router.get("/package/:scope/:name/v/:version/classes/:className.md", handleClassMarkdown);
  router.get("/package/:name/v/:version/classes/:className.md", handleClassMarkdown);

  // ── Package Manifest Markdown Mirror ──
  const handlePackageMarkdown = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    let rawName = getParam(req.params["name"]).replace(/\.md$/, "");
    if (!rawName) {
      res.status(400).send("Missing package name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${rawName}` : rawName;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
    const version = latest?.version || "1.0.0";
    const license = pkg?.license || "AGPL-3.0-or-later";
    const classes = database.getClasses(fullPkgName, version);

    let md = `---
title: "${fullPkgName} (v${version})"
package: "${fullPkgName}"
version: "${version}"
license: "${license}"
canonical_url: "${host}/package/${fullPkgName}"
platform: "${brandName}"
---

# ${fullPkgName}

> Version: \`${version}\` | License: \`${license}\`
> Web URL: ${host}/package/${fullPkgName}

## Description
${pkg?.description || "High-performance computational engineering package."}

## Installation
Install using ModelScript CLI:
\`\`\`bash
msx install ${fullPkgName}
\`\`\`

## Indexed Models & Classes (${classes.length})
`;

    for (const c of classes) {
      const classDoc = c.description ? ` — ${c.description}` : "";
      md += `- [${c.class_name}](${host}/package/${fullPkgName}/classes/${c.class_name}.md) (\`«${c.class_kind}»\`)${classDoc}\n`;
    }

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", isCorporate ? "private, no-store" : "public, max-age=86400");
    res.send(md);
  };

  router.get("/package/:scope/:name.md", handlePackageMarkdown);
  router.get("/package/:name.md", handlePackageMarkdown);

  // ── llms.txt Registry Directory (llmstxt.org standard) ──
  router.get("/packages/llms.txt", (req: Request, res: Response): void => {
    const { brandName, host, isCorporate } = getBaseContext(req);
    const packages = database.listPackages();

    let txt = `# ${brandName} Package Registry
> The Federated Scientific & Engineering Network for Executable Polyglot Physical Modeling.
> Documentation & Specifications for LLMs and AI Agents.

## Overview
This registry hosts computable, reproducible engineering libraries across Modelica, SysML v2, STEP CAD, and simulation formats. All models compile to WebAssembly linear memory DAE arenas for real-time simulation.

## Published Packages (${packages.length})
`;

    for (const p of packages) {
      const v = p.latest_version ? ` (v${p.latest_version})` : "";
      const desc = p.description ? `: ${p.description.slice(0, 100)}` : "";
      txt += `- [${p.name}](${host}/package/${p.name}.md)${v}${desc}\n`;
    }

    txt += `\n## LLM API Endpoints
- Append \`.md\` to any package or class URL to retrieve high-density Markdown representation.
- Class Markdown URL: \`${host}/package/{name}/classes/{className}.md\`
`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", isCorporate ? "private, no-store" : "public, max-age=86400");
    res.send(txt);
  });

  // ── Per-Package llms.txt ──
  const handlePackageLlmsTxt = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawName = getParam(req.params["name"]);
    const fullPkgName = scope ? `${scope}/${rawName}` : rawName;
    const { host, isCorporate } = getBaseContext(req);

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
    const version = latest?.version || "1.0.0";
    const license = pkg?.license || "AGPL-3.0-or-later";
    const classes = database.getClasses(fullPkgName, version);

    let txt = `# Package: ${fullPkgName}
> Version: ${version}
> License: ${license}
> Description: ${pkg?.description || "Engineering library"}

## Models & Interfaces (${classes.length})
`;

    for (const c of classes) {
      const desc = c.description ? ` — ${c.description}` : "";
      txt += `- [${c.class_name}](${host}/package/${fullPkgName}/classes/${c.class_name}.md): \`«${c.class_kind}»\`${desc}\n`;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", isCorporate ? "private, no-store" : "public, max-age=86400");
    res.send(txt);
  };

  router.get("/package/:scope/:name/llms.txt", handlePackageLlmsTxt);
  router.get("/package/:name/llms.txt", handlePackageLlmsTxt);

  return router;
}
