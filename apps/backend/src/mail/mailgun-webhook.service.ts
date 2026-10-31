import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { MailgunWebhookReceipt } from './entities/mailgun-webhook-receipt.entity';

const maxSignatureAgeSeconds = 24 * 60 * 60;
const maxFutureSkewSeconds = 5 * 60;

@Injectable()
export class MailgunWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly source: DataSource,
  ) {}

  async recordOnce(
    body: unknown,
    record: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    if (this.source.options.type !== 'postgres') {
      throw new ServiceUnavailableException({
        error: 'Mailgun replay protection requires PostgreSQL',
      });
    }
    const receipt = verifyMailgunReceipt(
      body,
      this.config.get<string>('MAILGUN_WEBHOOK_SIGNING_KEY'),
    );
    await this.source.transaction((manager) =>
      this.recordInTransaction(manager, receipt, record),
    );
  }

  private async recordInTransaction(
    manager: EntityManager,
    receipt: MailgunWebhookReceipt,
    record: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    const receipts = manager.getRepository(MailgunWebhookReceipt);
    await receipts.delete({ expiresAt: LessThan(new Date()) });
    const inserted = await receipts
      .createQueryBuilder()
      .insert()
      .values(receipt)
      .orIgnore()
      .returning('token_hash')
      .execute();
    const rows: unknown = inserted.raw;
    if (Array.isArray(rows) && rows.length === 1) {
      await record(manager);
      return;
    }
    const previous = await receipts.findOneByOrFail({
      tokenHash: receipt.tokenHash,
    });
    if (previous.payloadHash !== receipt.payloadHash) {
      throw new ForbiddenException({
        error: 'Mailgun callback replay changed its payload',
      });
    }
  }
}

function verifyMailgunReceipt(
  body: unknown,
  key?: string,
): MailgunWebhookReceipt {
  if (!key || !isRecord(body) || !isRecord(body.signature))
    return invalidSignature();
  const { timestamp, token, signature } = parseSignature(body.signature);
  const seconds = Number(timestamp);
  const age = Date.now() / 1000 - seconds;
  if (
    !Number.isSafeInteger(seconds) ||
    age > maxSignatureAgeSeconds ||
    age < -maxFutureSkewSeconds
  )
    return invalidSignature();
  const expected = createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
  const provided = Buffer.from(signature);
  const digest = Buffer.from(expected);
  if (provided.length !== digest.length || !timingSafeEqual(provided, digest))
    return invalidSignature();
  return Object.assign(new MailgunWebhookReceipt(), {
    tokenHash: sha256(token),
    payloadHash: sha256(JSON.stringify(canonicalJson(body))),
    expiresAt: new Date(
      (seconds + maxSignatureAgeSeconds + maxFutureSkewSeconds) * 1000,
    ),
  });
}

function parseSignature(value: Record<string, unknown>): {
  timestamp: string;
  token: string;
  signature: string;
} {
  const { timestamp, token, signature } = value;
  if (
    typeof timestamp !== 'string' ||
    !/^\d+$/.test(timestamp) ||
    typeof token !== 'string' ||
    !token.trim() ||
    typeof signature !== 'string'
  )
    return invalidSignature();
  return { timestamp, token, signature };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function invalidSignature(): never {
  throw new ForbiddenException({ error: 'Invalid Mailgun signature' });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
