import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../../auth/authenticated-request';
import { RuntimeObservabilityService } from '../../health/runtime-observability.service';
import { requestIdMiddleware, RequestWithId } from './request-id.middleware';
import { httpObservabilityMiddleware } from './http-observability.middleware';
import { buildSafeRequestLog } from '../utils/log-redaction';

afterEach(() => jest.restoreAllMocks());
it('preserves an upstream request ID or generates a UUID and invokes the next handler once', () => {
  for (const id of ['upstream-id', undefined]) {
    const request = {
      header: jest.fn().mockReturnValue(id),
    } as unknown as RequestWithId;
    const setHeader = jest.fn();
    const next = jest.fn();
    requestIdMiddleware()(request, { setHeader } as unknown as Response, next);
    expect(request.requestId).toEqual(
      id ?? expect.stringMatching(/^[\da-f-]{36}$/),
    );
    expect(setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  }
});
it('records the completed response duration without leaking query strings into route labels', () => {
  const record = jest.fn();
  const on = jest.fn<void, [string, () => void]>();
  const next = jest.fn();
  const timer = jest
    .spyOn(process.hrtime, 'bigint')
    .mockReturnValueOnce(1_000_000n)
    .mockReturnValueOnce(3_500_000n);
  httpObservabilityMiddleware({
    recordHttpRequest: record,
  } as unknown as RuntimeObservabilityService)(
    {
      method: 'GET',
      originalUrl: '/api/documents?token=private',
    } as AuthenticatedRequest,
    { on, statusCode: 200 } as unknown as Response,
    next as NextFunction,
  );
  expect(next).toHaveBeenCalledTimes(1);
  expect(record).not.toHaveBeenCalled();
  on.mock.calls[0][1]();
  expect(record).toHaveBeenCalledWith('GET /api/documents', 200, 2.5);
  expect(timer).toHaveBeenCalledTimes(2);
});
it('redacts case-insensitive secrets in nested objects/arrays without mutating the input', () => {
  const request = {
    body: {
      Authorization: 'private',
      items: [{ password: 'private' }, null, 5],
    },
    query: { cookie: 'private', q: 'public' },
    params: undefined,
  } as unknown as Request;
  expect(buildSafeRequestLog(request)).toEqual({
    body: {
      Authorization: '[REDACTED]',
      items: [{ password: '[REDACTED]' }, null, 5],
    },
    query: { cookie: '[REDACTED]', q: 'public' },
    params: undefined,
  });
  expect(request.body as unknown).toMatchObject({ Authorization: 'private' });
});
it('uses empty-traffic, healthy, degraded, slow-request and expiry states correctly', () => {
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const service = new RuntimeObservabilityService(
    new ConfigService({
      API_HEALTH_MIN_REQUEST_COUNT: 2,
      API_HEALTH_P95_DEGRADED_MS: 1000,
      API_HEALTH_WINDOW_MS: 60000,
    }),
  );
  service.recordHttpRequest('', 200, 10);
  service.recordHttpRequest('GET /health', 500, 9000);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'up',
    details: { routeCount: 0 },
  });
  service.recordHttpRequest(' GET /docs ', 200, 20);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'up',
    details: { requestCount: 1, averageDurationMs: 20 },
  });
  service.recordHttpRequest('GET /docs', 500, 70);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'degraded',
    details: { requestCount: 2, errorRatePercent: 50, approximateP95Ms: 100 },
  });
  service.recordHttpRequest('POST /sign', 200, 6000);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'degraded',
    details: {
      slowRequestCount: 1,
      approximateP95Ms: 5000,
      maxDurationMs: 6000,
    },
  });
  expect(warn).toHaveBeenCalled();
  clock.mockReturnValue(1_800_000_120_000);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'up',
    details: { routeCount: 0 },
  });
  service.recordHttpRequest('GET /fast', 200, 5);
  service.recordHttpRequest('GET /fast', 201, 10);
  expect(service.getApiPerformanceSnapshot()).toMatchObject({
    status: 'up',
    details: { averageDurationMs: 7.5 },
  });
});
