import React from 'react';
import { HadarsHead, LocaleProvider, useLocale, useTranslations } from 'hadars';

const LOCALES = ['en', 'ro'];

// Server-only — resolved during SSR via useServerData inside useTranslations,
// then stripped from the client bundle. Subsequent locale switches are
// handled by LocaleProvider's own fetch() against the same static files.
const loadMessages = (locale: string, namespace: string) =>
    import(`../../static/locales/${locale}/${namespace}.json`).then(m => m.default);

const Greeting: React.FC = () => {
    const { t, isSwitching } = useTranslations('common', loadMessages);
    return (
        <div className={isSwitching ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            <p className="text-xl font-semibold mb-1">{t('greeting', { name: 'Hadar' })}</p>
            <p className="text-muted-foreground">{t('tagline')}</p>
        </div>
    );
};

const LanguageSwitcher: React.FC = () => {
    const { locale, setLocale, isSwitching } = useLocale();
    const { t } = useTranslations('common', loadMessages);
    return (
        <label className="flex items-center gap-3 mt-6">
            <span className="text-sm text-muted-foreground">{t('switchLabel')}</span>
            <select
                value={locale}
                disabled={isSwitching}
                onChange={e => setLocale(e.target.value)}
                className="rounded-lg border px-3 py-1.5 text-sm bg-background"
            >
                {LOCALES.map(l => (
                    <option key={l} value={l}>{l.toUpperCase()}</option>
                ))}
            </select>
        </label>
    );
};

const I18nDemo: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>i18n Demo — hadars</title>
            <meta name="description" content="A live example of hadars' i18n module — locale switching with no page reload, backed by static JSON files." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">i18n Demo</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            Switching languages below re-fetches every namespace on the page in parallel and
            applies them in a single update — there's never a moment where one piece of text
            has switched and another hasn't. Try switching, then switch back: the second time
            is instant, served from the in-memory cache.
        </p>

        <div className="rounded-xl border p-6 max-w-lg" style={{ background: 'oklch(0.08 0.025 280)' }}>
            <LocaleProvider initialLocale="en" locales={LOCALES} defaultLocale="en">
                <Greeting />
                <LanguageSwitcher />
            </LocaleProvider>
        </div>

        <p className="text-sm text-muted-foreground mt-6 max-w-2xl">
            See the <a className="underline" href="/docs/i18n">i18n guide</a> for how to wire
            locale into the URL (so each language is its own crawlable, static-exportable page)
            rather than switching in place like this isolated demo does.
        </p>
    </>
);

export default I18nDemo;
