import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { HadarsHead } from 'hadars';
import HadarsLogo from './HadarsLogo';
import StarField from './StarField';

const NAV = [
    {
        label: 'Introduction',
        links: [
            { to: '/', label: 'Overview' },
        ],
    },
    {
        label: 'Guides',
        links: [
            { to: '/docs/getting-started', label: 'Getting Started' },
            { to: '/docs/routing', label: 'Routing' },
            { to: '/docs/head', label: 'Head Management' },
            { to: '/docs/data', label: 'Data Fetching' },
            { to: '/docs/from-nextjs', label: 'From Next.js' },
        ],
    },
    {
        label: 'Reference',
        links: [
            { to: '/docs/api', label: 'API Reference' },
            { to: '/docs/slim-react', label: 'slim-react' },
            { to: '/docs/deployment', label: 'Deployment' },
            { to: '/docs/cloudflare', label: 'Cloudflare Workers' },
            { to: '/docs/static-export', label: 'Static Export & Sources' },
            { to: '/docs/swc-plugins', label: 'SWC Plugins' },
        ],
    },
    {
        label: 'Demos',
        links: [
            { to: '/cache-test', label: 'Cache Demo' },
            { to: '/data-demo', label: 'Data Fetch Demo' },
        ],
    },
];

const NavContent: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => (
    <>
        <Link to="/" className="flex items-center gap-2.5 group" onClick={onNavigate}>
            <HadarsLogo size={28} />
            <span className="text-lg font-bold tracking-tight font-mono text-gradient">
                hadars
            </span>
        </Link>

        {NAV.map(group => (
            <div key={group.label} className="flex flex-col gap-0.5">
                <span
                    className="text-xs font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: 'oklch(0.50 0.08 285)' }}
                >
                    {group.label}
                </span>
                {group.links.map(({ to, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                            'text-sm px-2.5 py-1.5 rounded-md transition-all ' +
                            (isActive
                                ? 'text-primary font-medium'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/80')
                        }
                        style={({ isActive }) => isActive ? {
                            background: 'oklch(0.68 0.28 285 / 0.10)',
                            border: '1px solid oklch(0.68 0.28 285 / 0.25)',
                            boxShadow: '0 0 12px oklch(0.68 0.28 285 / 0.12)',
                        } : {}}
                    >
                        {label}
                    </NavLink>
                ))}
            </div>
        ))}
    </>
);

const sidebarStyle = {
    background: 'linear-gradient(180deg, oklch(0.09 0.03 280 / 0.95) 0%, oklch(0.06 0.025 280 / 0.95) 100%)',
    borderRight: '1px solid oklch(0.68 0.28 285 / 0.15)',
    boxShadow: '4px 0 24px oklch(0.68 0.28 285 / 0.04)',
    backdropFilter: 'blur(12px)',
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = useState(false);
    const location = useLocation();

    // Close drawer and reset scroll on route change
    useEffect(() => {
        setOpen(false);
        window.scrollTo(0, 0);
    }, [location.pathname]);

    return (
        <div className="flex min-h-screen bg-background text-foreground" style={{ position: 'relative' }}>
            <HadarsHead>
                <meta property="og:site_name" content="hadars" />
                <meta property="og:type" content="website" />
                <meta name="twitter:card" content="summary" />
                <meta name="robots" content="index, follow" />
            </HadarsHead>

            <StarField />

            {/* ── Desktop sidebar (md+) ──────────────────────────── */}
            <nav
                className="hidden md:flex w-56 shrink-0 flex-col gap-6 px-4 py-6 sticky top-0 h-screen overflow-y-auto"
                style={{ position: 'relative', zIndex: 1, ...sidebarStyle }}
            >
                <NavContent />
            </nav>

            {/* ── Mobile top bar ────────────────────────────────── */}
            <div
                className="md:hidden fixed top-0 left-0 right-0 flex items-center gap-3 px-4 h-14"
                style={{ zIndex: 50, ...sidebarStyle, borderRight: 'none', borderBottom: '1px solid oklch(0.68 0.28 285 / 0.15)' }}
            >
                <button
                    aria-label={open ? 'Close menu' : 'Open menu'}
                    onClick={() => setOpen(o => !o)}
                    className="flex flex-col justify-center gap-1.5 w-6 h-6"
                >
                    <span
                        className="block h-0.5 rounded-full transition-all"
                        style={{
                            background: 'oklch(0.68 0.28 285)',
                            transform: open ? 'translateY(8px) rotate(45deg)' : 'none',
                        }}
                    />
                    <span
                        className="block h-0.5 rounded-full transition-all"
                        style={{
                            background: 'oklch(0.68 0.28 285)',
                            opacity: open ? 0 : 1,
                        }}
                    />
                    <span
                        className="block h-0.5 rounded-full transition-all"
                        style={{
                            background: 'oklch(0.68 0.28 285)',
                            transform: open ? 'translateY(-8px) rotate(-45deg)' : 'none',
                        }}
                    />
                </button>
                <Link to="/" className="flex items-center gap-2.5 group">
                    <HadarsLogo size={28} />
                    <span className="text-lg font-bold tracking-tight font-mono text-gradient">hadars</span>
                </Link>
            </div>

            {/* ── Mobile drawer ─────────────────────────────────── */}
            {open && (
                <div
                    className="md:hidden fixed inset-0"
                    style={{ zIndex: 40 }}
                    onClick={() => setOpen(false)}
                >
                    <nav
                        className="absolute top-14 left-0 bottom-0 w-64 flex flex-col gap-6 px-4 py-6 overflow-y-auto"
                        style={sidebarStyle}
                        onClick={e => e.stopPropagation()}
                    >
                        <NavContent onNavigate={() => setOpen(false)} />
                    </nav>
                </div>
            )}

            {/* ── Main content ──────────────────────────────────── */}
            <main
                className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-10 pt-20 md:pt-10"
                style={{ position: 'relative', zIndex: 1 }}
            >
                <div className="max-w-3xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
};

export default Layout;
