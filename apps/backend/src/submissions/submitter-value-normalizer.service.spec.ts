import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { SubmitterValueNormalizer } from './submitter-value-normalizer.service';

const pngDataUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('SubmitterValueNormalizer', () => {
  let normalizer: SubmitterValueNormalizer;
  let storage: jest.Mocked<
    Pick<
      StorageService,
      'findRecordAttachments' | 'createAttachment' | 'readSignedBlobUrl'
    >
  >;

  beforeEach(() => {
    storage = {
      readSignedBlobUrl: jest.fn().mockResolvedValue(null),
      findRecordAttachments: jest.fn().mockResolvedValue([]),
      createAttachment: jest.fn(),
    };
    normalizer = new SubmitterValueNormalizer(
      storage as unknown as StorageService,
      {
        get: jest.fn((_key: string, fallback: unknown) => fallback),
      } as unknown as ConfigService,
    );
  });

  it('maps field names to UUIDs and normalizes base64 image attachments', async () => {
    const result = await normalizer.normalizeCreateInput({
      templateFields: [
        {
          uuid: 'profile-image',
          name: 'Profile Image',
          type: 'image',
          submitter_uuid: 'first-party',
        },
      ],
      submitterInput: {
        role: 'First Party',
        values: {
          profile_image: pngDataUri,
        },
      },
      submitterUuid: 'first-party',
    });

    const attachment = result.pendingAttachments[0];

    expect(result.input.values).toEqual({
      'profile-image': attachment?.uuid,
    });
    expect(attachment).toMatchObject({
      filename: 'image.png',
      contentType: 'image/png',
    });
    expect(attachment?.metadata).toEqual(
      expect.objectContaining({
        analyzed: true,
        identified: true,
        signing_type: 'image',
      }),
    );
  });

  it('generates typed signature attachments for short signature text', async () => {
    const result = await normalizer.normalizeCreateInput({
      templateFields: [
        {
          uuid: 'signature-field',
          name: 'Signature',
          type: 'signature',
          submitter_uuid: 'first-party',
        },
      ],
      submitterInput: {
        values: {
          Signature: 'Ada Lovelace',
        },
      },
      submitterUuid: 'first-party',
    });

    const attachment = result.pendingAttachments[0];

    expect(result.input.values).toEqual({
      'signature-field': attachment?.uuid,
    });
    expect(attachment).toMatchObject({
      filename: 'signature.png',
      contentType: 'image/png',
    });
    expect(attachment?.metadata).toEqual(
      expect.objectContaining({
        generated_from_text: true,
        signing_type: 'signature',
      }),
    );
    expect(attachment?.buffer.byteLength).toBeGreaterThan(0);
  });

  it('normalizes arrays for multi-file attachment fields', async () => {
    const result = await normalizer.normalizeCreateInput({
      templateFields: [
        {
          uuid: 'supporting-files',
          name: 'Supporting Files',
          type: 'file',
          submitter_uuid: 'first-party',
        },
      ],
      submitterInput: {
        values: {
          'Supporting Files': [pngDataUri, pngDataUri],
        },
      },
      submitterUuid: 'first-party',
    });

    expect(result.pendingAttachments).toHaveLength(2);
    const value = result.input.values?.['supporting-files'];

    expect(Array.isArray(value)).toBe(true);
    expect([...(value as string[])].sort()).toEqual(
      result.pendingAttachments.map((attachment) => attachment.uuid).sort(),
    );
  });

  it('preserves existing uploaded attachment UUIDs on submitter update', async () => {
    storage.findRecordAttachments.mockResolvedValue([
      { uuid: 'uploaded-attachment-uuid' },
    ] as never);

    const result = await normalizer.normalizeUpdateInput(
      {
        id: 'submitter-1',
        uuid: 'first-party',
        accountId: 'account-1',
        submission: {
          templateFields: [
            {
              uuid: 'image-field',
              name: 'Image',
              type: 'image',
              submitter_uuid: 'first-party',
            },
          ],
        },
      } as Submitter,
      {
        values: {
          Image: 'uploaded-attachment-uuid',
        },
      },
    );

    expect(result.input.values).toEqual({
      'image-field': 'uploaded-attachment-uuid',
    });
    expect(result.pendingAttachments).toEqual([]);
  });

  it('rejects non-HTTPS URL ingestion like DocuSeal API normalization', async () => {
    await expect(
      normalizer.normalizeCreateInput({
        templateFields: [
          {
            uuid: 'file-field',
            name: 'File',
            type: 'file',
            submitter_uuid: 'first-party',
          },
        ],
        submitterInput: {
          values: {
            File: 'http://example.com/file.pdf',
          },
        },
        submitterUuid: 'first-party',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('imports own-instance signed attachments through storage without downloading them', async () => {
    storage.readSignedBlobUrl.mockResolvedValue({
      buffer: Buffer.from('%PDF local'),
      filename: 'Original.pdf',
      contentType: 'application/pdf',
    });
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('must not use network'));
    try {
      const result = await normalizer.normalizeCreateInput({
        templateFields: [
          { uuid: 'file', name: 'File', type: 'file', submitter_uuid: 'party' },
        ],
        submitterInput: {
          values: {
            File: 'http://localhost:3001/api/storage/blobs/signed/Original.pdf',
          },
        },
        submitterUuid: 'party',
      });
      expect(result.pendingAttachments[0]).toMatchObject({
        buffer: Buffer.from('%PDF local'),
        filename: 'Original.pdf',
        contentType: 'application/pdf',
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('persists pending attachments against the created submitter', async () => {
    await normalizer.persistPendingAttachments(
      { id: 'submitter-1' } as Submitter,
      [
        {
          uuid: 'attachment-uuid',
          buffer: Buffer.from('file'),
          filename: 'file.txt',
          contentType: 'text/plain',
          metadata: { analyzed: true },
        },
      ],
    );

    expect(storage.createAttachment).toHaveBeenCalledWith({
      buffer: Buffer.from('file'),
      filename: 'file.txt',
      contentType: 'text/plain',
      name: 'attachments',
      recordType: 'Submitter',
      recordId: 'submitter-1',
      uuid: 'attachment-uuid',
      metadata: { analyzed: true },
    });
  });
});
