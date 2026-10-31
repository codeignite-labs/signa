import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { GlobalExceptionFilter } from './global-exception.filter';

function invoke(exception: unknown, requestId?: string) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = {
    requestId,
    method: 'POST',
    url: '/api/sign',
    ip: '127.0.0.1',
    body: {
      password: 'private',
      nested: [{ access_token: 'private', value: 42 }],
    },
    query: { token: 'private' },
    params: { id: 'doc' },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return response;
}
const logMessages: unknown[] = [];
let currentContext: I18nContext | undefined;
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  logMessages.length = 0;
  currentContext = undefined;
  jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation((message: unknown) => {
      logMessages.push(message);
    });
  jest.spyOn(I18nContext, 'current').mockImplementation(() => currentContext);
});
it.each([
  [new HttpException('Not allowed', 403), 403, 'Not allowed'],
  [new HttpException({ error: 'Denied' }, 401), 401, 'Denied'],
  [
    new HttpException({ message: ['Missing name', 'Missing email'] }, 400),
    400,
    'Missing name, Missing email',
  ],
  [new HttpException({ message: 'Invalid' }, 422), 422, 'Invalid'],
  [new Error('Failure'), 500, 'Failure'],
  [new Error(''), 500, 'Internal server error'],
  ['Failure', 500, 'Failure'],
  [{ status: 429 }, 429, 'Internal server error'],
  [{ status: 399 }, 500, 'Internal server error'],
  [{ status: 600 }, 500, 'Internal server error'],
  [{ status: 400.5 }, 500, 'Internal server error'],
  [{ status: '400' }, 500, 'Internal server error'],
  [null, 500, 'Internal server error'],
  [12, 500, 'Internal server error'],
])('formats error %p without losing HTTP status', (error, status, message) => {
  const response = invoke(error, 'trace');
  expect(response.status).toHaveBeenCalledWith(status);
  expect(response.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: status,
      error: message,
      message,
      requestId: 'trace',
      path: '/api/sign',
      timestamp: expect.any(String) as unknown,
    }),
  );
});
it('redacts sensitive request data recursively and supplies a fallback request ID', () => {
  invoke(new Error('Failure'));
  expect(logMessages[0]).toMatchObject({
    requestId: 'unknown',
    body: {
      password: '[REDACTED]',
      nested: [{ access_token: '[REDACTED]', value: 42 }],
    },
    query: { token: '[REDACTED]' },
    params: { id: 'doc' },
  });
});
it('handles malformed HttpException bodies without throwing while reporting the exception message', () => {
  const exception = new HttpException('Fallback', 400);
  jest.spyOn(exception, 'getResponse').mockReturnValue(null as never);
  expect(invoke(exception).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'Fallback' }),
  );
  expect(invoke(new HttpException({}, 400)).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.any(String) as unknown }),
  );
});
it('translates HTTP keys with the correct arguments and deterministic fallbacks', () => {
  const translate = jest.fn().mockReturnValue('Traduit');
  currentContext = { translate, lang: 'fr' } as unknown as I18nContext;
  expect(
    invoke(
      new HttpException(
        {
          i18n_key: 'errors.denied',
          i18n_args: { role: 'viewer' },
          error: 'Denied',
        },
        403,
      ),
    ).json,
  ).toHaveBeenCalledWith(expect.objectContaining({ error: 'Traduit' }));
  expect(translate).toHaveBeenCalledWith('errors.denied', {
    args: { role: 'viewer' },
    defaultValue: 'Denied',
    lang: 'fr',
  });
  currentContext = undefined;
  for (const [body, message] of [
    [{ i18n_key: 'key' }, 'key'],
    [{ i18n_key: 'key', message: ['One', 'Two'] }, 'One,Two'],
    [{ i18n_key: 'key', error: 'Fallback' }, 'Fallback'],
  ] as const)
    expect(invoke(new HttpException(body, 400)).json).toHaveBeenCalledWith(
      expect.objectContaining({ error: message }),
    );
});
it('flattens nested validation messages, translates constraints and handles empty validation results', () => {
  const errors = [
    {
      property: 'user',
      constraints: { isDefined: 'Required' },
      children: [
        {
          property: 'email',
          value: 'bad',
          constraints: { isEmail: 'Invalid email' },
        },
      ],
    },
  ];
  expect(invoke(new I18nValidationException(errors)).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'Required, Invalid email' }),
  );
  const translate = jest
    .fn()
    .mockImplementation((key: string) =>
      key === 'validation.messages.failed' ? 'Failed' : 'Translated',
    );
  currentContext = { translate, lang: 'en' } as unknown as I18nContext;
  expect(invoke(new I18nValidationException(errors)).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'Translated, Translated' }),
  );
  translate.mockReturnValue({ unexpected: 'object' });
  expect(invoke(new I18nValidationException(errors)).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'Required, Invalid email' }),
  );
  translate.mockReturnValue('Failed');
  expect(
    invoke(new I18nValidationException([{ property: 'empty' }])).json,
  ).toHaveBeenCalledWith(expect.objectContaining({ error: 'Failed' }));
  currentContext = undefined;
  expect(invoke(new I18nValidationException([])).json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'Validation failed' }),
  );
});
