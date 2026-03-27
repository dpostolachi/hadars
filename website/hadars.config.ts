import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    htmlTemplate: 'src/template.html',
    port: 9090,
    reactMode: 'development',
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
};

export default config;
