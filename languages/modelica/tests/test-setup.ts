import { expect } from "expect";
import cjsFs, * as cjsFsModule from "fs";
import fs, * as fsModule from "node:fs";
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
