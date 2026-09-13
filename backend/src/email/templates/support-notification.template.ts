// Admin-facing "a customer needs help" alert — sent only to the address
// configured in PlatformSettings.supportNotificationEmail, never a
// hardcoded address (see EmailService.sendSupportNotificationEmail()).
// Same dependency-free inline-styled builder pattern as
// password-reset.template.ts (this project's only other email). Contains
// no password, session cookie, auth token, or ticket-access secret of any
// kind — the "Open Support Ticket" link is a plain URL into the existing
// authenticated /admin/support route, not a bearer link (see that
// function's own comment for why).
export interface SupportNotificationEmailParams {
  kind: 'NEW_TICKET' | 'CUSTOMER_REPLY'
  ticketId: string
  ticketSubject: string
  categoryName: string
  customerLabel: string
  messagePreview: string
  createdAt: Date
  ticketUrl: string
}

function shortTicketRef(ticketId: string): string {
  return ticketId.slice(0, 8)
}

export function supportNotificationEmailSubject(params: SupportNotificationEmailParams): string {
  return params.kind === 'NEW_TICKET'
    ? 'EDGETRADE — New Support Ticket'
    : `EDGETRADE — Customer Reply to Support Ticket #${shortTicketRef(params.ticketId)}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildSupportNotificationEmailHtml(params: SupportNotificationEmailParams): string {
  const heading = params.kind === 'NEW_TICKET' ? 'New Support Ticket' : 'Customer Reply to Support Ticket'
  const intro = params.kind === 'NEW_TICKET'
    ? 'A customer opened a new support ticket and needs help.'
    : 'A customer replied on an existing support ticket.'
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#0b0f1a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;text-align:center;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">EDGE<span style="color:#f5b800;">TRADE</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:18px;color:#ffffff;">${heading}</h1>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#9ca3af;">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;border:1px solid #1f2937;border-radius:12px;">
                  <tr><td style="padding:14px 18px;font-size:13px;color:#9ca3af;">Customer</td><td style="padding:14px 18px;font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(params.customerLabel)}</td></tr>
                  <tr><td style="padding:0 18px 14px 18px;font-size:13px;color:#9ca3af;border-top:1px solid #1f2937;">Ticket</td><td style="padding:0 18px 14px 18px;font-size:13px;color:#ffffff;text-align:right;border-top:1px solid #1f2937;">#${shortTicketRef(params.ticketId)} — ${escapeHtml(params.ticketSubject)}</td></tr>
                  <tr><td style="padding:0 18px 14px 18px;font-size:13px;color:#9ca3af;border-top:1px solid #1f2937;">Category</td><td style="padding:0 18px 14px 18px;font-size:13px;color:#ffffff;text-align:right;border-top:1px solid #1f2937;">${escapeHtml(params.categoryName)}</td></tr>
                  <tr><td style="padding:0 18px 14px 18px;font-size:13px;color:#9ca3af;border-top:1px solid #1f2937;">Time</td><td style="padding:0 18px 14px 18px;font-size:13px;color:#ffffff;text-align:right;border-top:1px solid #1f2937;">${params.createdAt.toUTCString()}</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Message preview</p>
                <p style="margin:0;padding:12px 14px;background-color:#0b0f1a;border:1px solid #1f2937;border-radius:10px;font-size:14px;line-height:20px;color:#d1d5db;white-space:pre-wrap;">${escapeHtml(params.messagePreview)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;text-align:center;">
                <a href="${params.ticketUrl}" style="display:inline-block;background-color:#f5b800;color:#0b0f1a;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:10px;">Open Support Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;">
                <p style="margin:16px 0 0 0;font-size:11px;color:#4b5563;">This link opens the ticket in the admin panel. You must already be signed in as an administrator to view it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function buildSupportNotificationEmailText(params: SupportNotificationEmailParams): string {
  const heading = params.kind === 'NEW_TICKET' ? 'New Support Ticket' : 'Customer Reply to Support Ticket'
  return [
    `EDGETRADE — ${heading}`,
    '',
    `Customer: ${params.customerLabel}`,
    `Ticket: #${shortTicketRef(params.ticketId)} — ${params.ticketSubject}`,
    `Category: ${params.categoryName}`,
    `Time: ${params.createdAt.toUTCString()}`,
    '',
    'Message preview:',
    params.messagePreview,
    '',
    'Open the ticket in the admin panel (sign-in required):',
    params.ticketUrl,
  ].join('\n')
}
