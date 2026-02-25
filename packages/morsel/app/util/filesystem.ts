// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Dirent, FileSystem, Stats } from "@modelscript/modelscript";
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

  readBinary(path: string): Uint8Array {
    return fs.readFileSync(path);
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
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        console.error(e);
      }
      return null;
    }
  }
}

export async function mountLibrary(path: string, data: ArrayBuffer): Promise<void> {
  const { Zip } = await import("@zenfs/archives");
  const { resolveMountConfig, mounts } = await import("@zenfs/core");
  const fs = await resolveMountConfig({ backend: Zip, data });
  mounts.set(path, fs);
}
