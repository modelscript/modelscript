// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AttachProfile } from "../types";

export interface WamRobotAttachDraft {
  file: File;
  viewConfig: Record<string, unknown>;
}

/**
 * Attach profile for Modelica + WAM Robot Lab artifacts (.wam or .json containing wam_robot_lab config).
 */
export const wamRobotAttachProfile: AttachProfile<WamRobotAttachDraft> = {
  id: "wam-robot-lab",
  label: "Modelica + WAM Robot Lab",
  match: {
    extensions: [".wam", ".json"],
    sniff: (head: string) =>
      head.includes('"wam_robot_lab"') ||
      head.includes('"wam_robot"') ||
      (head.includes('"urdfCode"') && (head.includes('"preTrainedWam"') || head.includes('"modelicaCode"'))),
  },

  async prepare(file) {
    const text = await file.text();
    let parsed: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      parsed = (raw.view_config as Record<string, unknown> | undefined) ?? raw;
    } catch {
      parsed = { title: file.name };
    }
    return {
      draft: {
        file,
        viewConfig: {
          title: (parsed.title as string | undefined) ?? file.name,
          ...parsed,
        },
      },
      chips: [{ label: "Modelica + WAM Robot Lab" }],
      issues: [],
    };
  },

  steps: [],

  async build(draft, ctx) {
    const uploadData = await ctx.uploadFile(draft.file);
    return {
      artifact_type: "wam_robot_lab",
      title: String(draft.viewConfig.title ?? draft.file.name),
      view_config: {
        url: uploadData.url,
        ...draft.viewConfig,
      },
    };
  },
};
