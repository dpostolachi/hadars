import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const I18n: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>i18n — hadars</title>
            <meta name="description" content="Internationalisation for hadars apps — locale-in-path routing, static translation files, and in-place language switching with no full reload." />
            <meta property="og:title" content="i18n — hadars" />
            <meta property="og:description" content="Internationalisation for hadars apps — locale-in-path routing, static translation files, and in-place language switching with no full reload." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">i18n</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            hadars has no built-in router, so its i18n module doesn't assume one either.
            Locale lives in the URL path, translation files are plain static assets, and
            switching languages happens in place — no full page reload, no server round-trip.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">How locale is determined</h2>
            <p className="text-muted-foreground mb-4">
                The default locale is served unprefixed at the root; every other locale gets a
                path prefix. <code className="text-sm bg-muted px-1.5 py-0.5 rounded">/about</code> is
                English, <code className="text-sm bg-muted px-1.5 py-0.5 rounded">/ro/about</code> is
                Romanian. This scheme needs no redirect logic on the bare root path — important
                for static hosting, where there's no request-time signal (no cookie, no
                Accept-Language header) available to redirect with.
            </p>
            <Code>{`
import { parseLocaleFromPath, type HadarsI18nConfig } from 'hadars';

const i18nConfig: HadarsI18nConfig = {
    locales: ['en', 'ro', 'ru'],
    defaultLocale: 'en',
};

// '/about'      -> { locale: 'en', page: '/about' }
// '/ro/about'   -> { locale: 'ro', page: '/about' }
// '/ru'         -> { locale: 'ru', page: '/' }
parseLocaleFromPath('/ro/about', i18nConfig);
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Translation files are static assets</h2>
            <p className="text-muted-foreground mb-4">
                Split messages by namespace (one JSON file per page/feature per locale) rather
                than one giant file per language, so no page pays for strings it doesn't use:
            </p>
            <Code lang="bash">{`
static/
  locales/
    en/
      common.json
      home.json
    ro/
      common.json
      home.json
            `}</Code>
            <p className="text-muted-foreground mt-4">
                Anything placed under a project's <code className="text-sm bg-muted px-1.5 py-0.5 rounded">static/</code> directory
                is copied into <code className="text-sm bg-muted px-1.5 py-0.5 rounded">.hadars/static/</code> during{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars build</code>, so these files are served
                identically whether you're running <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars run</code> or
                deploying the output of <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars export static</code> — no
                server logic involved in resolving them.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Setup</h2>
            <p className="text-muted-foreground mb-4">
                Resolve the initial locale from the request path in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">getInitProps</code>,
                and wrap your app in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">LocaleProvider</code>.
                This works the same in live-server and static-export mode — <code className="text-sm bg-muted px-1.5 py-0.5 rounded">req.pathname</code> is
                available in both.
            </p>
            <Code>{`
import { type HadarsApp, type HadarsRequest, LocaleProvider, parseLocaleFromPath } from 'hadars';

const i18nConfig = { locales: ['en', 'ro', 'ru'], defaultLocale: 'en' };

interface Props { initialLocale: string }

const App: HadarsApp<Props> = ({ initialLocale, ...rest }) => (
    <LocaleProvider initialLocale={initialLocale} {...i18nConfig}>
        {/* your routed pages */}
    </LocaleProvider>
);

export const getInitProps = async (req: HadarsRequest): Promise<Props> => {
    const { locale } = parseLocaleFromPath(req.pathname, i18nConfig);
    return { initialLocale: locale };
};

export default App;
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Reading translations</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useTranslations</code> resolves
                a namespace's messages once during SSR (via <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useServerData</code>,
                so the initial page has zero client-side waterfall) and re-resolves it from the same
                static files on every future locale switch.
            </p>
            <Code>{`
import { useTranslations } from 'hadars';

const loadMessages = (locale: string, namespace: string) =>
    import(\`../../static/locales/\${locale}/\${namespace}.json\`).then(m => m.default);

const Home = () => {
    const { t } = useTranslations('home', loadMessages);
    return <h1>{t('hero.title', { name: 'Hadar' })}</h1>;
};
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Switching language without a reload</h2>
            <p className="text-muted-foreground mb-4">
                Call <code className="text-sm bg-muted px-1.5 py-0.5 rounded">setLocale</code> from <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useLocale()</code>.
                Every namespace currently mounted anywhere in the tree is fetched for the new locale
                in parallel, and the switch only applies once <em>all</em> of them have resolved —
                so no component can render with the new locale while another is still showing the old
                one. A locale visited before (via SSR or a prior switch) never touches the network again.
            </p>
            <Code>{`
import { useLocale } from 'hadars';

const LanguageSwitcher = () => {
    const { locale, setLocale, isSwitching } = useLocale();
    return (
        <select value={locale} disabled={isSwitching} onChange={e => setLocale(e.target.value)}>
            <option value="en">EN</option>
            <option value="ro">RO</option>
            <option value="ru">RU</option>
        </select>
    );
};
            `}</Code>
            <p className="text-muted-foreground mt-4">
                The switch also silently syncs the address bar via <code className="text-sm bg-muted px-1.5 py-0.5 rounded">history.replaceState</code> (no
                navigation event fires, so nothing remounts) — so the URL stays correct for reload,
                sharing, and static hosting, where the URL is the only thing that determines which
                pre-built page a visitor lands on.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Static export</h2>
            <p className="text-muted-foreground mb-4">
                Enumerate every locale × page combination in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">paths()</code> so
                each locale gets its own pre-rendered, crawlable HTML file:
            </p>
            <Code>{`
const pages = ['/', '/about', '/blog'];

export default {
    entry: './src/App.tsx',
    paths: () => [
        ...pages,
        ...i18nConfig.locales
            .filter(l => l !== i18nConfig.defaultLocale)
            .flatMap(l => pages.map(p => \`/\${l}\${p === '/' ? '' : p}\`)),
    ],
};
            `}</Code>
            <p className="text-muted-foreground">
                Internal links should go through <code className="text-sm bg-muted px-1.5 py-0.5 rounded">useLocalizedPath</code> so
                navigation between pages stays within the current locale's pre-built set:
            </p>
            <Code>{`
import { useLocalizedPath } from 'hadars';

const Nav = () => {
    const aboutHref = useLocalizedPath('/about'); // '/about' or '/ro/about'
    return <a href={aboutHref}>About</a>;
};
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">API reference</h2>
            <div className="rounded-xl overflow-hidden divide-y mb-4" style={{ background: "oklch(0.08 0.025 280)", border: "1px solid oklch(0.68 0.28 285 / 0.15)" }}>
                <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: "oklch(0.12 0.04 280)", color: "oklch(0.60 0.08 285)" }}>
                    <span>Export</span><span>Type</span><span>Purpose</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">LocaleProvider</code>
                    <span className="text-muted-foreground">component</span>
                    <span className="text-muted-foreground">Owns locale state, the message cache, and atomic locale switching.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">useLocale</code>
                    <span className="text-muted-foreground">hook</span>
                    <span className="text-muted-foreground">Returns <code className="text-xs bg-muted px-1 rounded">{'{ locale, setLocale, isSwitching }'}</code>.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">useTranslations</code>
                    <span className="text-muted-foreground">hook</span>
                    <span className="text-muted-foreground">Registers a namespace, returns <code className="text-xs bg-muted px-1 rounded">{'{ t, isSwitching }'}</code>.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">useLocalizedPath</code>
                    <span className="text-muted-foreground">hook</span>
                    <span className="text-muted-foreground">Prefixes a path with the current locale (default locale stays unprefixed).</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">parseLocaleFromPath</code>
                    <span className="text-muted-foreground">function</span>
                    <span className="text-muted-foreground">Splits a pathname into <code className="text-xs bg-muted px-1 rounded">{'{ locale, page }'}</code>.</span>
                </div>
                <div className="grid grid-cols-3 gap-4 px-4 py-3 text-sm">
                    <code className="text-primary">localizePath</code>
                    <span className="text-muted-foreground">function</span>
                    <span className="text-muted-foreground">The inverse of <code className="text-xs bg-muted px-1 rounded">parseLocaleFromPath</code>.</span>
                </div>
            </div>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Keeping locales in sync</h2>
            <p className="text-muted-foreground mb-4">
                A missing translation key doesn't throw \u2014 <code className="text-sm bg-muted px-1.5 py-0.5 rounded">t()</code> falls
                back to the raw key, which is exactly why it's easy to ship silently. Set <code className="text-sm bg-muted px-1.5 py-0.5 rounded">i18n.defaultLocale</code> in{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.config.ts</code> and every{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars build</code> prints a warning for any
                locale whose keys don't match the base, per namespace \u2014 non-fatal, since a partially-translated
                locale shouldn't block a build:
            </p>
            <Code>{`
// hadars.config.ts
export default {
    entry: './src/App.tsx',
    i18n: { defaultLocale: 'en' }, // warns if static/locales/{ro,ru,...} miss keys from en
} satisfies HadarsOptions;
            `}</Code>
            <p className="text-muted-foreground mb-4">
                For a hard CI gate instead of a warning, call the same checking logic directly \u2014{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">checkLocaleParity</code> is exported and
                exits your script non-zero on any mismatch:
            </p>
            <Code>{`
import { checkLocaleParity, formatParityIssues, type LocaleMessageTree } from 'hadars';

const tree: LocaleMessageTree = /* build from static/locales/**\\/*.json */;
const issues = checkLocaleParity(tree, 'en');
if (issues.length) {
    console.error(formatParityIssues(issues));
    process.exit(1);
}
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Live demo</h2>
            <p className="text-muted-foreground">
                See it running on the <a className="underline" href="/i18n-demo">i18n demo page</a> —
                switch languages and watch the network tab: a locale visited once is never fetched again.
            </p>
        </section>

        <footer className="mt-16 pt-8 text-center text-sm text-muted-foreground" style={{ borderTop: "1px solid oklch(0.68 0.28 285 / 0.15)" }}><p>hadars — MIT licence</p></footer>
    </>
);

export default I18n;
