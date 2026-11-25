// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ApiErrorResponseData {
  error?: string | undefined;
  message?: string | undefined;
  code?: string | undefined;
  details?: unknown;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  status?: number | undefined;
  data?: ApiErrorResponseData | string | undefined;
  headers?: Record<string, string | undefined> | undefined;
}

export interface ApiErrorLike {
  message?: string | undefined;
  code?: string | undefined;
  status?: number | undefined;
  response?: ApiErrorResponse | undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function getApiErrorResponse(err: unknown): ApiErrorResponse | undefined {
  if (!isRecord(err)) return undefined;
  const resp = err.response;
  if (!isRecord(resp)) return undefined;
  return resp as ApiErrorResponse;
}

export function getApiErrorData(err: unknown): ApiErrorResponseData | undefined {
  const resp = getApiErrorResponse(err);
  if (!resp) return undefined;
  return isRecord(resp.data) ? (resp.data as ApiErrorResponseData) : undefined;
}

export function getApiErrorStatus(err: unknown): number | undefined {
  const resp = getApiErrorResponse(err);
  if (resp && typeof resp.status === "number") return resp.status;
  if (isRecord(err) && typeof err.status === "number") return err.status;
  return undefined;
}

export function getApiErrorCode(err: unknown): string | undefined {
  const data = getApiErrorData(err);
  if (data && typeof data.code === "string") return data.code;
  if (isRecord(err) && typeof err.code === "string") return err.code;
  return undefined;
}

export function getApiErrorMessage(err: unknown, fallback = "An unexpected error occurred"): string {
  const resp = getApiErrorResponse(err);
  if (resp) {
    if (typeof resp.data === "string" && resp.data.trim()) {
      return resp.data;
    }
    if (isRecord(resp.data)) {
      if (typeof resp.data.error === "string" && resp.data.error) return resp.data.error;
      if (typeof resp.data.message === "string" && resp.data.message) return resp.data.message;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (isRecord(err) && typeof err.message === "string" && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err) {
    return err;
  }
  return fallback;
}

export function getErrorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) return err.message;
  if (isRecord(err) && typeof err.message === "string" && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
