import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { RuntimeObservabilityService } from './runtime-observability.service';
import { HealthService } from './health.service';
jest.mock('node:fs/promises', () => ({
  ...jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises'),
  readFile: jest.fn(),
}));
jest.mock('node:net', () => ({
  ...jest.requireActual<typeof import('node:net')>('node:net'),
  Socket: jest.fn(),
}));
jest.mock('node:tls', () => ({
  ...jest.requireActual<typeof import('node:tls')>('node:tls'),
  connect: jest.fn(),
}));
class TestSocket extends EventEmitter {
  replies: string[] = ['+PONG'];
  connectionError: Error | undefined;
  timeoutHandler: (() => void) | undefined;
  write = jest.fn((command: string) => {
    void command;
    const reply = this.replies.shift();
    if (reply !== undefined)
      queueMicrotask(() => this.emit('data', Buffer.from(reply)));
    return true;
  });
  end = jest.fn();
  destroy = jest.fn();
  setTimeout = jest.fn((duration: number, callback: () => void) => {
    void duration;
    this.timeoutHandler = callback;
    return this;
  });
  connect = jest.fn(() => {
    queueMicrotask(() =>
      this.connectionError
        ? this.emit('error', this.connectionError)
        : this.emit('connect'),
    );
    return this;
  });
}
function setup(options: Record<string, unknown> = {}) {
  const db = { query: jest.fn().mockResolvedValue([]) };
  const storage = {
    checkAvailability: jest.fn().mockResolvedValue({ backend: 'local' }),
  };
  const observation = {
    getApiPerformanceSnapshot: jest
      .fn()
      .mockReturnValue({ status: 'up', message: 'healthy', details: {} }),
  };
  const service = new HealthService(
    db as unknown as DataSource,
    new ConfigService(options),
    observation as unknown as RuntimeObservabilityService,
    storage as unknown as StorageService,
  );
  return { service, db, storage, observation };
}
let socket: TestSocket;
beforeEach(() => {
  socket = new TestSocket();
  jest.mocked(Socket).mockImplementation(() => socket as unknown as Socket);
  jest.mocked(tlsConnect).mockImplementation(() => {
    socket.connect();
    return socket as unknown as TLSSocket;
  });
  jest
    .mocked(readFile)
    .mockResolvedValue(JSON.stringify({ name: 'backend', version: '1.2.3' }));
  jest.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 0,
    heapTotal: 128 * 1024 * 1024,
    heapUsed: 64 * 1024 * 1024,
    external: 0,
    arrayBuffers: 0,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it('reports live/readiness metadata and caches package reads without requiring Redis', async () => {
  const { service, db } = setup();
  expect(await service.live()).toMatchObject({
    status: 'ok',
    service: 'backend',
    version: '1.2.3',
    environment: 'test',
  });
  expect(await service.ready()).toMatchObject({
    status: 'ok',
    database: { status: 'up' },
    storage: { status: 'up' },
    redis: { status: 'up', details: { configured: false } },
  });
  expect(db.query).toHaveBeenCalledWith('SELECT 1');
  expect(readFile).toHaveBeenCalledTimes(1);
});
it('uses configured release metadata and tolerates missing or malformed package metadata', async () => {
  const configured = setup({
    APP_VERSION: '9.8.7',
    APP_COMMIT_SHA: 'commit',
    APP_BUILD_TIME: '2026-10-31T00:00:00Z',
    NODE_ENV: 'production',
  }).service;
  expect(await configured.live()).toMatchObject({
    version: '9.8.7',
    commitSha: 'commit',
    buildTime: '2026-10-31T00:00:00Z',
    environment: 'production',
  });
  jest.mocked(readFile).mockRejectedValueOnce(new Error('missing'));
  expect(await setup().service.live()).toMatchObject({
    service: 'backend',
    version: 'unknown',
  });
  jest.mocked(readFile).mockResolvedValueOnce('not-json');
  expect(await setup().service.live()).toMatchObject({ version: 'unknown' });
});
it('keeps dependency and performance degradation distinct from critical readiness failures', async () => {
  const { service, db, storage, observation } = setup();
  observation.getApiPerformanceSnapshot.mockReturnValue({
    status: 'degraded',
    message: 'slow',
    details: {},
  });
  expect((await service.detailed()).status).toBe('degraded');
  expect((await service.ready()).status).toBe('ok');
  observation.getApiPerformanceSnapshot.mockReturnValue({
    status: 'up',
    message: 'healthy',
    details: {},
  });
  expect((await service.detailed()).status).toBe('ok');
  db.query.mockRejectedValueOnce(new Error('DB unavailable'));
  expect(await service.ready()).toMatchObject({
    status: 'error',
    database: { status: 'down', message: 'DB unavailable' },
  });
  db.query.mockRejectedValueOnce('failure');
  expect((await service.detailed()).database?.message).toContain(
    'Database query failed',
  );
  storage.checkAvailability.mockRejectedValueOnce(
    new Error('Storage unavailable'),
  );
  expect(await service.ready()).toMatchObject({
    status: 'error',
    storage: { status: 'down', message: 'Storage unavailable' },
  });
  storage.checkAvailability.mockRejectedValueOnce(null);
  expect((await service.detailed()).storage?.message).toContain(
    'Configured storage',
  );
  expect(
    await setup({ HEALTH_HEAP_LIMIT_MB: 1 }).service.detailed(),
  ).toMatchObject({ status: 'error', memory: { status: 'degraded' } });
});
it.each([
  'redis://localhost:6379',
  'rediss://localhost',
  'redis://user:pass%21@localhost:6380',
  'redis://:pass@localhost',
])(
  'validates a Redis PING over %s without exposing credentials',
  async (REDIS_URL) => {
    socket.replies = REDIS_URL.includes('pass') ? ['+OK', '+PONG'] : ['+PONG'];
    const result = await setup({
      REDIS_URL,
      HEALTH_REDIS_REQUIRED: true,
    }).service.ready();
    expect(result).toMatchObject({
      status: 'ok',
      redis: { status: 'up', details: { configured: true, required: true } },
    });
    expect(socket.end).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.redis)).not.toContain('pass');
    expect(socket.write.mock.calls.at(-1)?.[0]).toContain('PING');
    if (REDIS_URL.startsWith('rediss:'))
      expect(tlsConnect).toHaveBeenCalledWith({
        host: 'localhost',
        port: 6379,
      });
    if (REDIS_URL.includes('pass'))
      expect(socket.write.mock.calls[0][0]).toContain('AUTH');
  },
);
it('surfaces failed authentication and unexpected replies without treating them as healthy', async () => {
  socket.replies = ['-ERR invalid'];
  let result = await setup({
    REDIS_URL: 'redis://:pass@localhost',
  }).service.detailed();
  expect(result).toMatchObject({
    status: 'degraded',
    redis: { status: 'degraded' },
  });
  expect(result.redis?.message).toContain('Redis auth failed');
  socket.replies = ['-ERR unsupported'];
  result = await setup({
    REDIS_URL: 'redis://localhost',
    HEALTH_REDIS_REQUIRED: true,
  }).service.ready();
  expect(result).toMatchObject({ status: 'error', redis: { status: 'down' } });
});
it('degrades an optional connection failure, blocks required Redis and reports invalid URLs safely', async () => {
  socket.connectionError = new Error('refused');
  let result = await setup({ REDIS_URL: 'redis://localhost' }).service.ready();
  expect(result).toMatchObject({
    status: 'ok',
    redis: { status: 'degraded', message: 'refused' },
  });
  expect(socket.destroy).toHaveBeenCalled();
  result = await setup({
    REDIS_URL: 'redis://localhost',
    HEALTH_REDIS_REQUIRED: true,
  }).service.detailed();
  expect(result.status).toBe('error');
  result = await setup({ REDIS_URL: 'invalid URL' }).service.ready();
  expect(result.redis?.details).toMatchObject({
    endpoint: 'invalid-redis-url',
  });
});
it('handles a connect timeout and cleans up a timed-out Redis command', async () => {
  socket.connect.mockImplementation(() => socket);
  const pending = setup({
    REDIS_URL: 'redis://localhost',
    HEALTH_REDIS_REQUIRED: true,
  }).service.ready();
  socket.timeoutHandler?.();
  expect((await pending).redis?.message).toContain('timed out');
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  socket = new TestSocket();
  socket.replies = [];
  jest.mocked(Socket).mockImplementation(() => socket as unknown as Socket);
  const timed = setup({
    REDIS_URL: 'redis://localhost',
    HEALTH_REDIS_TIMEOUT_MS: 10,
  }).service.ready();
  await jest.advanceTimersByTimeAsync(20);
  expect((await timed).redis?.message).toContain('timed out');
  expect(socket.listenerCount('data')).toBe(0);
  expect(socket.end).toHaveBeenCalledTimes(1);
});
