import { Injectable, Logger } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { buildPasswordResetEmailHtml, buildPasswordResetEmailText } from './templates/password-reset.template'
import {
  buildSupportNotificationEmailHtml,
  buildSupportNotificationEmailText,
  supportNotificationEmailSubject,
  type SupportNotificationEmailParams,
} from './templates/support-notification.template'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

interface MailContent {
  to: string
  subject: string
  text: string
  html: string
}

// Outgoing email. Two transports, tried in this order:
//   1. Brevo's transactional HTTP API (BREVO_API_KEY set) — HTTPS only, no
//      SMTP socket. Added because Render's free tier blocks outbound SMTP
//      (ports 25/465/587) entirely, so direct SMTP cannot work there at
//      any price short of upgrading the plan.
//   2. Direct SMTP via nodemailer (SMTP_HOST set) — the original
//      implementation, kept as-is and still fully functional for any
//      environment where outbound SMTP isn't blocked (e.g. local dev, or
//      a host other than Render). Deliberately NOT removed yet — this
//      lets the API path be verified in production before anything that
//      currently works is taken away.
// Both paths build the exact same {from, to, subject, text, html} content
// via the exact same template functions — only the transport differs, and
// every existing caller (auth.service.ts, support.service.ts) is
// unchanged: same method signatures, same non-blocking-failure contract
// (a transport error still propagates to the caller's own try/catch,
// exactly as before; only "nothing is configured" is swallowed here).
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService')
  private readonly transporter: Transporter | null
  private readonly brevoApiKey: string | undefined

  constructor() {
    this.brevoApiKey = process.env.BREVO_API_KEY || undefined

    const host = process.env.SMTP_HOST
    if (!host) {
      this.transporter = null
      if (!this.brevoApiKey) {
        // Logged once at boot, not per-request — this is a deployment
        // configuration gap, not a per-request error, and the message
        // deliberately contains no account/token/request-specific data.
        this.logger.warn('Neither BREVO_API_KEY nor SMTP_HOST is set — outgoing email is disabled until one is configured.')
      }
      return
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  }

  private get fromAddress(): string {
    return process.env.EMAIL_FROM || '"EDGETRADE" <no-reply@edgecryptotrade.site>'
  }

  // Splits a nodemailer-style "Name <email>" / '"Name" <email>' / bare
  // "email" From address into Brevo's API shape ({email, name?}) — the
  // same EMAIL_FROM value nodemailer already accepted as one string.
  private parseSender(from: string): { email: string; name?: string } {
    const match = from.trim().match(/^"?([^"<]*?)"?\s*<([^<>]+)>$/)
    if (match) {
      const name = match[1].trim()
      return name ? { email: match[2].trim(), name } : { email: match[2].trim() }
    }
    return { email: from.trim() }
  }

  private async sendViaBrevoApi(content: MailContent): Promise<void> {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': this.brevoApiKey!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.parseSender(this.fromAddress),
        to: [{ email: content.to }],
        subject: content.subject,
        textContent: content.text,
        htmlContent: content.html,
      }),
    })
    if (!res.ok) {
      // Never include the API key or full response body verbatim in a
      // thrown error that might end up logged — status + a short prefix
      // of Brevo's own (key-free) error body is enough to diagnose.
      const body = await res.text().catch(() => '')
      throw new Error(`Brevo API request failed (${res.status}): ${body.slice(0, 300)}`)
    }
  }

  // `notConfiguredContext` reproduces each caller's own previous
  // not-configured log message verbatim (ticket id/kind for support
  // notifications, a plain description for password resets) — centralizing
  // transport selection here shouldn't lose that diagnostic detail.
  private async deliver(content: MailContent, notConfiguredContext: string): Promise<void> {
    if (this.brevoApiKey) {
      await this.sendViaBrevoApi(content)
      return
    }
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.fromAddress, ...content })
      return
    }
    this.logger.error(`Could not send ${notConfiguredContext}: no email transport is configured (set BREVO_API_KEY or SMTP_HOST).`)
  }

  async sendPasswordResetEmail(toEmail: string, resetUrl: string, expiresInMinutes: number): Promise<void> {
    await this.deliver(
      {
        to: toEmail,
        subject: 'Reset your EDGETRADE password',
        text: buildPasswordResetEmailText(resetUrl, expiresInMinutes),
        html: buildPasswordResetEmailHtml(resetUrl, expiresInMinutes),
      },
      'password reset email',
    )
  }

  // ADMIN NOTIFICATIONS (Support) — "New Support Ticket" / "Customer Reply"
  // alerts. The recipient is always caller-supplied (PlatformSettings.
  // supportNotificationEmail, read by SupportService — never hardcoded or
  // read from an env var here), so this method has no opinion on WHO gets
  // notified, only HOW. The caller (SupportService) is responsible for
  // catching a rejection here so a delivery failure never fails the
  // support request that triggered it — same division of responsibility
  // as sendPasswordResetEmail/auth.service.ts's forgotPassword().
  async sendSupportNotificationEmail(toEmail: string, params: SupportNotificationEmailParams): Promise<void> {
    await this.deliver(
      {
        to: toEmail,
        subject: supportNotificationEmailSubject(params),
        text: buildSupportNotificationEmailText(params),
        html: buildSupportNotificationEmailHtml(params),
      },
      `support notification email (${params.kind}, ticket ${params.ticketId})`,
    )
  }
}
