// SPDX-License-Identifier: AGPL-3.0-or-later

import net from "node:net";
import tls from "node:tls";

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
  from?: string | undefined;
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

  constructor(options?: {
    driver?: "console" | "smtp" | "sendgrid" | undefined;
    defaultFrom?: string | undefined;
    publicUrl?: string | undefined;
  }) {
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

  public async sendMail(
    opts: SendMailOptions,
  ): Promise<{ success: boolean; messageId?: string | undefined; error?: string | undefined }> {
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
      } catch (err: unknown) {
        return {
          success: false,
          error: (err instanceof Error ? err.message : String(err)) || "Failed to dispatch email via SendGrid",
        };
      }
    }

    if (this.driver === "smtp") {
      const smtpHost = process.env["SMTP_HOST"];
      const smtpPort = Number(process.env["SMTP_PORT"] || 587);
      if (!smtpHost) {
        if (process.env["NODE_ENV"] === "production") {
          return { success: false, error: "SMTP_HOST is not configured" };
        }
        return { success: true, messageId: id };
      }

      if (process.env["NODE_ENV"] === "test" && process.env["SMTP_LIVE_TEST"] !== "true") {
        return { success: true, messageId: id };
      }

      try {
        await this.deliverViaSmtpSocket(smtpHost, smtpPort, record);
        return { success: true, messageId: id };
      } catch (err: unknown) {
        if (process.env["NODE_ENV"] !== "production") {
          console.warn(`[Mailer:smtp] Non-production fallback after SMTP connection error:`, err);
          return { success: true, messageId: id };
        }
        return {
          success: false,
          error: (err instanceof Error ? err.message : String(err)) || "SMTP delivery failed",
        };
      }
    }

    return { success: true, messageId: id };
  }

  private deliverViaSmtpSocket(host: string, port: number, record: SentMailRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const useImplicitTls = port === 465 || process.env["SMTP_SECURE"] === "true";
      const socket = useImplicitTls
        ? tls.connect({ host, port, servername: host })
        : net.createConnection({ host, port });
      socket.setTimeout(10000);

      const extractAddress = (addr: string): string => {
        const m = addr.match(/<([^>]+)>/);
        return (m ? m[1]! : addr).replace(/[\r\n<>]/g, "").trim();
      };
      const fromAddr = extractAddress(record.from || this.defaultFrom);
      const toAddr = extractAddress(record.to);
      const smtpUser = process.env["SMTP_USER"];
      const smtpPass = process.env["SMTP_PASS"];

      const boundary = `ms_boundary_${record.id}`;
      const mimeBody = [
        `From: ${(record.from || this.defaultFrom).replace(/[\r\n]/g, "")}`,
        `To: ${record.to.replace(/[\r\n]/g, "")}`,
        `Subject: ${record.subject.replace(/[\r\n]/g, "")}`,
        `Message-ID: <${record.id}@modelscript.org>`,
        `Date: ${new Date(record.timestamp).toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="utf-8"`,
        ``,
        record.text,
        ...(record.html ? [``, `--${boundary}`, `Content-Type: text/html; charset="utf-8"`, ``, record.html] : []),
        ``,
        `--${boundary}--`,
        `.`,
        ``,
      ].join("\r\n");

      const commands: string[] = [
        `EHLO modelscript.org`,
        ...(smtpUser && smtpPass ? [`AUTH PLAIN ${Buffer.from(`\0${smtpUser}\0${smtpPass}`).toString("base64")}`] : []),
        `MAIL FROM:<${fromAddr}>`,
        `RCPT TO:<${toAddr}>`,
        `DATA`,
        mimeBody,
        `QUIT`,
      ];

      let step = 0;
      let buffer = "";

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.on("timeout", () => {
        cleanup();
        reject(new Error("SMTP connection timed out"));
      });

      socket.on("error", (err) => {
        cleanup();
        reject(err);
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\r\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const code = parseInt(line.slice(0, 3), 10);
          // Multi-line response continues with '-'
          if (line[3] === "-") continue;

          if (code >= 400) {
            cleanup();
            reject(new Error(`SMTP error (${code}): ${line}`));
            return;
          }

          if (step < commands.length) {
            const cmd = commands[step++]!;
            socket.write(cmd.endsWith("\r\n") ? cmd : `${cmd}\r\n`);
          } else {
            cleanup();
            resolve();
            return;
          }
        }
      });
    });
  }

  public async sendVerificationEmail(
    to: string,
    username: string,
    verificationToken: string,
  ): Promise<{ success: boolean; messageId?: string | undefined; error?: string | undefined }> {
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
  ): Promise<{ success: boolean; messageId?: string | undefined; error?: string | undefined }> {
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
