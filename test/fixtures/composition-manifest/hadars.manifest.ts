import { defineManifest } from '../../../src/composition';

export default defineManifest({
    name: 'greeter',
    exposes: { greeting: 'src/index.tsx', page: 'src/page.tsx' },
    mounts: ['/greet/**', '/hello'],
    routes: 'page',
    uses: ['badge'],
});
