import { Injectable, Logger } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { buildPasswordResetEmailHtml, buildPasswordResetEmailText } from './templates/password-reset.template'

// Outgoing email, SMTP only — no third-party email API/SDK, since none was
// already part of this project (Part 1: "if the project already has an
// email service, reuse it" — it doesn't, so this is the smallest real
// implementation, not a second bespoke mechanism). Configuration is
// entirely via environment variables (SMTP_HOST/PORT/SECURE/USER/PASS,
// EMAIL_FROM); see backend/.env.example. Never logs the reset link, the
// raw token, or a password — see auth.service.ts's forgotPassword(), which
// is the only caller and never passes anything but the recipient address
// and the one-time reset URL.
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService')
  private readonly transporter: Transporter | null

  constructor() {
    const host = process.env.SMTP_HOST
    if (!host) {
      // Logged once at boot, not per-request — this is a deployment
      // configuration gap, not a per-request error, and the message
      // deliberately contains no account/token/request-specific data.
      this.logger.warn('SMTP_HOST is not set — outgoing email is disabled. Password-reset emails will not be delivered until SMTP is configured.')
      this.transporter = null
      return
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  }

  async sendPasswordResetEmail(toEmail: string, resetUrl: string, expiresInMinutes: number): Promise<void> {
    if (!this.transporter) {
      this.logger.error('Could not send password reset email: SMTP is not configured.')
      return
    }
    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM || '"EDGETRADE" <no-reply@edgecryptotrade.site>',
      to: toEmail,
      subject: 'Reset your EDGETRADE password',
      text: buildPasswordResetEmailText(resetUrl, expiresInMinutes),
      html: buildPasswordResetEmailHtml(resetUrl, expiresInMinutes),
    })
  }
}
