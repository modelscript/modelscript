// SPDX-License-Identifier: AGPL-3.0-or-later

export const process = (typeof globalThis !== "undefined" && globalThis.process) || {
  env: {},
  cwd: () => "/",
  platform: "browser",
  pid: 1,
  version: "v18.0.0",
  argv: ["node", "script"],
  nextTick: (cb) => setTimeout(cb, 0),
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
  hrtime: Object.assign((prev) => [0, 0], { bigint: () => BigInt(0) }),
};
export default process;
