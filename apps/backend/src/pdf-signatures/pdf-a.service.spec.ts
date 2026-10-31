import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { PdfAService } from './pdf-a.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
  writeFile: jest.fn(),
}));

type ProcessOutcome = {
  code?: number | null;
  error?: Error;
  stderr?: string;
  stdout?: string;
  pending?: boolean;
};
function setup(
  values: Record<string, unknown> = {},
  outcomes: ProcessOutcome[] = [{ code: 0 }, { code: 0 }],
) {
  const children: Array<
    EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter;
      kill: jest.Mock;
    }
  > = [];
  jest.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      stdout: new EventEmitter(),
      kill: jest.fn(),
    });
    children.push(child);
    const result = outcomes.shift() ?? { code: 0 };
    if (!result.pending)
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            result.stdout ??
              JSON.stringify({
                report: {
                  jobs: [
                    {
                      validationResult: [
                        { compliant: true, jobEndStatus: 'normal' },
                      ],
                    },
                  ],
                },
              }),
          ),
        );
        if (result.stderr)
          child.stderr.emit('data', Buffer.from(result.stderr));
        if (result.error) child.emit('error', result.error);
        else child.emit('close', result.code);
      });
    return child as unknown as ReturnType<typeof spawn>;
  });
  const service = new PdfAService(
    new ConfigService({ PDF_A_ENABLED: true, ...values }),
  );
  return { service, children };
}
const original = Buffer.from('original PDF');
const converted = Buffer.from('converted PDF/A');

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(mkdtemp).mockResolvedValue('/tmp/synthetic-pdfa');
  jest.mocked(readFile).mockResolvedValue(converted);
  jest.mocked(writeFile).mockResolvedValue(undefined);
  jest.mocked(rm).mockResolvedValue(undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('returns original bytes and disabled metadata without filesystem or binary access by default', async () => {
  const service = new PdfAService(new ConfigService());
  expect(await service.convertBeforeSigning(original)).toEqual({
    buffer: original,
    metadata: {
      enabled: false,
      required: false,
      level: '2b',
      conversionStatus: 'disabled',
      validationStatus: 'disabled',
      error: null,
    },
  });
  expect(mkdtemp).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it.each([
  ['1b', '1'],
  ['2b', '2'],
  ['3b', '3'],
])(
  'converts PDF/A %s using configured tools and validates the result',
  async (level, major) => {
    const { service } = setup({
      PDF_A_LEVEL: level,
      PDF_A_GHOSTSCRIPT_PATH: '/tools/gs',
      PDF_A_VERAPDF_PATH: '/tools/verapdf',
    });
    expect(await service.convertBeforeSigning(original)).toEqual({
      buffer: converted,
      metadata: {
        enabled: true,
        required: false,
        level,
        conversionStatus: 'converted',
        validationStatus: 'validated',
        error: null,
      },
    });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/synthetic-pdfa\/.+\.pdf$/),
      original,
    );
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      '/tools/gs',
      expect.arrayContaining([
        `-dPDFA=${major}`,
        '-dPDFACompatibilityPolicy=1',
        '-sDEVICE=pdfwrite',
        '-dEmbedAllFonts=true',
      ]),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      '/tools/verapdf',
      [
        '--format',
        'json',
        '--flavour',
        level,
        expect.stringMatching(/-pdfa\.pdf$/),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(rm).toHaveBeenCalledWith('/tmp/synthetic-pdfa', {
      force: true,
      recursive: true,
    });
  },
);

it.each([
  [{ error: new Error('spawn gs ENOENT') }, 'unavailable'],
  [{ error: new Error('gs not found') }, 'unavailable'],
  [{ code: 1, stderr: ' invalid document \n' }, 'failed'],
  [{ code: null }, 'failed'],
] as const)(
  'returns original bytes after optional conversion failure (%s)',
  async (outcome, status) => {
    const { service } = setup({}, [outcome]);
    const result = await service.convertBeforeSigning(original);
    expect(result.buffer).toBe(original);
    expect(result.metadata).toMatchObject({
      conversionStatus: status,
      validationStatus: 'unavailable',
      enabled: true,
    });
    expect(result.metadata.error).toBeTruthy();
    if ('stderr' in outcome)
      expect(result.metadata.error).toContain('invalid document');
    expect(rm).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  },
);

it('propagates required conversion failures and still cleans up temporary documents', async () => {
  const failure = new Error('cannot convert');
  const { service } = setup({ PDF_A_REQUIRED: true }, [{ error: failure }]);
  await expect(service.convertBeforeSigning(original)).rejects.toBe(failure);
  expect(rm).toHaveBeenCalledWith('/tmp/synthetic-pdfa', {
    force: true,
    recursive: true,
  });
});

it.each([
  [{ error: new Error('spawn verapdf ENOENT') }, 'unavailable'],
  [{ code: 1, stderr: 'validation failed' }, 'failed'],
])(
  'reports validation outcome independently from conversion (%s)',
  async (outcome, status) => {
    const { service } = setup({}, [{ code: 0 }, outcome]);
    const result = await service.convertBeforeSigning(original);
    expect(result.buffer).toBe(converted);
    expect(result.metadata).toMatchObject({
      conversionStatus: 'converted',
      validationStatus: status,
      error: null,
    });
  },
);

it('kills a timed-out converter and cleans temporary files', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  const { service, children } = setup({ PDF_A_TIMEOUT_MS: 25 }, [
    { pending: true },
  ]);
  const conversion = service.convertBeforeSigning(original);
  await jest.advanceTimersByTimeAsync(25);
  const result = await conversion;
  expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
  expect(result.metadata).toMatchObject({
    conversionStatus: 'failed',
    error: 'gs timed out after 25ms',
  });
  expect(rm).toHaveBeenCalledTimes(1);
});

it('handles non-Error filesystem failures and cleans the workspace', async () => {
  const { service } = setup();
  jest.mocked(writeFile).mockRejectedValue('disk unavailable');
  const result = await service.convertBeforeSigning(original);
  expect(result.metadata).toMatchObject({
    conversionStatus: 'failed',
    error: 'disk unavailable',
  });
  expect(spawn).not.toHaveBeenCalled();
  expect(rm).toHaveBeenCalledTimes(1);
});

it.each([
  { code: 1 },
  { error: new Error('verapdf ENOENT') },
  {
    code: 0,
    stdout: JSON.stringify({
      report: {
        jobs: [
          { validationResult: [{ compliant: false, jobEndStatus: 'normal' }] },
        ],
      },
    }),
  },
  { code: 0, stdout: 'invalid JSON' },
])(
  'rejects required PDF/A when validation cannot establish conformance %#',
  async (outcome) => {
    const { service } = setup({ PDF_A_REQUIRED: true }, [{ code: 0 }, outcome]);
    await expect(service.convertBeforeSigning(original)).rejects.toMatchObject({
      status: 422,
    });
    expect(rm).toHaveBeenCalledTimes(1);
  },
);

it.each([
  '{}',
  'null',
  '[]',
  '{"report":{}}',
  '{"report":{"jobs":[]}}',
  '{"report":{"jobs":[null]}}',
  '{"report":{"jobs":[{}]}}',
  '{"report":{"jobs":[{"validationResult":[]}]}}',
  '{"report":{"jobs":[{"validationResult":[{"compliant":true,"jobEndStatus":"aborted"}]}]}}',
])(
  'does not treat zero-exit incomplete reports as verified conformance %s',
  async (stdout) => {
    const { service } = setup({}, [{ code: 0 }, { code: 0, stdout }]);
    const result = await service.convertBeforeSigning(original);
    expect(result.metadata.validationStatus).toBe('failed');
  },
);

it('allows required PDF/A only after a successful conformance report', async () => {
  const { service } = setup({ PDF_A_REQUIRED: true });
  expect((await service.convertBeforeSigning(original)).metadata).toMatchObject(
    {
      required: true,
      conversionStatus: 'converted',
      validationStatus: 'validated',
    },
  );
});

it('rejects contradictory required-but-disabled configuration', async () => {
  const { service } = setup({ PDF_A_REQUIRED: true, PDF_A_ENABLED: false });
  await expect(service.convertBeforeSigning(original)).rejects.toMatchObject({
    status: 422,
  });
  expect(mkdtemp).not.toHaveBeenCalled();
});
