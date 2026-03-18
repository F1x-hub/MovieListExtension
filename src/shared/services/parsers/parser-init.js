/**
 * Parser Initialization Script
 * Registers all available parsers with the global ParserRegistry.
 * 
 * To add a new parser:
 * 1. Create YourParser.js extending BaseParserService
 * 2. Add <script> tag before this file in HTML
 * 3. Add registry.register(new YourParser()) below
 */
(function() {
    'use strict';

    console.log('[DEBUG ParserInit] === PARSER INIT START ===');
    const registry = new ParserRegistry(['kinogo', 'exfs', 'seasonvar', 'rutube']);

    // Register KinoGo parser
    if (typeof KinogoParser !== 'undefined') {
        registry.register(new KinogoParser());
        console.log('[DEBUG ParserInit] KinogoParser registered. playerType:', new KinogoParser().getPlayerType(), 'supportedTypes:', new KinogoParser().getSupportedTypes());
    } else {
        console.warn('[DEBUG ParserInit] KinogoParser NOT available (undefined)');
    }

    // Register Ex-FS parser (ex-fs.net)
    if (typeof ExFsParser !== 'undefined') {
        registry.register(new ExFsParser());
        console.log('[DEBUG ParserInit] ExFsParser registered. playerType:', new ExFsParser().getPlayerType(), 'supportedTypes:', new ExFsParser().getSupportedTypes());
    } else {
        console.warn('[DEBUG ParserInit] ExFsParser NOT available (undefined)');
    }

    // Register Seasonvar parser (seasonvar.ru)
    if (typeof SeasonvarParser !== 'undefined') {
        registry.register(new SeasonvarParser());
        console.log('[DEBUG ParserInit] SeasonvarParser registered. playerType:', new SeasonvarParser().getPlayerType(), 'supportedTypes:', new SeasonvarParser().getSupportedTypes());
    } else {
        console.warn('[DEBUG ParserInit] SeasonvarParser NOT available (undefined)');
    }

    // Register Rutube parser (rutube.ru)
    if (typeof RutubeParser !== 'undefined') {
        registry.register(new RutubeParser());
        console.log('[DEBUG ParserInit] RutubeParser registered. playerType:', new RutubeParser().getPlayerType(), 'supportedTypes:', new RutubeParser().getSupportedTypes());
    } else {
        console.warn('[DEBUG ParserInit] RutubeParser NOT available (undefined)');
    }

    // Expose globally
    window.parserRegistry = registry;

    console.log(`[DEBUG ParserInit] === INIT COMPLETE === Registered ${registry.size} parsers:`, registry.getIds().join(', '));
    console.log('[DEBUG ParserInit] All parsers detail:', registry.getAll().map(p => ({id: p.id, name: p.name, playerType: p.getPlayerType(), supportedTypes: p.getSupportedTypes()})));
})();
