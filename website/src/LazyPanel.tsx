import React from 'react';

/**
 * Deliberately kept in its own file so the hadars rspack loader transforms
 *   loadModule('./LazyPanel')
 * into a dynamic import() on the client (separate chunk) and a static
 * Promise.resolve(require('./LazyPanel')) on the server (inlined).
 */
const LazyPanel: React.FC = () => (
    <div className="demo-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
        <span className="demo-label">loadModule — lazy chunk</span>
        <span className="demo-value" style={{ color: 'var(--green, #22c55e)' }}>
            ✓ This component was code-split into its own JS chunk on the client and bundled
            statically on the server.
        </span>
    </div>
);

export default LazyPanel;
