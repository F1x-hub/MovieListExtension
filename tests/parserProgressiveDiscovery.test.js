const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BaseParserService } = require('../src/shared/services/parsers/BaseParserService');
const registrySource = fs.readFileSync(
    path.join(__dirname, '../src/shared/services/parsers/ParserRegistry.js'),
    'utf8'
);
const registryContext = { BaseParserService, window: {} };
registryContext.globalThis = registryContext;
vm.createContext(registryContext);
new vm.Script(registrySource).runInContext(registryContext);
const { ParserRegistry } = registryContext.window;

class DelayedParser extends BaseParserService {
    constructor(id, delay) {
        super({ id, name: id, baseUrl: 'https://provider.test', cacheTTL: 1 });
        this.delay = delay;
        this.receivedOptions = null;
    }

    async search(_title, _year, options) {
        this.receivedOptions = options;
        await new Promise(resolve => setTimeout(resolve, this.delay));
        return { url: `https://provider.test/${this.id}`, title: this.id };
    }
}

(async () => {
    const fast = new DelayedParser('fast', 5);
    const slow = new DelayedParser('slow', 30);
    const registry = new ParserRegistry(['fast', 'slow']);
    registry.register(fast);
    registry.register(slow);

    const callbackOrder = [];
    const settledOrder = [];
    const results = await registry.searchAll('Series', 2024, {
        mediaType: 'tv-series',
        onResult(result, parser) {
            callbackOrder.push(`${parser.id}:${result.parserId}`);
            return new Promise(resolve => setTimeout(resolve, 100));
        },
        onSettled(result, parser) {
            settledOrder.push(`${parser.id}:${Boolean(result)}`);
        }
    });

    assert.deepEqual(callbackOrder, ['fast:fast', 'slow:slow'], 'each parser result must stream in completion order');
    assert.equal(results.length, 2, 'searchAll still returns all successful results');
    assert.deepEqual(settledOrder, ['fast:true', 'slow:true'], 'settled callbacks must follow parser completion');
    assert.equal(Object.hasOwn(fast.receivedOptions, 'onResult'), false, 'callback must not leak into parser options');
    assert.equal(Object.hasOwn(fast.receivedOptions, 'onSettled'), false, 'settled callback must not leak into parser options');
    assert.equal(fast.receivedOptions.mediaType, 'tv-series');
    console.log('✅ parser progressive discovery tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
