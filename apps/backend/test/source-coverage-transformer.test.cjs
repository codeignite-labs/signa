const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const {
  instrumentOriginalSource,
} = require('./source-coverage-transformer.cjs');
const filename = '/fixture/consumer.ts';
const source = `
import { Dependency } from './dependency';
function registered(target: Function) { return target; }
@registered
export class Consumer {
  constructor(private readonly dependency: Dependency) {}
  choose(enabled: boolean): string {
    if (enabled) return 'accepted';
    return 'rejected';
  }
}
`;
function executeFixture() {
  const instrumented = instrumentOriginalSource(source, filename);
  const compiled = ts.transpileModule(instrumented.code, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      isolatedModules: true,
    },
  });
  const Dependency = class Dependency {};
  const metadata = [];
  const context = {
    exports: {},
    require: (name) => {
      assert.equal(name, './dependency');
      return { Dependency };
    },
    Reflect: {
      metadata: (key, value) => () => {
        metadata.push({ key, value });
      },
    },
  };
  vm.runInNewContext(compiled.outputText, context, { filename });
  const consumer = new context.exports.Consumer(new Dependency());
  return { context, consumer, metadata, Dependency, compiled, instrumented };
}
test('retains Nest decorator metadata while excluding only compiler-added branches', () => {
  const { context, consumer, metadata, Dependency, compiled } =
    executeFixture();
  assert.match(compiled.outputText, /design:paramtypes/);
  assert.match(compiled.outputText, /typeof/);
  assert.equal(
    metadata.find((entry) => entry.key === 'design:paramtypes').value[0],
    Dependency,
  );
  assert.equal(consumer.choose(true), 'accepted');
  assert.equal(consumer.choose(false), 'rejected');
  const coverage = context.__coverage__[filename];
  assert.equal(Object.keys(coverage.branchMap).length, 1);
  assert.equal(Object.values(coverage.branchMap)[0].type, 'if');
  assert.deepEqual(Array.from(Object.values(coverage.b)[0]), [1, 1]);
});
test('leaves an untested authored branch visible instead of reporting false completeness', () => {
  const { context, consumer } = executeFixture();
  consumer.choose(true);
  assert.deepEqual(
    Array.from(Object.values(context.__coverage__[filename].b)[0]),
    [1, 0],
  );
});
test('keeps unexecuted source at zero and maps counters to original TypeScript', () => {
  const result = instrumentOriginalSource(source, filename);
  assert.ok(Object.values(result.coverage.s).every((count) => count === 0));
  assert.ok(Object.values(result.coverage.f).every((count) => count === 0));
  assert.ok(
    Object.values(result.coverage.b)
      .flat()
      .every((count) => count === 0),
  );
  assert.equal(Object.values(result.coverage.branchMap)[0].loc.start.line, 8);
  assert.equal(result.map.sourcesContent[0], source);
});
test('returns compiler output mapped to the original source through the Jest transformer', () => {
  const { createTransformer } = require('./source-coverage-transformer.cjs');
  const path = require('node:path');
  const rootDir = path.resolve(__dirname, '..');
  const fixturePath = path.join(rootDir, 'test', 'consumer.fixture.ts');
  const transformer = createTransformer({
    tsconfig: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2023',
      isolatedModules: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      sourceMap: true,
    },
  });
  const options = {
    config: {
      cwd: rootDir,
      rootDir,
      globals: {},
      transform: [],
      cacheDirectory: '/tmp/signa-transformer-regression',
    },
    configString: '{}',
    cacheFS: new Map(),
    instrument: true,
    supportsDynamicImport: false,
    supportsExportNamespaceFrom: false,
    supportsStaticESM: false,
    supportsTopLevelAwait: false,
  };
  const result = transformer.process(source, fixturePath, options);
  assert.match(result.code, /__coverage__/);
  assert.match(result.code, /design:paramtypes/);
  assert.doesNotMatch(result.code, /sourceMappingURL=/);
  const map = JSON.parse(result.map);
  assert.ok(map.sourcesContent.includes(source));
  assert.ok(!map.sourcesContent.some((content) => content?.includes('cov_')));
  assert.ok(map.mappings.length > 0);
  const plain = transformer.process(source, fixturePath, {
    ...options,
    instrument: false,
  });
  assert.doesNotMatch(plain.code, /__coverage__/);
});
