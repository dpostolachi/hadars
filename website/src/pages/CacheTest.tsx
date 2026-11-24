import React from 'react';
import { HadarsHead } from 'hadars';

const CacheTest: React.FC<{ serverTime: string }> = ({ serverTime }) => {
    const [clientTime, setClientTime] = React.useState('');

    React.useEffect(() => {
        const fmt = () => new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
        setClientTime(fmt());
        const id = setInterval(() => setClientTime(fmt()), 1000);
        return () => clearInterval(id);
    }, []);

    const isCached = clientTime !== '' && clientTime !== serverTime;

    return (
        <>
            <HadarsHead status={200}>
                <title>Cache test — hadars</title>
                <meta name="description" content="Demo: hadars SSR response cache with a 30-second TTL. Reload to see cached vs fresh server timestamps." />
                <meta name="robots" content="noindex" />
            </HadarsHead>

            <h1 className="text-3xl font-bold mb-3 text-gradient">SSR cache test</h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
                This page has a <strong className="text-foreground">30-second TTL</strong> configured in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code>. Reload within 30 s — the SSR timestamp
                stays frozen while the client clock keeps ticking.
            </p>

            <section className="mb-10">
                <div className="rounded-xl divide-y overflow-hidden" style={{ background: "var(--docs-panel)", border: "1px solid var(--docs-border)", boxShadow: "0 8px 24px #0002" }}>
                    <div className="flex items-center gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-56 shrink-0">SSR timestamp <em>(frozen when cached)</em></span>
                        <span className="text-sm font-mono">{serverTime}</span>
                    </div>
                    <div className="flex items-center gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-56 shrink-0">Client clock <em>(always live)</em></span>
                        <span className="text-sm font-mono">{clientTime || '—'}</span>
                    </div>
                    <div className="flex items-center gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground w-56 shrink-0">Cache status</span>
                        <span className={`text-sm font-mono ${clientTime === '' ? 'text-muted-foreground' : isCached ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {clientTime === '' ? '—' : isCached
                                ? 'HIT — serving cached HTML (30 s TTL)'
                                : 'MISS — freshly rendered'}
                        </span>
                    </div>
                </div>
            </section>
        </>
    );
};

export default CacheTest;
