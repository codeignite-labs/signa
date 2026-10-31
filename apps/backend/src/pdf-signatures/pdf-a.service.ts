import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export type PdfAStatus =
  | 'converted'
  | 'disabled'
  | 'failed'
  | 'unavailable'
  | 'validated';

export type PdfAResult = {
  buffer: Buffer;
  metadata: {
    conversionStatus: PdfAStatus;
    enabled: boolean;
    error: string | null;
    level: string;
    required: boolean;
    validationStatus: PdfAStatus;
  };
};

@Injectable()
export class PdfAService {
  private readonly logger = new Logger(PdfAService.name);

  constructor(private readonly config: ConfigService) {}

  async convertBeforeSigning(pdfBuffer: Buffer): Promise<PdfAResult> {
    const enabled = this.config.get<boolean>('PDF_A_ENABLED', false);
    const required = this.config.get<boolean>('PDF_A_REQUIRED', false);
    const level = this.config.get<string>('PDF_A_LEVEL', '2b');

    if (!enabled) {
      if (required) {
        throw new UnprocessableEntityException({
          error: 'Required PDF/A conversion is disabled',
        });
      }
      return {
        buffer: pdfBuffer,
        metadata: disabledPdfA(required, level),
      };
    }

    const workspace = await mkdtemp(join(tmpdir(), 'signa-pdfa-'));

    try {
      const inputPath = join(workspace, `${uuidv4()}.pdf`);
      const outputPath = join(workspace, `${uuidv4()}-pdfa.pdf`);

      await writeFile(inputPath, pdfBuffer);
      await this.runGhostscript({ inputPath, level, outputPath });
      const converted = await readFile(outputPath);
      const validationStatus = await this.validateWithVeraPdf(
        outputPath,
        level,
      );
      if (required && validationStatus !== 'validated') {
        throw new UnprocessableEntityException({
          error: `Required PDF/A conformance validation ${validationStatus}`,
        });
      }

      return {
        buffer: converted,
        metadata: {
          conversionStatus: 'converted',
          enabled: true,
          error: null,
          level,
          required,
          validationStatus,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (required) {
        throw error;
      }

      this.logger.warn(`PDF/A conversion skipped: ${message}`);
      return {
        buffer: pdfBuffer,
        metadata: {
          conversionStatus: isMissingBinaryError(message)
            ? 'unavailable'
            : 'failed',
          enabled: true,
          error: message,
          level,
          required,
          validationStatus: 'unavailable',
        },
      };
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }

  private async runGhostscript(input: {
    inputPath: string;
    level: string;
    outputPath: string;
  }): Promise<void> {
    const binary = this.config.get<string>('PDF_A_GHOSTSCRIPT_PATH', 'gs');
    const majorLevel = input.level.startsWith('1')
      ? '1'
      : input.level.startsWith('3')
        ? '3'
        : '2';

    await runProcess(
      binary,
      [
        '-dBATCH',
        '-dNOPAUSE',
        '-dNOOUTERSAVE',
        `-dPDFA=${majorLevel}`,
        '-dPDFACompatibilityPolicy=1',
        '-sDEVICE=pdfwrite',
        '-sColorConversionStrategy=RGB',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        `-sOutputFile=${input.outputPath}`,
        input.inputPath,
      ],
      this.config.get<number>('PDF_A_TIMEOUT_MS', 60_000),
    );
  }

  private async validateWithVeraPdf(
    path: string,
    level: string,
  ): Promise<PdfAStatus> {
    const binary = this.config.get<string>('PDF_A_VERAPDF_PATH', 'verapdf');

    try {
      const report = await runProcess(
        binary,
        ['--format', 'json', '--flavour', level, path],
        this.config.get<number>('PDF_A_TIMEOUT_MS', 60_000),
      );

      return hasCompliantVeraPdfReport(report) ? 'validated' : 'failed';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isMissingBinaryError(message)) {
        return 'unavailable';
      }

      return 'failed';
    }
  }
}

function disabledPdfA(
  required: boolean,
  level: string,
): PdfAResult['metadata'] {
  return {
    conversionStatus: 'disabled',
    enabled: false,
    error: null,
    level,
    required,
    validationStatus: 'disabled',
  };
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const stderr: Buffer[] = [];
    const stdout: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));

    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }

      reject(
        new Error(
          `${command} exited with ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ),
      );
    });
  });
}

function isMissingBinaryError(message: string): boolean {
  return message.includes('ENOENT') || message.includes('not found');
}

// veraPDF JsonHandler serializes report.jobs[].validationResult[] with compliant booleans.
function hasCompliantVeraPdfReport(output: string): boolean {
  const document: unknown = JSON.parse(output);
  if (!isRecord(document) || !isRecord(document.report)) return false;
  const jobs = document.report.jobs;
  if (!Array.isArray(jobs) || jobs.length !== 1) return false;
  const job: unknown = jobs[0];
  if (!isRecord(job) || !Array.isArray(job.validationResult)) return false;
  return (
    job.validationResult.length > 0 &&
    job.validationResult.every(
      (result: unknown) =>
        isRecord(result) &&
        result.compliant === true &&
        result.jobEndStatus === 'normal',
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
