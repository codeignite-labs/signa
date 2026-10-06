import { MailerService } from '@nestjs-modules/mailer';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { EncryptedConfig } from '../accounts/entities/encrypted-config.entity';
import { SignaI18nService } from '../internationalization/signa-i18n.service';
import {
  getDefaultMailSenderName,
  getMailRuntimeConfig,
} from '../runtime/mail-runtime-config';
import { EmailEvent } from './entities/email-event.entity';
import { EmailMessage } from './entities/email-message.entity';
import { MailBrandingService } from './mail-branding.service';
import { MailTemplateResolver } from './mail-template-resolver.service';
import type {
  MailAddress,
  MailAttachment,
  MailDeliveryResult,
  SendTemplateMailInput,
} from './mail.types';

type SentMessageInfo = {
  accepted?: unknown;
  rejected?: unknown;
  messageId?: string;
  response?: string;
};

type EmailIntegrationProvider = 'gmail';

type EmailIntegrationConfig = {
  provider?: EmailIntegrationProvider;
  email?: string | null;
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  token_type?: string;
};

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(EncryptedConfig)
    private readonly encryptedConfigs: Repository<EncryptedConfig>,
    @InjectRepository(EmailMessage)
    private readonly emailMessages: Repository<EmailMessage>,
    @InjectRepository(EmailEvent)
    private readonly emailEvents: Repository<EmailEvent>,
    private readonly branding: MailBrandingService,
    private readonly i18n: SignaI18nService,
    private readonly mailer: MailerService,
    private readonly templates: MailTemplateResolver,
  ) {}

  onModuleInit(): void {
    const mail = getMailRuntimeConfig(this.config);
    const provider =
      mail.host.includes('localhost') || mail.host.includes('mailpit')
        ? 'local-smtp'
        : 'external-smtp';

    this.logger.log(
      `Mail transport ready: enabled=${mail.enabled} provider=${provider} host=${mail.host} port=${mail.port} secure=${mail.secure} startTls=${mail.requireTls} authEnabled=${Boolean(mail.auth)}`,
    );
  }

  getHealthSnapshot(): {
    status: 'up' | 'degraded';
    message: string;
    details: Record<string, unknown>;
  } {
    const mail = getMailRuntimeConfig(this.config);

    return {
      status: mail.host && Number.isFinite(mail.port) ? 'up' : 'degraded',
      message: mail.enabled
        ? 'Mail transport is configured.'
        : 'Mail transport is configured but disabled.',
      details: {
        enabled: mail.enabled,
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        startTls: mail.requireTls,
        verifyTls: mail.rejectUnauthorized,
        authEnabled: Boolean(mail.auth),
        from: mail.from,
      },
    };
  }

  async sendTemplate(
    input: SendTemplateMailInput,
  ): Promise<MailDeliveryResult> {
    const mail = this.withLocaleContext(input);

    this.templates.assertTemplateExists(mail.template);

    if (!getMailRuntimeConfig(this.config).enabled) {
      this.logger.warn(
        `Mail disabled. Skipping template="${mail.template}" to=${formatRecipientLog(mail.to)}`,
      );

      await this.recordDelivery(mail, {
        status: 'skipped',
        accepted: [],
        rejected: [],
      });

      return {
        status: 'skipped',
        accepted: [],
        rejected: [],
      };
    }

    let info: SentMessageInfo;

    try {
      mail.context = {
        ...mail.context,
        ...(await this.branding.getAccountContext(mail.accountId)),
      };
      info = await this.send(mail);
    } catch (error) {
      const failure = normalizeMailFailure(error);

      await this.recordDelivery(mail, {
        status: 'failed',
        accepted: [],
        rejected: [],
        errorMessage: failure.message,
        errorStack: failure.stack,
      });

      throw error;
    }

    const rejected = normalizeStringArray(info.rejected);

    if (rejected.length > 0) {
      await this.recordDelivery(mail, {
        status: 'failed',
        accepted: normalizeStringArray(info.accepted),
        rejected,
        errorMessage: `SMTP rejected recipient(s): ${rejected.join(', ')}`,
        messageId: info.messageId,
        response: info.response,
      });

      throw new InternalServerErrorException({
        error: `SMTP rejected recipient(s): ${rejected.join(', ')}`,
      });
    }

    const result = {
      status: 'sent',
      accepted: normalizeStringArray(info.accepted),
      rejected,
      messageId: info.messageId,
      response: info.response,
    } satisfies MailDeliveryResult;

    await this.recordDelivery(mail, result);

    return result;
  }

  sendPasswordReset(input: {
    accountId?: string;
    email: string;
    firstName?: string | null;
    token: string;
  }): Promise<MailDeliveryResult> {
    const resetUrl = this.branding.getFrontendUrl(
      `/auth/reset-password?token=${encodeURIComponent(input.token)}`,
    );

    const subject = this.t('mail.subjects.password_reset', {
      defaultValue: 'Reset your password',
    });

    return this.sendTemplate({
      accountId: input.accountId,
      to: { email: input.email, name: input.firstName },
      subject,
      template: 'password-reset',
      context: {
        ...this.branding.getBaseContext(),
        actionLabel: this.t('mail.actions.change_password', {
          defaultValue: 'Change My Password',
        }),
        actionUrl: resetUrl,
        firstName:
          input.firstName ||
          this.t('mail.greetings.there', { defaultValue: 'there' }),
        resetUrl,
        subject,
      },
    });
  }

  sendAccountInvitation(input: {
    accountId: string;
    accountName: string;
    email: string;
    firstName?: string | null;
  }): Promise<MailDeliveryResult> {
    return this.sendUserInvitation({
      ...input,
      token: '',
      existingIdentity: true,
    });
  }

  sendUserInvitation(input: {
    accountId: string;
    accountName: string;
    email: string;
    firstName?: string | null;
    token: string;
    existingIdentity?: boolean;
  }): Promise<MailDeliveryResult> {
    const invitationUrl = this.branding.getFrontendUrl(
      input.existingIdentity
        ? '/settings/accounts'
        : `/auth/reset-password?token=${encodeURIComponent(input.token)}`,
    );

    const subject = this.t('mail.subjects.user_invitation', {
      args: { accountName: input.accountName },
      defaultValue: `You are invited to ${input.accountName}`,
    });

    return this.sendTemplate({
      accountId: input.accountId,
      to: { email: input.email, name: input.firstName },
      subject,
      template: 'user-invitation',
      context: {
        existingIdentity: input.existingIdentity,
        ...this.branding.getBaseContext(),
        accountName: input.accountName,
        actionLabel: this.t('mail.actions.accept_invitation', {
          defaultValue: 'Accept Invitation',
        }),
        actionUrl: invitationUrl,
        firstName:
          input.firstName ||
          this.t('mail.greetings.there', { defaultValue: 'there' }),
        invitationUrl,
        subject,
      },
    });
  }

  sendTeamInvitation(input: {
    accountId: string;
    accountName: string;
    email: string;
    expiresAt: Date;
    inviterName: string;
    role: string;
    teamName: string;
    token: string;
  }): Promise<MailDeliveryResult> {
    const invitationUrl = this.branding.getFrontendUrl(
      `/team-invitations/${encodeURIComponent(input.token)}/accept`,
    );
    const subject = this.t('mail.subjects.team_invitation', {
      args: { teamName: input.teamName },
      defaultValue: `You are invited to ${input.teamName}`,
    });

    return this.sendTemplate({
      accountId: input.accountId,
      to: { email: input.email },
      subject,
      template: 'team-invitation',
      context: {
        ...this.branding.getBaseContext(),
        accountName: input.accountName,
        actionLabel: this.t('mail.actions.accept_invitation', {
          defaultValue: 'Accept Invitation',
        }),
        actionUrl: invitationUrl,
        expiresAt: input.expiresAt.toISOString(),
        expiresAtLabel: formatMailDate(input.expiresAt),
        invitationUrl,
        inviterName: input.inviterName,
        role: input.role,
        subject,
        teamName: input.teamName,
      },
    });
  }

  sendSmtpSuccessfulSetup(input: {
    accountId?: string;
    email: string;
  }): Promise<MailDeliveryResult> {
    const subject = this.t('mail.subjects.smtp_successful_setup', {
      defaultValue: 'SMTP has been configured',
    });

    return this.sendTemplate({
      accountId: input.accountId,
      to: { email: input.email },
      subject,
      template: 'smtp-successful-setup',
      context: {
        ...this.branding.getBaseContext(),
        subject,
      },
    });
  }

  sendTemplateVerification(input: {
    accountId?: string;
    email: string;
    otpCode: string;
    templateName: string;
  }): Promise<MailDeliveryResult> {
    const subject = this.t('mail.subjects.template_otp_verification', {
      defaultValue: 'Email verification',
    });

    return this.sendTemplate({
      accountId: input.accountId,
      to: { email: input.email },
      subject,
      template: 'template-otp-verification',
      context: {
        ...this.branding.getBaseContext(),
        otpCode: input.otpCode,
        subject,
        templateName: input.templateName,
      },
    });
  }

  private withLocaleContext(
    input: SendTemplateMailInput,
  ): SendTemplateMailInput {
    const locale = this.i18n.snapshotLocale(input.locale);

    return {
      ...input,
      locale,
      context: {
        ...input.context,
        locale,
      },
    };
  }

  private t(
    key: string,
    input: {
      args?: Record<string, unknown>;
      defaultValue: string;
      lang?: string | null;
    },
  ): string {
    return this.i18n.translate(key, input);
  }

  private async send(input: SendTemplateMailInput): Promise<SentMessageInfo> {
    try {
      const integrationInfo = await this.sendWithConnectedProvider(input);

      if (integrationInfo) {
        return integrationInfo;
      }

      const info = (await this.mailer.sendMail({
        to: formatRecipients(input.to),
        from: formatAddress(input.from) ?? this.formatDefaultFrom(),
        replyTo: formatAddress(input.replyTo) ?? undefined,
        subject: input.subject,
        template: input.template,
        context: input.context ?? {},
        attachments: input.attachments,
      })) as SentMessageInfo;

      return info;
    } catch (error) {
      this.logger.error(
        `Failed to send template="${input.template}" to=${formatRecipientLog(input.to)}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private async sendWithConnectedProvider(
    input: SendTemplateMailInput,
  ): Promise<SentMessageInfo | null> {
    if (!input.accountId) {
      return null;
    }

    const integration = await this.findConnectedEmailIntegration(
      input.accountId,
    );

    if (!integration) {
      return null;
    }

    const value = parseEmailIntegrationConfig(integration.value);
    const accessToken = await this.getUsableAccessToken(integration, value);

    if (!accessToken) {
      this.logger.warn(
        `Connected ${value.provider} integration for account ${input.accountId} has no usable access token. Falling back to SMTP.`,
      );
      return null;
    }

    const html = this.templates.renderHtml(input.template, input.context ?? {});
    const from = value.email
      ? {
          email: value.email,
          name: getDefaultMailSenderName(this.config),
        }
      : undefined;

    if (value.provider === 'gmail') {
      await this.sendWithGmail(input, html, accessToken, from);

      return {
        accepted: formatRecipients(input.to),
        rejected: [],
        response: 'sent-via-gmail',
      };
    }

    return null;
  }

  private async findConnectedEmailIntegration(
    accountId: string,
  ): Promise<EncryptedConfig | null> {
    return this.encryptedConfigs.findOne({
      where: { accountId, key: 'email_integration:gmail' },
      order: { key: 'ASC' },
    });
  }

  private async getUsableAccessToken(
    config: EncryptedConfig,
    value: EmailIntegrationConfig,
  ): Promise<string | null> {
    if (!value.access_token || !value.provider) {
      return null;
    }

    if (!isExpired(value.expires_at)) {
      return value.access_token;
    }

    if (!value.refresh_token) {
      return null;
    }

    const refreshed = await this.refreshAccessToken(value);

    if (!refreshed?.access_token) {
      return null;
    }

    const nextValue = {
      ...value,
      access_token: refreshed.access_token,
      expires_at: refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        : value.expires_at,
      refresh_token: refreshed.refresh_token ?? value.refresh_token,
      token_type: refreshed.token_type ?? value.token_type,
    };

    config.value = JSON.stringify(nextValue);
    await this.encryptedConfigs.save(config);

    return refreshed.access_token;
  }

  private async refreshAccessToken(value: EmailIntegrationConfig): Promise<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    token_type?: string;
  } | null> {
    if (!value.provider || !value.refresh_token) {
      return null;
    }

    const settings = this.getProviderSettings();
    const response = await fetch(settings.tokenUrl, {
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: value.refresh_token,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok || !isRecord(payload)) {
      return null;
    }

    return {
      access_token:
        typeof payload.access_token === 'string'
          ? payload.access_token
          : undefined,
      expires_in:
        typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
      refresh_token:
        typeof payload.refresh_token === 'string'
          ? payload.refresh_token
          : undefined,
      token_type:
        typeof payload.token_type === 'string' ? payload.token_type : undefined,
    };
  }

  private async sendWithGmail(
    input: SendTemplateMailInput,
    html: string,
    accessToken: string,
    from?: MailAddress,
  ): Promise<void> {
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        body: JSON.stringify({
          raw: toBase64Url(buildMimeMessage(input, html, from)),
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    if (!response.ok) {
      throw new InternalServerErrorException({
        error: `Gmail rejected message: ${await response.text()}`,
      });
    }
  }

  private getProviderSettings(): {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  } {
    return {
      clientId: this.config.get<string>('GMAIL_OAUTH_CLIENT_ID', ''),
      clientSecret: this.config.get<string>('GMAIL_OAUTH_CLIENT_SECRET', ''),
      tokenUrl: 'https://oauth2.googleapis.com/token',
    };
  }

  private formatDefaultFrom(): string {
    return getMailRuntimeConfig(this.config).from;
  }

  private async recordDelivery(
    input: SendTemplateMailInput,
    result: MailDeliveryResult,
  ): Promise<void> {
    try {
      const recipients = formatRecipients(input.to);
      const trace = extractDeliveryTrace(input);
      const now = new Date();
      const message = await this.emailMessages.save(
        this.emailMessages.create({
          accountId: input.accountId ?? null,
          messageId: result.messageId ?? null,
          submissionId: trace.submissionId,
          submitterId: trace.submitterId,
          jobId: trace.jobId,
          attempt: trace.attempt,
          template: input.template,
          subject: input.subject,
          recipients: recipients.join(', '),
          sender: formatAddress(input.from) ?? this.formatDefaultFrom(),
          sha1: createHash('sha1')
            .update(
              JSON.stringify({
                template: input.template,
                subject: input.subject,
                recipients,
                messageId: result.messageId ?? null,
              }),
            )
            .digest('hex'),
          status: result.status,
          lastErrorMessage: result.errorMessage ?? null,
          lastErrorStack: result.errorStack ?? null,
          providerResponse: result.response ?? null,
          queuedAt: null,
          sentAt: result.status === 'sent' ? now : null,
          skippedAt: result.status === 'skipped' ? now : null,
          failedAt: result.status === 'failed' ? now : null,
          data: {
            accepted: result.accepted,
            rejected: result.rejected,
            error_message: result.errorMessage ?? null,
            response: result.response ?? null,
          },
        }),
      );

      await this.emailEvents.save(
        recipients.map((email) =>
          this.emailEvents.create({
            accountId: input.accountId ?? null,
            emailMessageId: message.id,
            email,
            eventType: result.status,
            eventDatetime: now,
            messageId: result.messageId ?? null,
            emailableType: trace.submitterId ? 'Submitter' : null,
            emailableId: trace.submitterId,
            data: {
              error_message: result.errorMessage ?? null,
              job_id: trace.jobId,
              submission_id: trace.submissionId,
              template: input.template,
              response: result.response ?? null,
            },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to persist email delivery event: ${(error as Error).message}`,
      );
    }
  }
}

