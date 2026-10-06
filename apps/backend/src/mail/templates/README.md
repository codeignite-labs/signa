# Signa Email Templates

These templates mirror DocuSeal's mailer surface while using Signa branding.

Compatibility rules:

- Use table-based layout and inline styles for broad email-client support.
- Keep media queries defensive only; core layout must work without them.
- Use absolute image URLs in runtime context. Do not rely on relative paths in production email.
- Avoid external fonts, JavaScript, forms, CSS grid, flexbox-dependent structure, and background images.

Expected runtime branding context:

- `logoUrl`: durable absolute URL for the account logo, platform fallback, or null for a white-label text identity.
- `logoBackground`: legacy compatibility value, now `transparent`.
- `showBusinessName`: whether to display the account title beside the logo. The account title remains the identity fallback when no logo is available.
- `productName`: account display name (platform name for unscoped emails).
- `whiteLabel`: hides platform attribution.
- `brandPrimary` / `brandPrimaryForeground`: contrast-adjusted button colors.
- `brandBackground`, `brandForeground`, `brandMutedForeground`, `brandMuted`, `brandBorder`: account palette for email chrome.
- `accountName`: sender/account display name.
- `locale`: email document language.

Recommended env values:

- `MAIL_LOGO_URL`: absolute URL for `apps/frontend/public/images/logo.png`.
- `MAIL_ASSET_BASE_URL`: absolute base URL for the illustration directory.

Suggested illustration asset names:

- `signature-invitation.png`
- `document-completed.png`
- `document-copy.png`
- `security-code.png`
- `team-invitation.png`
- `password-reset.png`
- `smtp-success.png`

Place the final illustration files somewhere publicly served, for example:

`apps/frontend/public/images/email/`

Then provide absolute URLs through mail context, such as:

`https://your-domain.com/images/email/signature-invitation.png`

`MailService` resolves branding from the sending account immediately before delivery. SMTP and connected Gmail delivery use the same templates. Sender addresses and provider account identities remain controlled by the existing mail configuration. Custom `MAIL_TEMPLATE_DIR` templates must consume these context values to display account branding.
