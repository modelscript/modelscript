// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cloudflare Turnstile / Bot mitigation verification helper.
 */
export async function verifyCaptchaToken(
  token?: string,
  clientIp?: string,
  secretKey: string = process.env["TURNSTILE_SECRET_KEY"] || "",
): Promise<{ success: boolean; error?: string }> {
  // Fail-closed guardrail in production mode: reject if secret key is missing
  if (process.env["NODE_ENV"] === "production") {
    if (!secretKey) {
      return {
        success: false,
        error: "FATAL: Bot mitigation is not configured on this server (TURNSTILE_SECRET_KEY missing).",
      };
    }
  }

  // If mock secret is configured (for testing production flows) or running under tests
  if (!secretKey || secretKey.startsWith("mock-") || process.env["NODE_ENV"] === "test") {
    if (!token) {
      return { success: false, error: "Captcha token is required" };
    }
    if (token === "invalid-captcha" || token.startsWith("fail")) {
      return { success: false, error: "Invalid captcha challenge token" };
    }
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "Captcha token is required" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (clientIp) {
      formData.append("remoteip", clientIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = (await response.json()) as { success: boolean; "error-codes"?: string[] };

    if (!data.success) {
      return {
        success: false,
        error: `Captcha verification failed: ${(data["error-codes"] || []).join(", ") || "invalid token"}`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: `Captcha service error: ${(err as Error).message}`,
    };
  }
}
