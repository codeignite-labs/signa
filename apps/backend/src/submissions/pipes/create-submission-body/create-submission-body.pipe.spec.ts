import { BadRequestException } from '@nestjs/common';
import { CreateSubmissionDto } from '../../dto/create-submission.dto';
import { CreateSubmissionBodyPipe } from './create-submission-body.pipe';
const valid = {
  template_id: '42',
  submitters: [
    {
      email: 'user@example.test',
      values: { Approved: true },
      metadata: { external: 123 },
    },
  ],
};
it('validates single, numeric-id, array and batch bodies without losing arbitrary value dictionaries', async () => {
  const pipe = new CreateSubmissionBodyPipe();
  expect(await pipe.transform(valid)).toEqual(valid);
  expect(await pipe.transform({ ...valid, template_id: 42 })).toEqual(valid);
  const array = (await pipe.transform([valid])) as CreateSubmissionDto[];
  expect(array).toEqual([valid]);
  expect(array[0]).toBeInstanceOf(CreateSubmissionDto);
  expect(await pipe.transform({ submissions: [valid] })).toEqual({
    submissions: [valid],
  });
  expect(
    await pipe.transform({ ...valid, compatible_extension: true }),
  ).toMatchObject({ compatible_extension: true });
});
it.each([
  null,
  undefined,
  42,
  'text',
  {},
  { template_id: '42', submitters: 'wrong' },
  { ...valid, submitters: [{ email: 42 }] },
  { ...valid, submitters: [{ message: { subject: '' } }] },
  { submissions: [{ ...valid, submitters: [{ email: 42 }] }] },
  [{ ...valid, submitters: [{ metadata: 'not an object' }] }],
])('rejects malformed union requests before persistence: %p', async (input) => {
  await expect(
    new CreateSubmissionBodyPipe().transform(input),
  ).rejects.toBeInstanceOf(BadRequestException);
});
