/**
 * Shared utility functions for file extension handling and model file identification.
 */

export const SUPPORTED_MODEL_EXTENSIONS = [
  ".mo",
  ".mos",
  ".sysml",
  ".sysml2",
  ".step",
  ".stp",
  ".p21",
  ".owl",
  ".ttl",
  ".ofn",
  ".csv",
] as const;

export const SUPPORTED_MODEL_REGEX = /\.(mo|mos|sysml|sysml2|step|stp|p21|owl|ttl|ofn|csv)$/i;

/**
 * Checks whether the given file path or URI belongs to a supported ModelScript model file.
 */
export function isSupportedModelFile(pathOrUri: string): boolean {
  return SUPPORTED_MODEL_REGEX.test(pathOrUri);
}
