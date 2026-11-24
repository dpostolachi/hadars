import en from './static/locales/en/storefront.json';
import ro from './static/locales/ro/storefront.json';

// Keep language switching same-origin on deployments with a separate asset CDN.
export function demoLocaleResponse(pathname: string): Response | undefined {
    const messages = pathname === '/api/demo-locales/en/storefront.json' ? en
        : pathname === '/api/demo-locales/ro/storefront.json' ? ro : null;
    if (messages) return Response.json(messages, {
        headers: { 'Cache-Control': 'public, max-age=60' },
    });
}
