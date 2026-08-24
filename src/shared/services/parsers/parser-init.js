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

    const registry = new ParserRegistry(['kinogo', 'exfs', 'seasonvar', 'rutube']);

    // Register KinoGo parser
    if (typeof KinogoParser !== 'undefined') {
        registry.register(new KinogoParser());
    } else {
        console.warn('[ParserInit] KinogoParser is unavailable');
    }

    // Register Ex-FS parser (ex-fs.net)
    if (typeof ExFsParser !== 'undefined') {
        registry.register(new ExFsParser());
    } else {
        console.warn('[ParserInit] ExFsParser is unavailable');
    }

    // Register Seasonvar parser (seasonvar.ru)
    if (typeof SeasonvarParser !== 'undefined') {
        registry.register(new SeasonvarParser());
    } else {
        console.warn('[ParserInit] SeasonvarParser is unavailable');
    }

    // Register Rutube parser (rutube.ru)
    if (typeof RutubeParser !== 'undefined') {
        registry.register(new RutubeParser());
    } else {
        console.warn('[ParserInit] RutubeParser is unavailable');
    }

    // Expose globally
    window.parserRegistry = registry;

    console.info('[ParserInit] Ready', { parsers: registry.getIds() });
})();
