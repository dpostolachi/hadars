import rspack from '@rspack/core';

/** Publish build metadata and override the public path before any application modules execute. */
export class RuntimeAssetsPlugin {
    constructor(private base: string) {}
    apply(compiler: rspack.Compiler) {
        const base = this.base;
        compiler.hooks.thisCompilation.tap('RuntimeAssets', compilation => {
            rspack.HtmlRspackPlugin.getCompilationHooks(compilation).beforeEmit.tap('RuntimeAssets', data => {
                data.html = data.html.replace(/<head\b[^>]*>/i, match =>
                    match + `<meta name="HADARS_ASSET_BASE" content="${encodeURIComponent(JSON.stringify({ base, files: compilation.getAssets().map(asset => asset.name) }))}">`);
                return data;
            });
            compilation.hooks.additionalTreeRuntimeRequirements.tap('RuntimeAssets', (chunk, requirements) => {
                requirements.add(rspack.RuntimeGlobals.publicPath);
                class AssetPath extends rspack.RuntimeModule {
                    constructor() { super('deployment asset base', rspack.RuntimeModule.STAGE_ATTACH); }
                    generate() {
                        return `if (typeof globalThis.__HADARS_ASSET_BASE_URL__ === "string") ${rspack.RuntimeGlobals.publicPath} = globalThis.__HADARS_ASSET_BASE_URL__ + "/";`;
                    }
                }
                compilation.addRuntimeModule(chunk, new AssetPath());
            });
        });
    }
}
