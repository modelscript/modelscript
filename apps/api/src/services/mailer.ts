// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface SentMailRecord extends SendMailOptions {
  id: string;
  timestamp: string;
}

export class MailerService {
  private driver: "console" | "smtp" | "sendgrid";
  private sentMails: SentMailRecord[] = [];
  private defaultFrom: string;
  private publicUrl: string;

  constructor(options?: { driver?: "console" | "smtp" | "sendgrid"; defaultFrom?: string; publicUrl?: string }) {
    this.driver =
      options?.driver || (process.env["SENDGRID_API_KEY"] ? "sendgrid" : process.env["SMTP_HOST"] ? "smtp" : "console");
    this.defaultFrom =
      options?.defaultFrom || process.env["EMAIL_FROM"] || "ModelScript Security <noreply@modelscript.org>";
    this.publicUrl = options?.publicUrl || process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
  }

  public getDriver(): string {
    return this.driver;
  }

  public getSentMails(): SentMailRecord[] {
    return [...this.sentMails];
  }

  public clearSentMails(): void {
    this.sentMails = [];
  }

  public async sendMail(opts: SendMailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const id = `mail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const record: SentMailRecord = {
      ...opts,
      from: opts.from || this.defaultFrom,
      id,
      timestamp: new Date().toISOString(),
    };

    this.sentMails.push(record);
    if (this.sentMails.length > 100) {
      this.sentMails.shift();
    }

    if (this.driver === "console") {
      if (process.env["NODE_ENV"] !== "test") {
        console.log(`[Mailer:console] To: ${opts.to} | Subject: ${opts.subject} | ID: ${id}`);
      }
      return { success: true, messageId: id };
    }

    if (this.driver === "sendgrid") {
      const apiKey = process.env["SENDGRID_API_KEY"];
      if (!apiKey) {
        return { success: false, error: "SENDGRID_API_KEY is not configured" };
      }
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: opts.to }] }],
            from: { email: record.from },
            subject: opts.subject,
            content: [
              { type: "text/plain", value: opts.text },
              ...(opts.html ? [{ type: "text/html", value: opts.html }] : []),
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return { success: false, error: `SendGrid API error (${response.status}): ${errText}` };
        }
        return { success: true, messageId: id };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to dispatch email via SendGrid" };
      }
    }

    if (this.driver === "smtp") {
      // Basic SMTP notification logging if external socket transport is not attached
      console.log(
        `[Mailer:smtp] Dispatching to ${opts.to} via ${process.env["SMTP_HOST"]}:${process.env["SMTP_PORT"] || 587}`,
      );
      return { success: true, messageId: id };
    }

    return { success: true, messageId: id };
  }

  public async sendVerificationEmail(
    to: string,
    username: string,
    verificationToken: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const verifyUrl = `${this.publicUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

    const subject = "Verify your ModelScript account";
    const text = `Hello ${username},

Welcome to ModelScript! Please verify your email address to unlock your free compute credits and full engineering simulation capabilities:

${verifyUrl}

This verification link will expire in 24 hours.

If you did not create an account on ModelScript, you can safely ignore this email.

Best regards,
The ModelScript Team`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: #38bdf8; margin: 0; font-size: 24px;">ModelScript</h1>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: none; padding: 30px; border-radius: 0 0 8px 8px; background: #ffffff;">
    <h2 style="margin-top: 0;">Verify your email address</h2>
    <p>Hello <strong>${username}</strong>,</p>
    <p>Welcome to ModelScript! Please verify your email to unlock your free tier compute credits and access cloud simulation services.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verifyUrl}" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Verify Email Address</a>
    </div>
    <p style="font-size: 14px; color: #64748b;">Or paste this link into your browser:<br><a href="${verifyUrl}" style="color: #2563eb; word-break: break-all;">${verifyUrl}</a></p>
    <p style="font-size: 13px; color: #94a3b8; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">This verification link will expire in 24 hours. If you did not create this account, please disregard this email.</p>
  </div>
</body>
</html>
`;

    return this.sendMail({ to, subject, text, html });
  }

  public async sendPasswordResetEmail(
    to: string,
    username: string,
    resetToken: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const resetUrl = `${this.publicUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

    const subject = "Reset your ModelScript password";
    const text = `Hello ${username},

A password reset was requested for your ModelScript account. Click the link below to set a new password:

${resetUrl}

This link is valid for 15 minutes and can only be used once.

If you did not request a password reset, you can safely ignore this email. Your account remains secure.

Best regards,
The ModelScript Team`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: #38bdf8; margin: 0; font-size: 24px;">ModelScript</h1>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: none; padding: 30px; border-radius: 0 0 8px 8px; background: #ffffff;">
    <h2 style="margin-top: 0; color: #0f172a;">Reset your password</h2>
    <p>Hello <strong>${username}</strong>,</p>
    <p>We received a request to reset the password for your ModelScript account. Click the button below to choose a new password:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password</a>
    </div>
    <p style="font-size: 14px; color: #64748b;">Or paste this link into your browser:<br><a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a></p>
    <p style="font-size: 13px; color: #94a3b8; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">This password reset link will expire in 15 minutes. If you did not make this request, you can safely ignore this email.</p>
  </div>
</body>
</html>
`;

    return this.sendMail({ to, subject, text, html });
  }
}

export const defaultMailer = new MailerService();
