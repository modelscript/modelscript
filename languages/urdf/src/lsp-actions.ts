// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LspActionContext {
  documentText?: string;
  [key: string]: unknown;
}

export interface LspActionParams {
  documentText?: string | undefined;
  uri?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  step?: number | undefined;
  dt?: number | undefined;
  duration?: number | undefined;
  durationSeconds?: number | undefined;
  modelName?: string | undefined;
  streamId?: string | undefined;
  cycles?: number | undefined;
  dtMs?: number | undefined;
  dataText?: string | undefined;
  definitionName?: string | undefined;
  allowSyntheticFallback?: boolean | undefined;
  strictNetlist?: boolean | undefined;
  strict?: boolean | undefined;
  durationSec?: number | undefined;
  timeStepSec?: number | undefined;
  verifyIeee2800?: boolean | undefined;
  exportComtrade?: boolean | undefined;
  exportOut?: boolean | undefined;
  consequenceClass?: 1 | 2 | 3 | undefined;
  theme?: "light" | "dark" | undefined;
  format?: string | undefined;
  q?: Record<string, number> | undefined;
  qd?: Record<string, number> | undefined;
  qdd?: Record<string, number> | undefined;
  gravity?: number | undefined;
  maxNadalYOverQ?: number | undefined;
  maxLateralForceYKn?: number | undefined;
  nominalAxleLoadQ0Kn?: number | undefined;
  sperlingVerticalWz?: number | undefined;
  sperlingHorizontalWz?: number | undefined;
  crossWindUnloadingRatio?: number | undefined;
  equivalentConicity?: number | undefined;
  options?: unknown;
  operatingPoint?: unknown;
  gateOptions?: unknown;
}

function textAction<T>(
  emptyFallback: T,
  fn: (text: string, params: LspActionParams, ctx: LspActionContext) => Promise<T> | T,
): (ctx: LspActionContext, params?: LspActionParams) => Promise<T> {
  return async (ctx: LspActionContext, params?: LspActionParams): Promise<T> => {
    const text = params?.documentText ?? ctx.documentText;
    if (!text) return emptyFallback;
    return fn(text, params ?? {}, ctx);
  };
}

export const extractUrdfTheoryConstraints = async (text: string) => {
  const { parseUrdf } = await import("./index.js");
  const robot = parseUrdf(text);
  const ns = `URDF::${robot.name || "Robot"}`;
  const parameters: any[] = [];
  const ports: any[] = [];
  for (const link of robot.links.values()) {
    if (link.inertial && Number.isFinite(link.inertial.mass)) {
      parameters.push({
        name: `${link.name}_mass`,
        fqn: `${ns}::${link.name}.mass`,
        value: link.inertial.mass,
        rawValueText: String(link.inertial.mass),
        unit: "kg",
        line: 1,
        startCol: 1,
        endCol: 1 + link.name.length,
      });
    }
  }
  for (const joint of robot.joints.values()) {
    if (joint.limits?.effort !== undefined && Number.isFinite(joint.limits.effort)) {
      parameters.push({
        name: `${joint.name}_effort`,
        fqn: `${ns}::${joint.name}.effort`,
        value: joint.limits.effort,
        rawValueText: String(joint.limits.effort),
        unit: "N*m",
        line: 1,
        startCol: 1,
        endCol: 1 + joint.name.length,
      });
    }
    ports.push({ name: joint.name, kind: `Joint:${joint.type}`, line: 1 });
  }
  return { namespaceFqn: ns, parameters, ports };
};

export const urdfActionHandlers: Record<string, (ctx: LspActionContext, params?: LspActionParams) => Promise<unknown>> =
  {
    lint_urdf_robot: textAction([], async (text) => {
      const { parseUrdf, lintUrdfRobot } = await import("./index.js");
      return lintUrdfRobot(parseUrdf(text));
    }),
    compute_urdf_rnea: textAction(null, async (text, params) => {
      const { parseUrdf, computeInverseDynamicsRnea } = await import("./index.js");
      const robot = parseUrdf(text);
      const q = new Map<string, number>(Object.entries(params?.q ?? {}));
      const qd = new Map<string, number>(Object.entries(params?.qd ?? {}));
      const qdd = new Map<string, number>(Object.entries(params?.qdd ?? {}));
      const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, params?.gravity);
      return Object.fromEntries(rnea.jointTorques);
    }),
    export_urdf_modelica: textAction("", async (text) => {
      const { parseUrdf, urdfToModelica } = await import("./index.js");
      return urdfToModelica(parseUrdf(text));
    }),
    export_urdf_simpack: textAction(null, async (text) => {
      const { parseUrdf, urdfToSimpack } = await import("./index.js");
      return urdfToSimpack(parseUrdf(text));
    }),
    export_urdf_adams: textAction(null, async (text) => {
      const { parseUrdf, urdfToAdams } = await import("./index.js");
      return urdfToAdams(parseUrdf(text));
    }),
  };
