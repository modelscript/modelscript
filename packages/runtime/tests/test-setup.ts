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

const origWriteFileSync = fs.writeFileSync;
(fs as any).writeFileSync = function (file: any, ...args: any[]) {
  if (typeof file === "string") {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {}
  }
  return origWriteFileSync.apply(this, [file, ...args]);
};
