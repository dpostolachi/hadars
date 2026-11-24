import React, { useEffect, useRef } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { HadarsHead } from "hadars";
import HadarsLogo from "./HadarsLogo";
import RemixSprite from "./RemixSprite";
import RemixIcon from "./RemixIcon";
import "../styles/docs.css";

const NAV = [
  {
    label: "Introduction",
    links: [{ to: "/", label: "Overview" }],
  },
  {
    label: "Guides",
    links: [
      { to: "/docs/getting-started", label: "Getting Started" },
      { to: "/docs/routing", label: "Routing" },
      { to: "/docs/head", label: "Head Management" },
      { to: "/docs/data", label: "Data Fetching" },
      { to: "/docs/from-nextjs", label: "From Next.js" },
    ],
  },
  {
    label: "Reference",
    links: [
      { to: "/docs/api", label: "API Reference" },
      { to: "/docs/slim-react", label: "slim-react" },
      { to: "/docs/deployment", label: "Deployment" },
      { to: "/docs/cloudflare", label: "Cloudflare Workers" },
      { to: "/docs/bunny", label: "Bunny.net Edge Scripting" },
      { to: "/docs/static-export", label: "Static Export & Sources" },
      { to: "/docs/swc-plugins", label: "SWC Plugins" },
      { to: "/docs/i18n", label: "i18n" },
    ],
  },
  {
    label: "Registry",
    links: [
      { to: "/docs/registry-environments", label: "Environments & Revisions" },
      { to: "/docs/registry-signing", label: "Signing & Trusted Pulls" },
    ],
  },
  {
    label: "Demos",
    links: [
      { to: "/cache-test", label: "Cache Demo" },
      { to: "/data-demo", label: "Data Fetch Demo" },
      { to: "/i18n-demo", label: "i18n Demo" },
    ],
  },
];

const pages = NAV.flatMap((group) =>
  group.links.map((link) => ({ ...link, group: group.label })),
);

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((group) => (
        <div className="docs-nav-group" key={group.label}>
          <h2>{group.label}</h2>
          {group.links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={onNavigate}
              className={({ isActive }) =>
                "docs-nav-link" + (isActive ? " is-active" : "")
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
    window.scrollTo(0, 0);
  }, [location.pathname]);
  if (location.pathname === "/") return <>{children}</>;
  const currentIndex = pages.findIndex((page) => page.to === location.pathname);
  const current = pages[currentIndex],
    previous = pages[currentIndex - 1],
    next = pages[currentIndex + 1];
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  return (
    <div className="docs-shell">
      <HadarsHead>
        <meta property="og:site_name" content="hadars" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`https://hadars.xyz${location.pathname}`} />
      </HadarsHead>
      <RemixSprite />
      <a className="docs-skip" href="#docs-main">
        Skip to documentation
      </a>
      <header className="docs-topbar">
        <Link to="/" className="docs-brand" aria-label="Hadars home">
          <HadarsLogo size={36} />
          <span>
            hadars<span className="docs-brand-dot">.</span>
          </span>
        </Link>
        <span className="docs-product">Documentation</span>
        <nav className="docs-site-nav" aria-label="Website">
          <Link to="/" className="docs-home-link">
            Home
          </Link>
          <a
            href="https://github.com/dpostolachi/hadars"
            aria-label="Hadars on GitHub"
          >
            <RemixIcon name="github-line" />
            <span className="docs-github-label">GitHub</span>
          </a>
          <a className="docs-platform-link" href="https://app.hadars.xyz">
            Platform
          </a>
        </nav>
      </header>
      <div className="docs-mobile-menu">
        <details
          ref={menu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeMenu();
              summary.current?.focus();
            }
          }}
        >
          <summary
            ref={summary}
            className="docs-menu-trigger"
            aria-controls="docs-mobile-navigation"
          >
            <RemixIcon name="menu-line" className="docs-menu-open" />
            <RemixIcon name="close-line" className="docs-menu-close" />
            <span>Browse documentation</span>
            <RemixIcon name="arrow-down-s-line" />
          </summary>
          <nav
            id="docs-mobile-navigation"
            className="docs-mobile-navigation"
            aria-label="Mobile documentation"
          >
            <NavContent onNavigate={closeMenu} />
          </nav>
        </details>
      </div>
      <div className="docs-body">
        <aside className="docs-sidebar">
          <nav aria-label="Documentation">
            <NavContent />
          </nav>
          <a
            className="docs-sidebar-source"
            href="https://github.com/dpostolachi/hadars"
          >
            <RemixIcon name="github-line" />
            View on GitHub
          </a>
        </aside>
        <main id="docs-main" className="docs-main" tabIndex={-1}>
          <div className="docs-content">
            <nav className="docs-breadcrumbs" aria-label="Breadcrumb">
              <Link to="/">Hadars</Link>
              <span aria-hidden="true">/</span>
              <span>{current?.group ?? "Documentation"}</span>
              {current && (
                <>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">{current.label}</span>
                </>
              )}
            </nav>
            {children}
            {current && (
              <nav
                className="docs-pagination"
                aria-label="Adjacent documentation"
              >
                {previous ? (
                  <Link to={previous.to}>
                    <span>Previous</span>
                    <strong>{previous.label}</strong>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link to={next.to}>
                    <span>Next</span>
                    <strong>{next.label}</strong>
                  </Link>
                )}
              </nav>
            )}
            <footer className="docs-footer">
              <span>hadars · MIT licence</span>
              <a href="https://github.com/dpostolachi/hadars">
                Source on GitHub
              </a>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
