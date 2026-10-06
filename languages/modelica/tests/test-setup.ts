// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import cjsFs, * as cjsFsModule from "fs";
import fs, * as fsModule from "node:fs";
import path from "node:path";
import * as nodeTest from "node:test";

const wrapHook = (hookFn: any) => (fn: any, options?: any) => {
  if (typeof options === "number") {
    return hookFn(fn, { timeout: options });
  }
  return hookFn(fn, options);
};

const wrapTest = (testFn: any) => {
  const wrapped: any = (name: string, arg2?: any, arg3?: any) => {
    if (typeof arg2 === "function" && typeof arg3 === "number") {
      return testFn(name, { timeout: arg3 }, arg2);
    }
    if (typeof arg2 === "function" && typeof arg3 === "object") {
      return testFn(name, arg3, arg2);
    }
    return testFn(name, arg2, arg3);
  };
  wrapped.only = (name: string, arg2?: any, arg3?: any) => {
    if (typeof arg2 === "function" && typeof arg3 === "number") {
      return testFn.only(name, { timeout: arg3 }, arg2);
    }
    return testFn.only(name, arg2, arg3);
  };
  wrapped.skip = testFn.skip;
  wrapped.todo = testFn.todo;
  return wrapped;
};

(globalThis as any).describe = nodeTest.describe;
(globalThis as any).it = wrapTest(nodeTest.it);
(globalThis as any).test = wrapTest(nodeTest.test);
(globalThis as any).before = wrapHook(nodeTest.before);
(globalThis as any).beforeAll = wrapHook(nodeTest.before);
(globalThis as any).after = wrapHook(nodeTest.after);
(globalThis as any).afterAll = wrapHook(nodeTest.after);
(globalThis as any).beforeEach = wrapHook(nodeTest.beforeEach);
(globalThis as any).afterEach = wrapHook(nodeTest.afterEach);
(globalThis as any).expect = expect;

const patch = (target: any) => {
  if (target && target.writeFileSync) {
    const orig = target.writeFileSync;
    try {
      target.writeFileSync = function (file: any, ...args: any[]) {
        if (typeof file === "string") {
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
          } catch {}
        }
        return orig.apply(this, [file, ...args]);
      };
    } catch {}
  }
};

patch(fs);
patch(fsModule);
patch(cjsFs);
patch(cjsFsModule);
