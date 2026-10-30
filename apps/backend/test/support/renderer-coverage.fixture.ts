import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright';
import {
  createFileCoverage,
  type FileCoverageData,
} from 'istanbul-lib-coverage';

type Evaluate = (
  callback: string | ((argument: unknown) => unknown),
  argument?: unknown,
) => Promise<unknown>;
type CoverageGlobal = typeof globalThis & {
  __coverage__?: Record<string, FileCoverageData>;
  __signaBrowserCounters?: Record<string, FileCoverageData>;
};
type Instrumenter = {
  instrumentSync(source: string, filename: string): string;
};
const { createInstrumenter } = createRequire(__filename)(
  'istanbul-lib-instrument',
) as {
  createInstrumenter(this: void): Instrumenter;
};
const aliases = new Map<string, string>();

/** Execute instrumented application callbacks in Chromium and merge real hits. */
export function installRendererCoverageBridge() {
  const launch = chromium.launch.bind(chromium);
  jest.spyOn(chromium, 'launch').mockImplementation(async (options) => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await newContext(contextOptions);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        bridgePageCoverage(page);
        return page;
      };
      return context;
    };
    return browser;
  });
}

export function bridgePageCoverage(page: Page) {
  const evaluate = page.evaluate.bind(page) as Evaluate;
  page.evaluate = (async (
    callback: Parameters<Evaluate>[0],
    argument?: unknown,
  ) => {
    const targets = callbackCoverage(callback);
    if (!Object.keys(targets).length) return evaluate(callback, argument);
    await initializeBrowserCounters(evaluate, targets);
    try {
      return await evaluate(callback, argument);
    } finally {
      const hits = (await evaluate(
        () => (globalThis as CoverageGlobal).__signaBrowserCounters,
      )) as Record<string, FileCoverageData>;
      for (const [name, target] of Object.entries(targets)) {
        // FileCoverage wraps the original data object, so the live Node closure
        // continues updating the same object after Istanbul merges browser hits.
        createFileCoverage(target).merge(hits[name]);
      }
    }
  }) as Page['evaluate'];
}

function callbackCoverage(callback: Parameters<Evaluate>[0]) {
  const names = new Set(
    callback.toString().match(/\bcov_[a-zA-Z\d_$]+(?=\s*\()/g) ?? [],
  );
  const targets: Record<string, FileCoverageData> = {};
  if (!names.size) return targets;
  for (const [path, coverage] of Object.entries(
    (globalThis as CoverageGlobal).__coverage__ ?? {},
  )) {
    const alias = coverageAlias(path);
    if (names.has(alias)) targets[alias] = coverage;
  }
  if (Object.keys(targets).length !== names.size)
    throw new Error('Unmapped browser coverage function');
  return targets;
}

function coverageAlias(path: string) {
  const cached = aliases.get(path);
  if (cached) return cached;
  const code = createInstrumenter().instrumentSync('', path);
  const alias = code.match(/function (cov_[a-zA-Z\d_$]+)\(/)?.[1];
  if (!alias) throw new Error('Istanbul coverage function not found');
  aliases.set(path, alias);
  return alias;
}

async function initializeBrowserCounters(
  evaluate: Evaluate,
  targets: Record<string, FileCoverageData>,
) {
  const counters = Object.fromEntries(
    Object.entries(targets).map(([name, target]) => {
      const coverage = createFileCoverage(structuredClone(target));
      coverage.resetHits();
      return [name, coverage.data];
    }),
  );
  await evaluate((input) => {
    const counters = input as Record<string, FileCoverageData>;
    (globalThis as CoverageGlobal).__signaBrowserCounters = counters;
    for (const name of Object.keys(counters))
      (globalThis as unknown as Record<string, unknown>)[name] = () =>
        counters[name];
  }, counters);
}
