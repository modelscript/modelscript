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
export const constants = {};
