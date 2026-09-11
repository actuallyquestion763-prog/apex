// Plain functions, not a templating engine — this project has no other
// email templates yet, so a small dependency-free builder is the smallest
// thing that works. Inline styles throughout: email clients do not load
// external stylesheets, so anything not inlined would simply not render.
// Never includes the user's password or any account balance/PII beyond the
// email address itself — only what's needed to explain and act on the
// request.
export function buildPasswordResetEmailHtml(resetUrl: string, expiresInMinutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#0b0f1a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;text-align:center;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">EDGE<span style="color:#f5b800;">TRADE</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:18px;color:#ffffff;">Reset your password</h1>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#9ca3af;">
                  We received a request to reset the password for your EDGETRADE account. Click the button below to choose a new password.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;text-align:center;">
                <a href="${resetUrl}" style="display:inline-block;background-color:#f5b800;color:#0b0f1a;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:10px;">Reset Password</a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 12px 0;font-size:12px;line-height:20px;color:#6b7280;">
                  This link expires in ${expiresInMinutes} minutes and can only be used once.
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:20px;color:#6b7280;">
                  If you did not request a password reset, you can safely ignore this email — your password will not be changed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;border-top:1px solid #1f2937;">
                <p style="margin:16px 0 0 0;font-size:11px;color:#4b5563;">If the button above doesn't work, copy and paste this link into your browser:</p>
                <p style="margin:6px 0 0 0;font-size:11px;color:#4b5563;word-break:break-all;">${resetUrl}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function buildPasswordResetEmailText(resetUrl: string, expiresInMinutes: number): string {
  return [
    'EDGETRADE — Reset your password',
    '',
    'We received a request to reset the password for your EDGETRADE account.',
    'Open this link to choose a new password:',
    resetUrl,
    '',
    `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    'If you did not request a password reset, you can safely ignore this email — your password will not be changed.',
  ].join('\n')
}
