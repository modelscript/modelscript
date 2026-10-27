// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "tar-fs" {
  export function extract(dest: string, options?: Record<string, unknown>): NodeJS.WritableStream;
}
