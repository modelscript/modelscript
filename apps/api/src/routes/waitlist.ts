// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { isDisposableEmail } from "../util/email-filter.js";

export function waitlistRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  router.use(defaultApiLimiter);

  /**
   * POST /api/v1/waitlist/apply
   * Public endpoint allowing engineers, researchers, and students to request access keys.
   */
  router.post("/apply", (req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      if (!settings.waitlistEnabled) {
        res.status(400).json({ error: "Waitlist applications are currently disabled on this instance" });
        return;
      }

      const { email, fullName, organization, discipline, portfolioUrl, statement } = req.body ?? {};
      const rawEmail = typeof email === "string" ? email.trim() : "";

      if (!rawEmail || !rawEmail.includes("@") || rawEmail.length > 254) {
        res.status(400).json({ error: "A valid email address is required" });
        return;
      }

      if (isDisposableEmail(rawEmail)) {
        res.status(400).json({
          error:
            "Disposable and temporary email addresses are not permitted. Please use your academic or organization email.",
        });
        return;
      }

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "127.0.0.1";

      const submission = database.createWaitlistSubmission({
        email: rawEmail,
        full_name: typeof fullName === "string" ? fullName.trim() : null,
        organization: typeof organization === "string" ? organization.trim() : null,
        discipline: typeof discipline === "string" ? discipline.trim() : null,
        portfolio_url: typeof portfolioUrl === "string" ? portfolioUrl.trim() : null,
        statement: typeof statement === "string" ? statement.trim() : null,
        ip_address: clientIp,
      });

      res.status(201).json({
        success: true,
        message:
          "Thank you for your application to Ansatz. We review submissions continuously and will send an invitation code to your email.",
        submission: {
          id: submission.id,
          email: submission.email,
          status: submission.status,
          createdAt: submission.created_at,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to record waitlist submission",
      });
    }
  });

  return router;
}
