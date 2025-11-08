// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Dirent, FileSystem, Stats } from "modelscript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";

export class NodeFileSystem implements FileSystem {
  basename(path: string): string {
    return basename(path);
  }

  extname(path: string): string {
    return extname(path);
  }

  join(...paths: string[]): string {
    return join(...paths);
  }

  read(path: string): string {
    return readFileSync(path, { encoding: "utf8" });
  }

  readdir(path: string): Dirent[] {
    return readdirSync(path, { withFileTypes: true });
  }

  resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  get sep(): string {
    return sep;
  }

  stat(path: string): Stats {
    return statSync(path);
  }
}
