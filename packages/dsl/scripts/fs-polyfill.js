// SPDX-License-Identifier: AGPL-3.0-or-later

export function realpathSync(path) {
  return path;
}
realpathSync.native = realpathSync;
export function statSync() {
  return { isDirectory: () => false, isFile: () => true };
}
export function readFileSync() {
  return "";
}
export function readdirSync() {
  return [];
}
export function existsSync() {
  return false;
}
export function mkdirSync() {}
export function writeFileSync() {}
export const constants = {};
