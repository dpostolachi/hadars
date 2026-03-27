import React, { useId } from 'react';

/**
 * hadars logo — an "H" constellation:
 * four corner stars + a brighter centre star at the crossbar,
 * all linked by faint nebula lines. The name "Hadar" (β Centauri)
 * is one of the brightest stars in the southern sky.
 *
 * IDs are scoped per-instance via useId() so multiple logos in the
 * same document don't share gradient/filter definitions (which causes
 * cross-SVG url() references to silently fail in most browsers).
 */
const HadarsLogo: React.FC<{ size?: number }> = ({ size = 32 }) => {
    const uid = useId().replace(/:/g, '');
    const lgId = `${uid}lg`;
    const sgId = `${uid}sg`;
    const cgId = `${uid}cg`;

    return (
    <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="hadars logo"
    >
        <defs>
            {/* Violet → cyan gradient matching the site theme */}
            <linearGradient id={lgId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0%"   stopColor="#e9d5ff" />
                <stop offset="48%"  stopColor="#a855f7" />
                <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>

            {/* Soft glow for individual stars */}
            <filter id={sgId} x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="b" />
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>

            {/* Stronger glow for the centre star */}
            <filter id={cgId} x="-150%" y="-150%" width="400%" height="400%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b" />
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
        </defs>

        {/* Ambient background halo */}
        <circle cx="16" cy="16" r="14" fill="#7c3aed" opacity="0.07" />

        {/* ── constellation lines (H shape) ── */}
        <line x1="8" y1="6.5" x2="8" y2="25.5"
              stroke={`url(#${lgId})`} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
        <line x1="24" y1="6.5" x2="24" y2="25.5"
              stroke={`url(#${lgId})`} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
        <line x1="8" y1="16" x2="24" y2="16"
              stroke={`url(#${lgId})`} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />

        {/* ── corner stars ── */}
        <circle cx="8"  cy="6.5"  r="2.1" fill={`url(#${lgId})`} filter={`url(#${sgId})`} />
        <circle cx="8"  cy="25.5" r="2.1" fill={`url(#${lgId})`} filter={`url(#${sgId})`} />
        <circle cx="24" cy="6.5"  r="2.1" fill={`url(#${lgId})`} filter={`url(#${sgId})`} />
        <circle cx="24" cy="25.5" r="2.1" fill={`url(#${lgId})`} filter={`url(#${sgId})`} />

        {/* ── centre (crossbar) star — the brightest ── */}
        <circle cx="16" cy="16" r="2.6" fill="white" opacity="0.75" filter={`url(#${cgId})`} />
        <circle cx="16" cy="16" r="2.2" fill={`url(#${lgId})`}     filter={`url(#${cgId})`} />

        {/* ── small ambient stars scattered around ── */}
        <circle cx="3.5"  cy="9.5"  r="0.9" fill="#c4b5fd" opacity="0.55" />
        <circle cx="28.5" cy="22"   r="0.9" fill="#67e8f9" opacity="0.55" />
        <circle cx="5"    cy="26"   r="0.65" fill="#a78bfa" opacity="0.40" />
        <circle cx="27"   cy="5"    r="0.65" fill="#67e8f9" opacity="0.40" />
        <circle cx="16"   cy="1.5"  r="0.75" fill="#e9d5ff" opacity="0.50" />
        <circle cx="29.5" cy="13"   r="0.55" fill="#c4b5fd" opacity="0.35" />
        <circle cx="2"    cy="19.5" r="0.55" fill="#67e8f9" opacity="0.35" />
    </svg>
    );
};

export default HadarsLogo;
