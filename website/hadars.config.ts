import type { HadarsOptions } from 'hadars';

const config: HadarsOptions = {
    entry: 'src/App.tsx',
    port: 9090,
    fetch: (req) => {
        if (req.pathname === '/api/data') {
            // fetch weather data from open-meteo and return it as JSON
            return fetch('https://api.open-meteo.com/v1/forecast?latitude=53.5569&longitude=9.9946&current_weather=true')
                .then(res => res.json())
                .then(data => new Response(JSON.stringify(data), {
                    headers: { 'Content-Type': 'application/json' },
                }));
        }
    }
};

export default config;
