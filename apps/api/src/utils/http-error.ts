// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Safely extract a human-readable message from an unknown thrown value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (
    err !== null &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Return a client-safe error message for HTTP responses.
 *
 * For 5xx responses (default status 500), always returns `fallback` so internal
 * details (SQLite errors, filesystem paths, stack traces) are not leaked to
 * clients. For 4xx responses, preserves the thrown error message when present.
 */
export function publicErrorMessage(err: unknown, fallback: string, status = 500): string {
  if (status >= 500) {
    return fallback;
  }
  const msg = getErrorMessage(err).trim();
  return msg.length > 0 ? msg : fallback;
}
