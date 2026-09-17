// SPDX-License-Identifier: AGPL-3.0-or-later

import os from "node:os";
import path from "node:path";

export function getSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : process.env.USER || "user";
  return path.join(os.tmpdir(), `msc-${uid}.sock`);
}
