import { ConfigService } from '@nestjs/config';
const mockCreateApp = jest.fn();
const mockCreateDocument = jest.fn(() => ({ openapi: '3.0.0' }));
const mockSetupSwagger = jest.fn(
  (_path: string, _app: unknown, factory: () => unknown) => factory(),
);
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual<typeof import('@nestjs/core')>('@nestjs/core'),
  NestFactory: {
    create: (...args: unknown[]) => mockCreateApp(...args) as unknown,
  },
}));
jest.mock('@nestjs/config', () => ({
  ...jest.requireActual<typeof import('@nestjs/config')>('@nestjs/config'),
  ConfigModule: { forRoot: () => ({ module: class TestConfigModule {} }) },
}));
jest.mock('@nestjs/swagger', () => ({
  ...jest.requireActual<typeof import('@nestjs/swagger')>('@nestjs/swagger'),
  SwaggerModule: {
    createDocument: (...args: unknown[]) => mockCreateDocument(...(args as [])),
    setup: (...args: unknown[]) =>
      mockSetupSwagger(...(args as [string, unknown, () => unknown])),
  },
}));
const previous = {
  PORT: process.env.PORT,
  HOSTNAME: process.env.HOSTNAME,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  NODE_ENV: process.env.NODE_ENV,
};
afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
it.each([false, true])(
  'configures safe HTTP parsing, validation, middleware and documented auth in the application entrypoint (production=%s)',
  async (production) => {
    jest.resetModules();
    mockCreateApp.mockClear();
    mockCreateDocument.mockClear();
    mockSetupSwagger.mockClear();
    if (production) {
      process.env.PORT = '4101';
      process.env.HOSTNAME = '127.0.0.1';
      process.env.NODE_ENV = 'production';
    } else {
      delete process.env.PORT;
      delete process.env.HOSTNAME;
      process.env.NODE_ENV = 'development';
    }
    const config = new ConfigService({
      ATTACHMENT_INGEST_MAX_BYTES: 3 * 1024 * 1024,
    });
    const app = {
      get: jest.fn((token: { name: string }) =>
        token.name === 'ConfigService' ? config : {},
      ),
      useBodyParser: jest.fn(),
      setGlobalPrefix: jest.fn(),
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      enableShutdownHooks: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
      getUrl: jest.fn().mockResolvedValue('http://test.local'),
    };
    mockCreateApp.mockResolvedValue(app);
    jest.requireActual<typeof import('./main')>('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.useBodyParser).toHaveBeenCalledWith('json', {
      limit: 5 * 1024 * 1024,
    });
    expect(app.useBodyParser).toHaveBeenCalledWith('urlencoded', {
      extended: true,
      limit: 1024 * 1024,
    });
    expect(app.use).toHaveBeenCalledTimes(6);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(
      production ? 4101 : 3001,
      production ? '127.0.0.1' : '0.0.0.0',
    );
    expect(mockSetupSwagger).toHaveBeenCalledWith(
      'api/docs',
      app,
      expect.any(Function),
    );
    expect(mockCreateDocument).toHaveBeenCalledTimes(1);
  },
);
