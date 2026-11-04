// SPDX-License-Identifier: AGPL-3.0-or-later

import { isNotebookPost } from "./notebook";

export interface PostLayoutTarget {
  content?: string | null | undefined;
  quote_post?: unknown;
  artifact_view_id?: unknown;
  artifact_view?: { view_type?: string | null | undefined } | null | undefined;
  artifact_type?: string | null | undefined;
  metadata?: { notebook?: unknown; [key: string]: unknown } | null | undefined;
  [key: string]: unknown;
}

/**
 * Predicts the rendered vertical height (in pixels) of a post before DOM measurement.
 * Used by @tanstack/react-virtual to prevent scrollbar jumping, layout shifts,
 * and thrashing in virtualized feeds.
 */
export function estimatePostHeight(post: PostLayoutTarget | null | undefined): number {
  if (!post) return 180;

  // Articles / interactive engineering deep-dives
  if (post.metadata?.notebook || isNotebookPost(post as Parameters<typeof isNotebookPost>[0])) {
    return 660;
  }

  // Base overhead: Author header, avatar row, action toolbar, padding & borders
  let height = 130;

  // Text content length estimation
  if (post.content && typeof post.content === "string") {
    const len = post.content.length;
    if (len > 600) height += 180;
    else if (len > 300) height += 120;
    else if (len > 120) height += 60;
    else if (len > 40) height += 35;
    else height += 20;
  }

  // Quoted post embed
  if (post.quote_post) {
    height += 150;
  }

  // Attached interactive or visual artifact
  const hasArtifact = Boolean(post.artifact_view_id || post.artifact_view || post.artifact_type);
  if (hasArtifact) {
    const rawType = post.artifact_view?.view_type || post.artifact_type || "";
    const vt = String(rawType).toLowerCase();

    switch (vt) {
      case "cad":
      case "cad-step":
      case "cad_step":
      case "cad-3d-viewer":
      case "step":
      case "stp":
      case "3d-model":
      case "webgpu":
      case "webgpu-simulation":
      case "gpu-simulation":
      case "simulation":
      case "simulation-result":
      case "fea-result":
      case "cfd-result":
      case "cfd-animation":
      case "gcode":
      case "cam-result":
      case "owl":
      case "owl2":
      case "simpack":
      case "gensys":
        // 450px viewer viewport + 40px studio footer + container margins
        height += 530;
        break;

      case "pdf":
        height += 480;
        break;

      case "ssp":
      case "ssd":
        height += 580;
        break;

      case "sysml":
      case "sysml2":
      case "sysml-architecture-viewer":
      case "kerml":
        height += 520;
        break;

      case "modelica-diagram":
      case "modelica":
      case "morsel":
      case "polyglot-morsel":
      case "modelscript":
      case "msx":
      case "simulation-plot":
      case "modelica-code":
      case "vega":
      case "vega-plot":
      case "mermaid":
      case "mermaid-diagram":
        height += 440;
        break;

      case "package":
      case "library":
      case "repository":
      case "repo":
      case "solution":
      case "engineering-app":
      case "app":
        height += 200;
        break;

      case "link-preview":
        height += 270;
        break;

      case "audio":
        height += 300;
        break;

      default:
        height += 450;
        break;
    }
  }

  return Math.max(160, Math.round(height));
}
