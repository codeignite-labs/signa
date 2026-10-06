import { fetchPki } from './pki-http';
import { parsePemCertificates } from './certificate-validation-path';
import { Certificate } from 'pkijs';
import {
  parseTimestampResponse,
  validateTimestampToken,
} from './timestamp-validation';
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import forge from 'node-forge';

export type TimestampServerAttempt = {
  error?: string;
  status: 'success' | 'failed';
  url: string;
};

export type TimestampTokenResult = {
  attempts: TimestampServerAttempt[];
  token: Buffer | null;
  url: string | null;
};

const sha256AlgorithmOid = '2.16.840.1.101.3.4.2.1';
const defaultTimestampTimeoutMs = 10_000;

@Injectable()
export class Rfc3161TimestampClient {
  private readonly logger = new Logger(Rfc3161TimestampClient.name);

  constructor(private readonly config: ConfigService) {}

  async assertTimestampServerWorks(value: string): Promise<void> {
    const result = await this.requestTimestampToken({
      digest: createHash('sha256').update('signa-tsa-validation').digest(),
      serverUrls: parseTimestampServerUrls(value),
    });

    if (!result.token) {
      throw new UnprocessableEntityException({
        error: this.buildValidationError(result.attempts),
      });
    }
  }

  async requestTimestampToken(input: {
    digest: Buffer;
    serverUrls: string[];
  }): Promise<TimestampTokenResult> {
    const attempts: TimestampServerAttempt[] = [];

    for (const serverUrl of input.serverUrls) {
      const { token, ...attempt } = await this.requestFromOneServer(
        serverUrl,
        input.digest,
      );
      attempts.push({ ...attempt, url: timestampEndpointLabel(serverUrl) });

      if (attempt.status === 'success' && token) {
        return {
          attempts,
          token,
          url: timestampEndpointLabel(serverUrl),
        };
      }
    }

    return { attempts, token: null, url: null };
  }

  private async requestFromOneServer(
    serverUrl: string,
    digest: Buffer,
  ): Promise<TimestampServerAttempt & { token?: Buffer }> {
    try {
      const request = buildTimestampRequest(digest);
      const earliestTime = new Date();
      const response = await this.postTimestampRequest(serverUrl, request);
      const responseBody = Buffer.from(await response.arrayBuffer());

      if (!response.ok || responseBody.length === 0) {
        return {
          error: `Unexpected TSA response ${response.status}`,
          status: 'failed',
          url: serverUrl,
        };
      }

      const { token } = parseTimestampResponse(responseBody, request);
      await validateTimestampToken({
        token,
        digest,
        trustedCertificates: this.trustedCertificates(),
        earliestTime,
      });
      return {
        status: 'success',
        token,
        url: serverUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`RFC3161 timestamp request failed: ${message}`);

      return { error: message, status: 'failed', url: serverUrl };
    }
  }

  private postTimestampRequest(serverUrl: string, request: Buffer) {
    const url = new URL(serverUrl);
    const headers: Record<string, string> = {
      'content-type': 'application/timestamp-query',
    };

    if (url.username || url.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
      ).toString('base64')}`;
      url.username = '';
      url.password = '';
    }

    return fetchPki(url, {
      body: new Uint8Array(request),
      headers,
      method: 'POST',
      timeoutMs: this.getTimeoutMs(),
      maxBytes: 1024 * 1024,
    });
  }

  private buildValidationError(attempts: TimestampServerAttempt[]): string {
    const lastFailure = [...attempts]
      .reverse()
      .find((attempt) => attempt.error);

    return lastFailure?.error
      ? `Invalid timestamp server: ${lastFailure.error}`
      : 'Invalid timestamp server';
  }

  private trustedCertificates(): Certificate[] {
    return parsePemCertificates(
      this.config.get<string>('PDF_TSA_TRUST_CERTIFICATES', ''),
    );
  }

  private getTimeoutMs(): number {
    return this.config.get<number>(
      'PDF_TIMESTAMP_TIMEOUT_MS',
      defaultTimestampTimeoutMs,
    );
  }
}

export function parseTimestampServerUrls(value: string | null): string[] {
  const urls = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeTimestampServerUrl);
  if (urls.length > 3)
    throw new UnprocessableEntityException(
      'Configure at most three timestamp endpoints',
    );
  return urls;
}

export function buildTimestampRequest(digest: Buffer): Buffer {
  const request = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.INTEGER,
        false,
        '\x01',
      ),
      buildMessageImprint(digest),
      buildNonce(),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.BOOLEAN,
        false,
        '\xff',
      ),
    ],
  );

  return Buffer.from(forge.asn1.toDer(request).getBytes(), 'binary');
}

function buildMessageImprint(digest: Buffer) {
  return forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SEQUENCE,
    true,
    [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SEQUENCE,
        true,
        [
          forge.asn1.create(
            forge.asn1.Class.UNIVERSAL,
            forge.asn1.Type.OID,
            false,
            forge.asn1.oidToDer(sha256AlgorithmOid).getBytes(),
          ),
          forge.asn1.create(
            forge.asn1.Class.UNIVERSAL,
            forge.asn1.Type.NULL,
            false,
            '',
          ),
        ],
      ),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OCTETSTRING,
        false,
        digest.toString('binary'),
      ),
    ],
  );
}

function buildNonce() {
  const nonce = randomBytes(16);
  nonce[0] &= 0x7f;

  return forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.INTEGER,
    false,
    nonce.toString('binary'),
  );
}

function normalizeTimestampServerUrl(value: string): string {
  if (value.length > 2048)
    throw new UnprocessableEntityException(
      'Timestamp endpoint exceeds maximum length',
    );
  const url = new URL(value);
  if ((url.username || url.password) && url.protocol !== 'https:')
    throw new UnprocessableEntityException(
      'Authenticated TSA endpoints require HTTPS',
    );

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnprocessableEntityException({
      error: 'Timestamp server URL must use HTTP or HTTPS',
    });
  }

  return value;
}

export function timestampEndpointLabel(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}
