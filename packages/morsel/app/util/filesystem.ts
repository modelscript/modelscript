// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileSystem, Dirent, Stats } from "@modelscript/modelscript";
import { fs, statSync } from "@zenfs/core";
import { basename, extname, join, resolve, sep } from "@zenfs/core/path.js";

export class WebFileSystem implements FileSystem {
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
    return fs.readFileSync(path, { encoding: "utf8" });
  }

  readdir(path: string): Dirent[] {
    return fs.readdirSync(path, { withFileTypes: true });
  }

  resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  get sep(): string {
    return sep;
  }

  stat(path: string): Stats | null {
    try {
      return statSync(path);
    } catch (e) {
      console.error(e);
      return null;
    }
  }
}
