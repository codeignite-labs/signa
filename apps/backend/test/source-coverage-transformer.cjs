const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createInstrumenter } = require('istanbul-lib-instrument');
const remapping = require('@jridgewell/remapping');
const tsJest = require('ts-jest').default;
const transformerHash = createHash('sha256')
  .update(readFileSync(__filename))
  .digest('hex');

// Instrument authored statements/branches before TypeScript adds decorator
// metadata and parameter-property assignments. No application paths are removed.
function instrumentOriginalSource(source, filename) {
  const instrumenter = createInstrumenter({
    parserPlugins: ['typescript', 'decorators-legacy'],
    produceSourceMap: true,
    compact: false,
  });
  return {
    code: instrumenter.instrumentSync(source, filename),
    map: instrumenter.lastSourceMap(),
    coverage: instrumenter.lastFileCoverage(),
  };
}

function createTransformer(options) {
  const compiler = tsJest.createTransformer(options);
  return {
    canInstrument: true,
    getCacheKey(...args) {
      return `${compiler.getCacheKey(...args)}:${transformerHash}`;
    },
    process(source, filename, transformOptions) {
      if (!transformOptions.instrument) {
        return compiler.process(source, filename, transformOptions);
      }
      const original = instrumentOriginalSource(source, filename);
      const compiled = compiler.process(original.code, filename, {
        ...transformOptions,
        instrument: false,
      });
      const compiledMap =
        typeof compiled.map === 'string'
          ? JSON.parse(compiled.map)
          : compiled.map;
      const map = compiledMap
        ? remapping([compiledMap, original.map], () => null)
        : original.map;
      return {
        // Replace the compiler's map of the intermediate instrumented source
        // with the composed map back to the actual checked-in TypeScript.
        code: compiled.code.replace(/\n?\/\/# sourceMappingURL=.*$/gm, ''),
        map: JSON.stringify(map),
      };
    },
  };
}

module.exports = { createTransformer, instrumentOriginalSource };
