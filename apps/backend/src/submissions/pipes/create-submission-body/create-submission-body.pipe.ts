import {
  Injectable,
  PipeTransform,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import {
  CreateSubmissionBatchDto,
  CreateSubmissionDto,
} from '../../dto/create-submission.dto';

type SubmissionBody =
  | CreateSubmissionDto
  | CreateSubmissionBatchDto
  | CreateSubmissionDto[];

@Injectable()
export class CreateSubmissionBodyPipe implements PipeTransform<
  unknown,
  Promise<SubmissionBody>
> {
  private readonly validation = new ValidationPipe({
    transform: true,
    // The DocuSeal-compatible union accepts extension properties. Services still
    // derive account ownership from the authenticated user, never this body.
    whitelist: false,
    forbidUnknownValues: true,
  });

  async transform(value: unknown): Promise<SubmissionBody> {
    if (Array.isArray(value)) {
      return Promise.all(
        value.map((entry: unknown) =>
          this.validate(entry, CreateSubmissionDto),
        ),
      );
    }
    const isBatch =
      value !== null && typeof value === 'object' && 'submissions' in value;
    return isBatch
      ? this.validate(value, CreateSubmissionBatchDto)
      : this.validate(value, CreateSubmissionDto);
  }

  private async validate<T extends object>(
    value: unknown,
    metatype: Type<T>,
  ): Promise<T> {
    return (await this.validation.transform(value, {
      type: 'body',
      metatype,
    })) as T;
  }
}
