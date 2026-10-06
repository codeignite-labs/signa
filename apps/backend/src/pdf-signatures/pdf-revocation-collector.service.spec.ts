import { fetchPki } from './pki-http';
jest.mock('./pki-http', () => ({ fetchPki: jest.fn() }));
import { ConfigService } from '@nestjs/config';
import type { Certificate } from 'pkijs';
import type { PdfRevocationEvidence } from './entities/pdf-revocation-evidence.entity';
import { PdfRevocationCollectorService } from './pdf-revocation-collector.service';

type CollectedEvidence = {
  data: Buffer | null;
  status: 'good' | 'revoked' | 'unavailable' | 'unknown';
};

type CollectorInternals = {
  collectCrl(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence>;
  collectCrlUncached(input: {
    accountId: string;
    issuer: Certificate;
    signer: Certificate;
  }): Promise<CollectedEvidence>;
  singleFlight(
    key: string,
    operation: () => Promise<CollectedEvidence>,
  ): Promise<CollectedEvidence>;
};

describe('PdfRevocationCollectorService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('coalesces concurrent revocation requests and releases completed work', async () => {
    const collector = buildCollector() as unknown as CollectorInternals;
    let resolveOperation: ((value: CollectedEvidence) => void) | undefined;
    const operation = jest.fn(
      () =>
        new Promise<CollectedEvidence>((resolve) => {
          resolveOperation = resolve;
        }),
    );

    const first = collector.singleFlight('crl:1:certificate', operation);
    const second = collector.singleFlight('crl:1:certificate', operation);

    expect(operation).toHaveBeenCalledTimes(1);
    resolveOperation?.({ data: Buffer.from('crl'), status: 'good' });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    const subsequent = jest.fn(() =>
      Promise.resolve<CollectedEvidence>({
        data: null,
        status: 'unavailable',
      }),
    );

    await collector.singleFlight('crl:1:certificate', subsequent);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(subsequent).toHaveBeenCalledTimes(1);
  });

  it('revalidates cached CRL bytes instead of trusting cached status', async () => {
    const data = Buffer.from('cached-crl');
    const evidence = {
      dataBase64: data.toString('base64'),
      status: 'good',
    } as PdfRevocationEvidence;
    const cache = {
      findFresh: jest.fn().mockResolvedValue(evidence),
      store: jest.fn(),
    };
    const collector = buildCollector(cache) as unknown as CollectorInternals;
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      collector.collectCrl({
        accountId: '1',
        issuer: fakeCertificate(),
        signer: fakeCertificate(),
      }),
    ).resolves.toEqual({ data, status: 'unknown' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized CRL responses before buffering the body', async () => {
    const cache = {
      findFresh: jest.fn().mockResolvedValue(null),
      store: jest.fn().mockResolvedValue(null),
    };
    const collector = buildCollector(cache) as unknown as CollectorInternals;
    jest.mocked(fetchPki).mockResolvedValue(
      new Response('small-body', {
        headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
        status: 200,
      }),
    );

    await expect(
      collector.collectCrlUncached({
        accountId: '1',
        issuer: fakeCertificate(),
        signer: fakeCertificate('2.5.29.31'),
      }),
    ).resolves.toEqual({ data: null, status: 'unavailable' });
    expect(cache.store).toHaveBeenCalledWith(
      expect.objectContaining({ data: null, status: 'unavailable' }),
    );
  });
});

function buildCollector(cache?: {
  findFresh: jest.Mock;
  store: jest.Mock;
}): PdfRevocationCollectorService {
  return new PdfRevocationCollectorService(
    new ConfigService(),
    (cache ?? {
      findFresh: jest.fn().mockResolvedValue(null),
      store: jest.fn().mockResolvedValue(null),
    }) as never,
  );
}

function fakeCertificate(extensionOid?: string): Certificate {
  return {
    extensions: extensionOid
      ? [
          {
            extnID: extensionOid,
            toJSON: () => ({ uri: 'https://revocation.example.com/list.crl' }),
          },
        ]
      : [],
    serialNumber: {
      valueBlock: { toString: () => '01' },
    },
    toSchema: () => ({
      toBER: () => Uint8Array.from([1, 2, 3]).buffer,
    }),
  } as unknown as Certificate;
}
