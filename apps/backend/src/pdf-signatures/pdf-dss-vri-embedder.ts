import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type PdfDssEvidence = {
  certificateDer: Buffer[];
  crlResponses: Buffer[];
  ocspResponses: Buffer[];
  vriKey: string;
};

export type ParsedPdfDssEvidence = {
  certificateDer: Buffer[];
  crlResponses: Buffer[];
  hasMatchingVri: boolean;
  ocspResponses: Buffer[];
};

export type PdfDssReadContext = {
  dssObject: string | null;
  pdfBuffer: Buffer;
  text: string;
};

type PdfObject = {
  body: string;
  objectNumber: number;
};

@Injectable()
export class PdfDssVriEmbedder {
  private readonly logger = new Logger(PdfDssVriEmbedder.name);

  embed(input: { evidences: PdfDssEvidence[]; pdfBuffer: Buffer }): Buffer {
    const usefulEvidence = input.evidences.filter(
      (evidence) =>
        evidence.certificateDer.length ||
        evidence.ocspResponses.length ||
        evidence.crlResponses.length,
    );

    if (!usefulEvidence.length) {
      return input.pdfBuffer;
    }

    try {
      const context = parseIncrementalContext(input.pdfBuffer);
      const builder = new IncrementalPdfBuilder(input.pdfBuffer, context);
      const dssObjectRef = this.createDssObject(
        builder,
        context,
        usefulEvidence,
      );
      const catalogBody = replaceOrAppendDictionaryEntry(
        context.catalogBody,
        'DSS',
        dssObjectRef,
      );

      builder.addObject(context.catalogObjectNumber, catalogBody);

      return builder.finalize();
    } catch (error) {
      this.logger.warn(
        `Skipping DSS/VRI embedding: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return input.pdfBuffer;
    }
  }

  prepareRead(pdfBuffer: Buffer): PdfDssReadContext {
    const text = pdfBuffer.toString('latin1');
    const dssRef = [...text.matchAll(/\/DSS\s+(\d+)\s+\d+\s+R/g)].at(-1)?.[1];

    return {
      dssObject: dssRef ? readPdfObject(text, Number(dssRef)) : null,
      pdfBuffer,
      text,
    };
  }

  read(input: {
    context?: PdfDssReadContext;
    pdfBuffer?: Buffer;
    vriKey: string;
  }): ParsedPdfDssEvidence {
    const context =
      input.context ??
      (input.pdfBuffer ? this.prepareRead(input.pdfBuffer) : null);

    if (!context?.dssObject) {
      return emptyParsedEvidence(false);
    }

    const vriRef = new RegExp(`/${input.vriKey}\\s+(\\d+)\\s+\\d+\\s+R`).exec(
      context.dssObject,
    )?.[1];

    if (!vriRef) {
      return emptyParsedEvidence(false);
    }

    const vriObject = readPdfObject(context.text, Number(vriRef));

    return {
      certificateDer: readStreamRefs(
        context.pdfBuffer,
        context.text,
        vriObject,
        'Cert',
      ),
      crlResponses: readStreamRefs(
        context.pdfBuffer,
        context.text,
        vriObject,
        'CRL',
      ),
      hasMatchingVri: true,
      ocspResponses: readStreamRefs(
        context.pdfBuffer,
        context.text,
        vriObject,
        'OCSP',
      ),
    };
  }

  private createDssObject(
    builder: IncrementalPdfBuilder,
    context: IncrementalPdfContext,
    evidences: PdfDssEvidence[],
  ): string {
    const existingDss = context.dssObject ?? '';
    const allCertRefs = readReferenceArray(existingDss, 'Certs');
    const allOcspRefs = readReferenceArray(existingDss, 'OCSPs');
    const allCrlRefs = readReferenceArray(existingDss, 'CRLs');
    const replacedVriKeys = new Set(
      evidences.map((evidence) => evidence.vriKey),
    );
    const vriEntries = readVriEntries(existingDss).filter(
      ({ key }) => !replacedVriKeys.has(key),
    );
    const streamRefs = new Map<string, string>();

    for (const ref of [...allCertRefs, ...allOcspRefs, ...allCrlRefs]) {
      const objectNumber = Number(ref.split(' ')[0]);
      const bytes = readStreamObject(
        context.pdfBuffer,
        context.text,
        objectNumber,
      )[0];

      if (bytes) {
        streamRefs.set(hashBytes(bytes), ref);
      }
    }

    const addStream = (bytes: Buffer): string => {
      const hash = hashBytes(bytes);
      const existing = streamRefs.get(hash);

      if (existing) {
        return existing;
      }

      const ref = builder.addStreamObject(bytes);
      streamRefs.set(hash, ref);
      return ref;
    };

    for (const evidence of evidences) {
      const certRefs = unique(evidence.certificateDer.map(addStream));
      const ocspRefs = unique(evidence.ocspResponses.map(addStream));
      const crlRefs = unique(evidence.crlResponses.map(addStream));
      const vriFields = [
        certRefs.length ? `/Cert [${certRefs.join(' ')}]` : null,
        ocspRefs.length ? `/OCSP [${ocspRefs.join(' ')}]` : null,
        crlRefs.length ? `/CRL [${crlRefs.join(' ')}]` : null,
      ].filter((field): field is string => Boolean(field));
      const vriRef = builder.addObject(
        builder.nextObjectNumber(),
        ['<<', ...vriFields, '>>'].join('\n'),
      );

      allCertRefs.push(...certRefs);
      allOcspRefs.push(...ocspRefs);
      allCrlRefs.push(...crlRefs);
      vriEntries.push({ key: evidence.vriKey, ref: vriRef });
    }

    return builder.addObject(
      builder.nextObjectNumber(),
      [
        '<<',
        `/Certs [${unique(allCertRefs).join(' ')}]`,
        `/OCSPs [${unique(allOcspRefs).join(' ')}]`,
        `/CRLs [${unique(allCrlRefs).join(' ')}]`,
        `/VRI << ${vriEntries
          .map(({ key, ref }) => `/${key} ${ref}`)
          .join(' ')} >>`,
        '>>',
      ].join('\n'),
    );
  }
}

class IncrementalPdfBuilder {
  private readonly objects: PdfObject[] = [];
  private objectNumberCursor: number;

  constructor(
    private readonly pdfBuffer: Buffer,
    private readonly context: IncrementalPdfContext,
  ) {
    this.objectNumberCursor = context.size;
  }

  nextObjectNumber(): number {
    this.objectNumberCursor += 1;

    return this.objectNumberCursor;
  }

  addObject(objectNumber: number, body: string): string {
    this.objects.push({ body, objectNumber });

    return `${objectNumber} 0 R`;
  }

  addStreamObject(bytes: Buffer): string {
    const objectNumber = this.nextObjectNumber();
    const header = `<< /Length ${bytes.byteLength} >>\nstream\n`;
    const footer = '\nendstream';
    const body = Buffer.concat([
      Buffer.from(header, 'latin1'),
      bytes,
      Buffer.from(footer, 'latin1'),
    ]).toString('latin1');

    return this.addObject(objectNumber, body);
  }

  finalize(): Buffer {
    const chunks: Buffer[] = [this.pdfBuffer, Buffer.from('\n', 'latin1')];
    const offsets = new Map<number, number>();
    let cursor = this.pdfBuffer.byteLength + 1;

    for (const object of this.objects) {
      offsets.set(object.objectNumber, cursor);
      const serialized = Buffer.from(
        `${object.objectNumber} 0 obj\n${object.body}\nendobj\n`,
        'latin1',
      );
      chunks.push(serialized);
      cursor += serialized.byteLength;
    }

    const xrefOffset = cursor;
    const xref = this.serializeXref(offsets);
    const trailer = [
      'trailer',
      `<< /Size ${this.objectNumberCursor + 1} /Root ${this.context.catalogObjectNumber} 0 R /Prev ${this.context.previousStartXref} >>`,
      'startxref',
      String(xrefOffset),
      '%%EOF',
      '',
    ].join('\n');

    chunks.push(Buffer.from(xref + trailer, 'latin1'));

    return Buffer.concat(chunks);
  }

  private serializeXref(offsets: Map<number, number>): string {
    return (
      'xref\n' +
      [...offsets.entries()]
        .sort(([left], [right]) => left - right)
        .map(([objectNumber, offset]) =>
          [
            `${objectNumber} 1`,
            `${String(offset).padStart(10, '0')} 00000 n `,
            '',
          ].join('\n'),
        )
        .join('')
    );
  }
}

type IncrementalPdfContext = {
  catalogBody: string;
  catalogObjectNumber: number;
  dssObject: string | null;
  pdfBuffer: Buffer;
  previousStartXref: number;
  size: number;
  text: string;
};

function parseIncrementalContext(pdfBuffer: Buffer): IncrementalPdfContext {
  const text = pdfBuffer.toString('latin1');
  const trailerMatch = [
    ...text.matchAll(/trailer\s*<<([\s\S]*?)>>\s*startxref\s+(\d+)\s+%%EOF/g),
  ].at(-1);
  const trailer = trailerMatch?.[1];
  const previousStartXref = Number(trailerMatch?.[2]);

  if (!Number.isSafeInteger(previousStartXref) || !trailer) {
    throw new Error('PDF trailer could not be parsed');
  }

  const rootMatch = /\/Root\s+(\d+)\s+\d+\s+R/.exec(trailer);
  const sizeMatch = /\/Size\s+(\d+)/.exec(trailer);

  if (!rootMatch || !sizeMatch) {
    throw new Error('PDF trailer Root or Size entry is missing');
  }

  const catalogObjectNumber = Number(rootMatch[1]);
  const catalogBody = readPdfObject(text, catalogObjectNumber);
  const dssObjectNumber = Number(
    /\/DSS\s+(\d+)\s+\d+\s+R/.exec(catalogBody)?.[1],
  );

  return {
    catalogBody,
    catalogObjectNumber,
    dssObject: Number.isSafeInteger(dssObjectNumber)
      ? readPdfObject(text, dssObjectNumber)
      : null,
    pdfBuffer,
    previousStartXref,
    size: Number(sizeMatch[1]),
    text,
  };
}

function readPdfObject(text: string, objectNumber: number): string {
  const matches = [
    ...text.matchAll(
      new RegExp(
        `(?:^|[\\r\\n])${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)endobj`,
        'g',
      ),
    ),
  ];
  const match = matches.at(-1);

  if (!match) {
    throw new Error(`PDF object ${objectNumber} 0 could not be found`);
  }

  return match[1].trim();
}

function replaceOrAppendDictionaryEntry(
  dictionary: string,
  key: string,
  value: string,
): string {
  const entryPattern = new RegExp(
    `/${key}\\s+(?:\\d+\\s+\\d+\\s+R|<<[\\s\\S]*?>>)`,
  );

  if (entryPattern.test(dictionary)) {
    return dictionary.replace(entryPattern, `/${key} ${value}`);
  }

  const end = dictionary.lastIndexOf('>>');

  if (end === -1) {
    throw new Error('PDF catalog dictionary is malformed');
  }

  return `${dictionary.slice(0, end).trimEnd()}\n/${key} ${value}\n${dictionary.slice(end)}`;
}

function readStreamRefs(
  pdfBuffer: Buffer,
  text: string,
  object: string,
  key: string,
): Buffer[] {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(object);

  if (!match) {
    return [];
  }

  const refs = [...match[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((ref) =>
    Number(ref[1]),
  );

  return refs.flatMap((objectNumber) =>
    readStreamObject(pdfBuffer, text, objectNumber),
  );
}

function readReferenceArray(object: string, key: string): string[] {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(object);

  return match
    ? [...match[1].matchAll(/(\d+\s+\d+\s+R)/g)].map((ref) => ref[1])
    : [];
}

function readVriEntries(object: string): Array<{ key: string; ref: string }> {
  const dictionary = /\/VRI\s*<<([\s\S]*?)>>/.exec(object)?.[1];

  return dictionary
    ? [...dictionary.matchAll(/\/([A-Fa-f0-9]+)\s+(\d+\s+\d+\s+R)/g)].map(
        (match) => ({ key: match[1], ref: match[2] }),
      )
    : [];
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function readStreamObject(
  pdfBuffer: Buffer,
  text: string,
  objectNumber: number,
): Buffer[] {
  const header = [
    ...text.matchAll(
      new RegExp(
        `(?:^|[\\r\\n])${objectNumber}\\s+0\\s+obj\\s*<<([^>]+)>>\\s*stream(?:\\r\\n|\\n)`,
        'g',
      ),
    ),
  ].at(-1);
  if (!header || /\/Filter\b/.test(header[1])) return [];
  const length = Number(/\/Length\s+(\d+)\s*(?:\/|$)/.exec(header[1])?.[1]);
  if (!Number.isSafeInteger(length) || length < 0) return [];
  const start = header.index + header[0].length;
  const end = start + length;
  if (
    end > pdfBuffer.length ||
    !/^[\r\n]+endstream/.test(text.slice(end, end + 14))
  )
    return [];
  return [pdfBuffer.subarray(start, end)];
}

function emptyParsedEvidence(hasMatchingVri: boolean): ParsedPdfDssEvidence {
  return {
    certificateDer: [],
    crlResponses: [],
    hasMatchingVri,
    ocspResponses: [],
  };
}
