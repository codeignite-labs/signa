import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';
import {
  createFileCoverage,
  type FileCoverageData,
} from 'istanbul-lib-coverage';
import { bridgePageCoverage } from '../../test/support/renderer-coverage.fixture';

type CoverageHost = typeof globalThis & {
  __coverage__?: Record<string, FileCoverageData>;
};
type Instrumenter = { instrumentSync(source: string, path: string): string };
const { createInstrumenter } = createRequire(__filename)(
  'istanbul-lib-instrument',
) as { createInstrumenter(this: void): Instrumenter };
function fixture(path: string, accepted: string) {
  const sandbox = {} as {
    __coverage__: Record<string, FileCoverageData>;
    choose: (enabled: boolean) => string;
  };
  const source = `globalThis.choose = enabled => { if (enabled) return '${accepted}'; return 'untaken'; };`;
  runInNewContext(createInstrumenter().instrumentSync(source, path), sandbox);
  const coverage = sandbox.__coverage__[path];
  createFileCoverage(coverage).resetHits();
  return { coverage, choose: sandbox.choose };
}
it('merges actual cross-file browser hits exactly once and retains untaken branches and live Node object identity', async () => {
  const firstPath = '/tmp/signa-browser-coverage-fixture/first.js';
  const secondPath = '/tmp/signa-browser-coverage-fixture/second.js';
  const first = fixture(firstPath, 'first');
  const second = fixture(secondPath, 'second');
  const host = globalThis as CoverageHost;
  const originalCoverage = host.__coverage__;
  const map = host.__coverage__ ?? {};
  host.__coverage__ = map;
  map[firstPath] = first.coverage;
  map[secondPath] = second.coverage;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    bridgePageCoverage(page);
    const callback = runInNewContext(
      `enabled => [(${first.choose.toString()})(enabled), (${second.choose.toString()})(enabled)]`,
    ) as (enabled: boolean) => string[];
    for (let index = 1; index <= 2; index++) {
      await expect(page.evaluate(callback, true)).resolves.toEqual([
        'first',
        'second',
      ]);
      for (const target of [first.coverage, second.coverage]) {
        expect(target.f['0']).toBe(index);
        expect(target.b['0']).toEqual([index, 0]);
        expect(target.s['0']).toBe(0);
      }
    }
    expect(map[firstPath]).toBe(first.coverage);
    expect(map[secondPath]).toBe(second.coverage);
    expect(first.choose(false)).toBe('untaken');
    expect(first.coverage.f['0']).toBe(3);
    expect(first.coverage.b['0']).toEqual([2, 1]);
    expect(second.coverage.b['0']).toEqual([2, 0]);
    await expect(page.evaluate(() => 'uninstrumented')).resolves.toBe(
      'uninstrumented',
    );
  } finally {
    await browser.close();
    delete map[firstPath];
    delete map[secondPath];
    host.__coverage__ = originalCoverage;
  }
});
