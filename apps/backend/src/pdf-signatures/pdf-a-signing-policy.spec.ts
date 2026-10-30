import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { PdfAService } from './pdf-a.service';
import { PdfSignatureService } from './pdf-signature.service';

it('stops PDF parsing, timestamping and signing when required PDF/A cannot run', async () => {
  const config = new ConfigService({
    PDF_A_REQUIRED: true,
    PDF_A_ENABLED: false,
  });
  const requestTimestampToken = jest.fn();
  const collectForSignedPdf = jest.fn();
  const embed = jest.fn();
  const signature = new PdfSignatureService(
    {} as never,
    config,
    { requestTimestampToken } as never,
    { collectForSignedPdf } as never,
    { embed } as never,
    new PdfAService(config),
  );
  jest.spyOn(signature, 'loadDefaultCertificate').mockResolvedValue({
    certificate: {} as never,
    name: 'Synthetic identity',
  });
  jest.spyOn(signature, 'getTimestampServerUrl').mockResolvedValue(null);
  const loadPdf = jest.spyOn(PDFDocument, 'load');
  const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  try {
    await expect(
      signature.signPdf({
        accountId: 'organization',
        buffer: Buffer.from('never parsed'),
        reason: 'completion',
        signerName: 'Synthetic signer',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { error: 'Required PDF/A conversion is disabled' },
    });
    expect(loadPdf).not.toHaveBeenCalled();
    expect(requestTimestampToken).not.toHaveBeenCalled();
    expect(collectForSignedPdf).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
  }
});
