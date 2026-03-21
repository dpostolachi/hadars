import React from 'react';
import { NavLink, Link } from 'react-router-dom';
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

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex min-h-screen bg-background text-foreground" style={{ position: 'relative' }}>
        <HadarsHead>
            <meta property="og:site_name" content="hadars" />
            <meta property="og:type" content="website" />
            <meta name="twitter:card" content="summary" />
            <meta name="robots" content="index, follow" />
        </HadarsHead>

        {/* Animated starfield — renders behind everything via DOM order + z-index */}
        <StarField />

        {/* Cosmic sidebar */}
        <nav
            className="w-56 shrink-0 flex flex-col gap-6 px-4 py-6 sticky top-0 h-screen overflow-y-auto"
            style={{
                position:    'relative',
                zIndex:      1,
                background:  'linear-gradient(180deg, oklch(0.09 0.03 280 / 0.85) 0%, oklch(0.06 0.025 280 / 0.85) 100%)',
                borderRight: '1px solid oklch(0.68 0.28 285 / 0.15)',
                boxShadow:   '4px 0 24px oklch(0.68 0.28 285 / 0.04)',
                backdropFilter: 'blur(12px)',
            }}
        >
            {/* Logo */}
            <Link
                to="/"
                className="flex items-center gap-2.5 group"
            >
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
        </nav>

        {/* Main content */}
        <main className="flex-1 max-w-3xl mx-auto px-8 py-10" style={{ position: 'relative', zIndex: 1 }}>
            {children}
        </main>
    </div>
);

export default Layout;
