import React from 'react';
import { Head } from '../utils/Head';
import type { PinnedBuild } from './pinnedTypes';

/** Declares module assets in the SSR head; loadClientModule evaluates scripts after shared packages are ready. Pass only build.client through client props. */
export function ModuleHead({ client }: { client: PinnedBuild['client'] }) {
    // Client loading is awaited by getClientProps; inserting scripts here would run them twice.
    if (typeof window !== 'undefined') return null;
    const url = (file: string) => client.baseUrl.replace(/\/?$/, '/') + file.split('/').map(encodeURIComponent).join('/');
    const attrs = (file: string) => client.integrity?.[file]
        ? { integrity: client.integrity[file], crossOrigin: 'anonymous' as const } : {};
    return React.createElement(Head, null,
        ...client.manifest.css.map((file) => React.createElement('link', { key: file, rel: 'stylesheet', href: url(file), ...attrs(file) })),
        ...client.manifest.js.map((file) => React.createElement('script', { key: file, src: url(file), type: 'application/hadars-module', ...attrs(file) })),
    );
}
