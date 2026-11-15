// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandModule } from "yargs";

export interface InitKernelArgs {
  name: string;
  lang: "ts" | "as";
  dir?: string;
}

function toPascalCase(raw: string): string {
  return (
    raw
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join("") || "CustomCapability"
  );
}

function toCamelCase(raw: string): string {
  const pascal = toPascalCase(raw);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export const InitKernelCommand: CommandModule<object, InitKernelArgs> = {
  command: "init-kernel <name>",
  describe: "Scaffold a SysML v2 + AssemblyScript or TypeScript capability package",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Capability package name (e.g. step-auditor)",
      })
      .option("lang", {
        type: "string",
        choices: ["ts", "as"] as const,
        default: "ts" as const,
        describe: "Kernel implementation language ('ts' for TypeScript, 'as' for AssemblyScript/WASM)",
      })
      .option("dir", {
        type: "string",
        describe: "Target directory (defaults to ./<name>)",
      }) as unknown as import("yargs").Argv<InitKernelArgs>,
  async handler(argv) {
    const pascal = toPascalCase(argv.name);
    const fnName = toCamelCase(argv.name);
    const outDir = path.resolve(argv.dir ?? argv.name);
    const isTs = argv.lang === "ts";

    fs.mkdirSync(path.join(outDir, "src"), { recursive: true });
    if (!isTs) fs.mkdirSync(path.join(outDir, "assembly"), { recursive: true });

    const sysmlContent = `package ${pascal}Pack {
  verification def ${pascal}Check {
    attribute gain = 1.0;
    attribute overshootLimitPct = 15.0;
    require { overshootPct <= overshootLimitPct; }
  }
}
`;
    fs.writeFileSync(path.join(outDir, "src", "system.sysml"), sysmlContent, "utf8");

    if (isTs) {
      const tsKernel = `import { ResultBuilder, stepResponseMetrics, type KernelInput } from "@modelscript/sdk";

/** @sysml ${pascal}Check */
export function ${fnName}(input: KernelInput) {
  const gain = Number(input.parameters.gain ?? 1.0);
  const t = [0, 0.1, 0.2, 0.5, 1.0];
  const y = [0, 0.3 * gain, 1.05 * gain, gain, gain];
  const m = stepResponseMetrics(t, y, gain);

  return new ResultBuilder("${fnName}")
    .metric("overshootPct", m.overshootPct)
    .kpiCards("kpis", "${pascal} KPIs", [
      { label: "Overshoot", value: m.overshootPct.toFixed(2), unit: "%", status: "pass" },
      { label: "Final Value", value: m.finalValue.toFixed(3), status: "neutral" },
    ])
    .timeSeries("response", "${pascal} Response", "Time (s)", "y", [{ name: "y", x: t, y }])
    .summary("${pascal} verified (overshoot=" + m.overshootPct.toFixed(2) + "%)")
    .build();
}
`;
      fs.writeFileSync(path.join(outDir, "src", `${fnName}.ts`), tsKernel, "utf8");
    } else {
      const asKernel = `import {
  decodeUtf8,
  getParamF64,
  msx_alloc,
  plotSeriesJson,
  returnJsonResult,
} from "@modelscript/sdk/assembly";

export { msx_alloc };

/** @sysml ${pascal}Check */
export function msx_run_json(_ePtr: usize, _eLen: i32, inPtr: usize, inLen: i32): u64 {
  const json = decodeUtf8(inPtr, inLen);
  const gain = getParamF64(json, "gain", 1.0);
  const n = 20;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i as f64) * 0.05;
    tx[i] = t;
    ty[i] = gain * (1.0 - Math.exp(-t / 0.2));
  }
  const plot = plotSeriesJson("timeseries", "response", "${pascal} Response", "Time (s)", "y", "y", tx, ty);
  const res =
    '{"ok":true,"kernelId":"${fnName}","parameters":{"overshootPct":0},' +
    '"summary":"${pascal} synthesized 20 points","artifacts":[' +
    plot +
    "]}";
  return returnJsonResult(res);
}
`;
      fs.writeFileSync(path.join(outDir, "assembly", `${fnName}.ts`), asKernel, "utf8");
    }

    console.log(`Scaffolded ${argv.lang.toUpperCase()} capability pack at ${outDir}`);
    console.log(
      `Run headlessly with:\n  msx sysml-run ${path.relative(process.cwd(), path.join(outDir, "src", "system.sysml"))}`,
    );
  },
};
