// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import fs from "node:fs";
import path from "node:path";
import * as nodeTest from "node:test";

(globalThis as any).describe = nodeTest.describe;
(globalThis as any).it = nodeTest.it;
(globalThis as any).test = nodeTest.test;
(globalThis as any).before = nodeTest.before;
(globalThis as any).beforeAll = nodeTest.before;
(globalThis as any).after = nodeTest.after;
(globalThis as any).afterAll = nodeTest.after;
(globalThis as any).beforeEach = nodeTest.beforeEach;
(globalThis as any).afterEach = nodeTest.afterEach;
(globalThis as any).expect = expect;
(globalThis as any).jest = {
  fn: (impl?: any) => {
    const mockFn: any = function (this: any, ...args: any[]) {
      mockFn.mock.calls.push(args);
      if (impl) return impl.apply(this, args);
    };
    mockFn._isMockFunction = true;
    mockFn.getMockName = () => "jest.fn()";
    mockFn.mock = { calls: [], instances: [], results: [] };
    return mockFn;
  },
};

const origWriteFileSync = fs.writeFileSync;
(fs as any).writeFileSync = function (file: any, ...args: any[]) {
  if (typeof file === "string") {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {}
  }
  return origWriteFileSync.apply(this, [file, ...args]);
};

import { simulateArena, simulateArenaAsync } from "../src/core/simulate-arena.js";
import { registerArenaSimulator } from "../src/uq/monte-carlo.js";

registerArenaSimulator(simulateArena, simulateArenaAsync);