function formatRecipients(input: MailAddress | MailAddress[]): string[] {
  return (Array.isArray(input) ? input : [input])
    .map(formatAddress)
    .filter((address): address is string => !!address);
}

function formatAddress(
  input: MailAddress | string | null | undefined,
): string | undefined {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    return input;
  }

  return input.name ? `"${input.name}" <${input.email}>` : input.email;
}

function formatRecipientLog(input: MailAddress | MailAddress[]): string {
  return formatRecipients(input).join(', ');
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function buildMimeMessage(
  input: SendTemplateMailInput,
  html: string,
  from?: MailAddress,
): string {
  const boundary = `signa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `To: ${formatRecipients(input.to).join(', ')}`,
    `From: ${formatAddress(from) ?? formatAddress(input.from) ?? 'Signa <no-reply@signa.com>'}`,
    ...(input.replyTo ? [`Reply-To: ${formatAddress(input.replyTo)}`] : []),
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(html),
    ...(input.attachments ?? []).flatMap((attachment) => [
      `--${boundary}`,
      `Content-Type: ${attachment.contentType ?? 'application/octet-stream'}; name="${escapeMimeParameter(attachment.filename ?? 'attachment')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${escapeMimeParameter(attachment.filename ?? 'attachment')}"`,
      '',
      attachmentToBase64(attachment),
    ]),
    `--${boundary}--`,
  ];

  return [...headers, '', ...parts].join('\r\n');
}

function parseEmailIntegrationConfig(value: string): EmailIntegrationConfig {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed)) {
      return {};
    }

    return {
      provider: parsed.provider === 'gmail' ? parsed.provider : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      access_token:
        typeof parsed.access_token === 'string'
          ? parsed.access_token
          : undefined,
      refresh_token:
        typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null,
      expires_at:
        typeof parsed.expires_at === 'string' ? parsed.expires_at : null,
      token_type:
        typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
    };
  } catch {
    return {};
  }
}

function isExpired(value: string | null | undefined): boolean {
  if (!value) {
    return true;
  }

  return new Date(value).getTime() - 60_000 <= Date.now();
}

function attachmentToBase64(attachment: MailAttachment): string {
  if (Buffer.isBuffer(attachment.content)) {
    return attachment.content.toString('base64');
  }

  if (typeof attachment.content === 'string') {
    return Buffer.from(attachment.content).toString('base64');
  }

  return '';
}

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function toQuotedPrintable(value: string): string {
  return value.replace(/[^\t\n\r -~]/g, (char) =>
    Buffer.from(char).toString('hex').toUpperCase().replace(/(..)/g, '=$1'),
  );
}

function encodeMimeHeader(value: string): string {
  return [...value].every((char) => char.charCodeAt(0) <= 127)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

function escapeMimeParameter(value: string): string {
  return value.replace(/"/g, '\\"');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function formatMailDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function extractDeliveryTrace(input: SendTemplateMailInput): {
  attempt: number;
  jobId: string | null;
  submissionId: string | null;
  submitterId: string | null;
} {
  return {
    attempt: Math.max(1, Number(input.delivery?.attempt ?? 1)),
    jobId:
      input.delivery?.jobId === undefined || input.delivery.jobId === null
        ? null
        : String(input.delivery.jobId),
    submissionId:
      input.delivery?.submissionId ??
      stringOrNull(input.context?.submissionId) ??
      null,
    submitterId:
      input.delivery?.submitterId ??
      stringOrNull(input.context?.submitterId) ??
      null,
  };
}

function normalizeMailFailure(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
