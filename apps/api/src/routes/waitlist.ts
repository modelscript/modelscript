// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { type ObjectSchema, registerOpenApiOperation, validateBody } from "../middleware/validate.js";
import { isDisposableEmail } from "../util/email-filter.js";

const waitlistApplySchema: ObjectSchema = {
  type: "object",
  required: ["email"],
  description: "Public waitlist application payload.",
  properties: {
    email: {
      type: "string",
      required: true,
      minLength: 3,
      maxLength: 254,
      description: "Applicant email address (non-disposable academic or organization email).",
    },
    fullName: {
      type: "string",
      description: "Applicant full name.",
    },
    organization: {
      type: "string",
      description: "Applicant company, university, or research lab.",
    },
    discipline: {
      type: "string",
      description: "Primary engineering or scientific discipline.",
    },
    portfolioUrl: {
      type: "string",
      description: "Optional portfolio, GitHub, or publications URL.",
    },
    statement: {
      type: "string",
      description: "Brief statement describing intended modeling or simulation use cases.",
    },
  },
};

registerOpenApiOperation("post", "/api/v1/waitlist/apply", {
  summary: "Submit a waitlist access application",
  description: "Public endpoint allowing engineers, researchers, and students to request access keys.",
  tags: ["waitlist"],
  requestBody: waitlistApplySchema,
  responses: {
    "201": {
      description: "Waitlist submission recorded (idempotent for repeat email addresses).",
    },
    "400": {
      description: "Waitlist disabled, invalid email, or disposable email rejected.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "500": {
      description: "Failed to record waitlist submission.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
  },
});

export function waitlistRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/waitlist/apply
   * Public endpoint allowing engineers, researchers, and students to request access keys.
   */
  router.post("/apply", validateBody(waitlistApplySchema), (req: Request, res: Response) => {
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
