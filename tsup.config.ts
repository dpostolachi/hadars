import { defineConfig } from 'tsup';

// Native parser bindings must resolve from the installed dependency at runtime.
export default defineConfig({
    esbuildOptions(options) {
        options.external = [...(options.external ?? []), '@swc/core'];
    },
});
