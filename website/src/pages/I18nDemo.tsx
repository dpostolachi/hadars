import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HadarsHead, LocaleProvider, useLocale, useTranslations } from "hadars";
import Code from "../components/Code";
import RemixIcon from "../components/RemixIcon";
import "../styles/demos.css";

const LOCALES = ["en", "ro"];
const loadMessages = (locale: string, namespace: string) =>
  import(`../../static/locales/${locale}/${namespace}.json`).then(
    (m) => m.default,
  );
function translationBase() {
  if (typeof document === "undefined") return "/locales";
  try {
    const encoded = document
      .querySelector('meta[name="HADARS_ASSET_BASE"]')
      ?.getAttribute("content");
    const base = encoded ? JSON.parse(decodeURIComponent(encoded)).base : "";
    return `${typeof base === "string" ? base.replace(/\/$/, "") : ""}/locales`;
  } catch {
    return "/locales";
  }
}
function ProductPreview() {
  const navigate = useNavigate();
  const { locale, setLocale, isSwitching } = useLocale();
  const { t } = useTranslations("storefront", loadMessages);
  const [quantity, setQuantity] = React.useState(1),
    [error, setError] = React.useState(""),
    [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setReady(true);
  }, []);
  const intlLocale = locale === "ro" ? "ro-RO" : "en-GB";
  const money = new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: "EUR",
  });
  const plural = new Intl.PluralRules(intlLocale).select(quantity);
  const itemsKey =
    plural === "one"
      ? "itemsOne"
      : plural === "few"
        ? "itemsFew"
        : "itemsOther";
  const switchLanguage = async (next: string) => {
    setError("");
    try {
      await setLocale(next);
      navigate(window.location.pathname + window.location.search, {
        replace: true,
      });
    } catch {
      setError("The language file could not be loaded. Please try again.");
    }
  };
  return (
    <>
      <div className="demo-locale-toolbar">
        <span>Preview language</span>
        <div
          className="demo-language-options"
          role="group"
          aria-label="Preview language"
        >
          {[
            ["en", "English"],
            ["ro", "Română"],
          ].map(([code, label]) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={locale === code}
              onClick={() => switchLanguage(code)}
              disabled={!ready || isSwitching}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="demo-locale-state" role="status">
          {isSwitching ? "Loading translations…" : "Ready"}
        </span>
      </div>
      {error && (
        <p className="demo-error" role="alert">
          {error}
        </p>
      )}
      <div className="demo-storefront" lang={locale} aria-busy={isSwitching}>
        <div className="demo-product-visual">
          <span className="demo-product-label">{t("sampleLabel")}</span>
          <svg viewBox="0 0 300 260" className="demo-lamp" aria-hidden="true">
            <ellipse cx="157" cy="231" rx="86" ry="12" fill="#efac6812" />
            <path
              d="M151 218 180 120 125 63"
              stroke="#bda38a"
              strokeWidth="9"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="180" cy="120" r="10" fill="#e4b787" />
            <path d="m91 42 31-13 44 65-53 21Z" fill="#d5a06c" />
            <path d="m111 116 57-23-11 47-75 33Z" fill="#efac6812" />
            <ellipse cx="149" cy="222" rx="45" ry="10" fill="#ceb18e" />
            <path
              d="m113 113 53-20"
              stroke="#ffe0b0"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
          <span className="demo-product-caption">{t("sampleCaption")}</span>
        </div>
        <div className="demo-product-content">
          <div className="demo-eyebrow">{t("category")}</div>
          <h2>{t("productName")}</h2>
          <p>{t("productDescription")}</p>
          <div className="demo-product-price">
            {money.format(89)}
            <small>{t("unitPrice")}</small>
          </div>
          <div className="demo-product-quantity">
            <label htmlFor="demo-quantity">{t("quantity")}</label>
            <div className="demo-quantity-control">
              <button
                type="button"
                aria-label={t("decrease")}
                disabled={!ready || quantity <= 1 || isSwitching}
                onClick={() => setQuantity((n) => n - 1)}
              >
                <RemixIcon name="subtract-line" />
              </button>
              <output id="demo-quantity" aria-live="polite">
                {quantity}
              </output>
              <button
                type="button"
                aria-label={t("increase")}
                disabled={!ready || quantity >= 9 || isSwitching}
                onClick={() => setQuantity((n) => n + 1)}
              >
                <RemixIcon name="add-line" />
              </button>
            </div>
          </div>
          <div className="demo-order-total">
            <div>
              <span>{t("total")}</span>
              <small>{t(itemsKey, { count: quantity })}</small>
            </div>
            <strong>{money.format(89 * quantity)}</strong>
          </div>
          <div className="demo-product-note">
            <RemixIcon name="information-line" />
            {t("demoNotice")}
          </div>
        </div>
      </div>
      <div className="demo-format-grid">
        <div>
          <span>Locale</span>
          <strong>{intlLocale}</strong>
        </div>
        <div>
          <span>Currency formatting</span>
          <strong>{money.format(89 * quantity)}</strong>
        </div>
        <div>
          <span>Example date</span>
          <strong>
            {new Intl.DateTimeFormat(intlLocale, {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(new Date("2026-09-18T12:00:00Z"))}
          </strong>
        </div>
      </div>
      <noscript>
        <p className="demo-footnote">
          <a href={locale === "en" ? "/ro/i18n-demo" : "/i18n-demo"}>
            Open the {locale === "en" ? "Romanian" : "English"} server-rendered
            version
          </a>{" "}
          to try the translation without JavaScript.
        </p>
      </noscript>
    </>
  );
}
export default function I18nDemo() {
  const { pathname } = useLocation();
  const initialLocale = pathname.startsWith("/ro/") ? "ro" : "en";
  return (
    <>
      <HadarsHead status={200}>
        <title>Languages &amp; formatting — hadars</title>
        <meta
          name="description"
          content="Switch a sample storefront between English and Romanian, preserving quantity while text and locale formatting change together."
        />
      </HadarsHead>
      <h1>Languages &amp; formatting</h1>
      <p>
        Try the same storefront in English and Romanian. Switch languages,
        change the quantity, and watch the text, plural forms, currency, and
        date formats update together.
      </p>
      <section className="demo-workbench">
        <LocaleProvider
          initialLocale={initialLocale}
          locales={LOCALES}
          defaultLocale="en"
          basePath={translationBase()}
        >
          <ProductPreview />
        </LocaleProvider>
        <div className="demo-footnote">
          An illustrative product, not a checkout. Translations come from static
          JSON files; number, plural, and date formatting use the browser’s Intl
          APIs.
        </div>
      </section>
      <section className="demo-explanation">
        <h2>What this demonstrates</h2>
        <div className="demo-explanation-grid">
          <div>
            <h3>One coherent language switch</h3>
            <p>
              Hadars resolves the page’s namespaces before changing the active
              language, and caches languages you have already loaded.
            </p>
          </div>
          <div>
            <h3>State stays in place</h3>
            <p>
              The quantity belongs to the React component. Language changes
              update its presentation while the selected quantity remains the
              same.
            </p>
          </div>
        </div>
        <Code lang="tsx">{`const { locale, setLocale } = useLocale();
const { t } = useTranslations('storefront', loadMessages);

const price = new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR',
}).format(total);`}</Code>
        <div className="demo-source-links">
          <a href="/docs/i18n">Read the internationalization guide</a>
          <a href="https://github.com/dpostolachi/hadars/blob/main/website/src/pages/I18nDemo.tsx">
            View demo source
          </a>
        </div>
      </section>
    </>
  );
}
