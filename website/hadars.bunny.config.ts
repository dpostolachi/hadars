import type { HadarsOptions } from 'hadars';

// Trial config for `hadars export bunny` (bunny.net Edge Scripting).
// Same app as hadars.config.ts, minus `port` (meaningless for an edge script —
// there's no local server to bind). Static assets are served from a separate
// Bunny Storage Pull Zone (static.hadars.xyz) rather than same-origin, so
// baseURL points there.
const config: HadarsOptions = {
    entry: 'src/App.tsx',
    htmlTemplate: 'src/template.html',
    baseURL: 'https://static.hadars.xyz',
    fetch: (req) => {
        if (req.pathname === '/api/data') {
            // fetch weather data from open-meteo and return it as JSON
            return fetch('https://api.open-meteo.com/v1/forecast?latitude=53.5569&longitude=9.9946&current_weather=true')
                .then(res => res.json())
                .then(data => new Response(JSON.stringify(data), {
                    headers: { 'Content-Type': 'application/json' },
                }));
        }
    },
    // Only cache /cache-test — the main page is always freshly rendered.
    cache: (req) => req.pathname === '/cache-test' ? { key: req.pathname, ttl: 30_000 } : null,
    // Warns (never fails the build) if static/locales/{ro,ru,...}/*.json
    // don't have exactly the same keys as static/locales/en/*.json.
    i18n: { defaultLocale: 'en' },
};

export default config;
