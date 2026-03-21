import React from 'react';

/**
 * Deliberately kept in its own file so the hadars rspack loader transforms
 *   loadModule('./LazyPanel')
 * into a dynamic import() on the client (separate chunk) and a static
 * Promise.resolve(require('./LazyPanel')) on the server (inlined).
 */
const LazyPanel: React.FC = () => (
    <div className="flex flex-col gap-1 px-4 py-3">
        <span className="text-sm text-muted-foreground">loadModule — lazy chunk</span>
        <span className="text-sm text-emerald-400">
            ✓ This component was code-split into its own JS chunk on the client and bundled
            statically on the server.
        </span>
    </div>
);

export default LazyPanel;
