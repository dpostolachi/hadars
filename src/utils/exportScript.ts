/** Final script settings shared by single and split exports. */
export function exportScriptOptions(value = process.env.HADARS_EXPORT_MINIFY) {
    const minify = value !== '0';
    return {
        minify,
        sourcemap: false as const,
        legalComments: 'none' as const,
        define: {
            global: 'globalThis',
            __EDGE_RUNTIME__: 'true',
            ...(minify ? { 'process.env.NODE_ENV': '"production"' } : {}),
        },
    };
}
