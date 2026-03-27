import React, { useEffect, useRef } from 'react';

interface Star {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    baseOpacity: number;
    color: string;
    twinkle: number;
    twinkleSpeed: number;
}

// Violet / indigo / cyan palette matching the site theme
const COLORS = ['#a78bfa', '#c4b5fd', '#818cf8', '#67e8f9', '#e9d5ff', '#a5b4fc'];

const STAR_COUNT    = 90;
const MAX_DIST      = 140;   // px — max line-drawing distance
const LINE_OPACITY  = 0.18;  // max line alpha
const SPEED         = 0.18;  // px / frame

function initStar(w: number, h: number): Star {
    const angle = Math.random() * Math.PI * 2;
    const speed = SPEED * (0.4 + Math.random() * 0.6);
    return {
        x:           Math.random() * w,
        y:           Math.random() * h,
        vx:          Math.cos(angle) * speed,
        vy:          Math.sin(angle) * speed,
        r:           0.4 + Math.random() * 1.4,
        baseOpacity: 0.4 + Math.random() * 0.55,
        color:       COLORS[Math.floor(Math.random() * COLORS.length)],
        twinkle:     Math.random() * Math.PI * 2,
        twinkleSpeed:0.008 + Math.random() * 0.018,
    };
}

const StarField: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0;
        let stars: Star[] = [];

        const resize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width  = w;
            canvas.height = h;
            // Re-seed so stars fill the new viewport
            stars = Array.from({ length: STAR_COUNT }, () => initStar(w, h));
        };
        resize();
        window.addEventListener('resize', resize);

        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            // ── update ──────────────────────────────────────────────────────
            for (const s of stars) {
                s.x += s.vx;
                s.y += s.vy;
                s.twinkle += s.twinkleSpeed;
                if (s.x < -10) s.x += w + 20;
                if (s.x > w + 10) s.x -= w + 20;
                if (s.y < -10) s.y += h + 20;
                if (s.y > h + 10) s.y -= h + 20;
            }

            // ── constellation lines — single batched path per alpha bucket ──
            // Avoid createLinearGradient per pair (very expensive); use a flat
            // rgba stroke instead, bucketed into 4 opacity levels to minimise
            // strokeStyle changes while keeping the fade-with-distance look.
            ctx.lineWidth = 0.6;
            const BUCKETS = 4;
            const paths = Array.from({ length: BUCKETS }, () => new Path2D());
            for (let i = 0; i < stars.length; i++) {
                for (let j = i + 1; j < stars.length; j++) {
                    const dx   = stars[i].x - stars[j].x;
                    const dy   = stars[i].y - stars[j].y;
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < MAX_DIST * MAX_DIST) {
                        const t = Math.sqrt(dist2) / MAX_DIST;           // 0 (close) → 1 (far)
                        const bucket = Math.min(BUCKETS - 1, Math.floor((1 - t) * BUCKETS));
                        paths[bucket].moveTo(stars[i].x, stars[i].y);
                        paths[bucket].lineTo(stars[j].x, stars[j].y);
                    }
                }
            }
            for (let b = 0; b < BUCKETS; b++) {
                const alpha = LINE_OPACITY * ((b + 1) / BUCKETS);
                ctx.strokeStyle = `rgba(167,139,250,${alpha.toFixed(2)})`;
                ctx.stroke(paths[b]);
            }

            // ── stars — no shadowBlur (expensive); manual halo arc instead ──
            for (const s of stars) {
                const twinkle = 0.65 + 0.35 * Math.sin(s.twinkle);
                const opacity = s.baseOpacity * twinkle;

                // Soft halo: large semi-transparent arc
                ctx.globalAlpha = opacity * 0.18;
                ctx.fillStyle   = s.color;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
                ctx.fill();

                // Mid glow
                ctx.globalAlpha = opacity * 0.35;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * 2, 0, Math.PI * 2);
                ctx.fill();

                // Bright core
                ctx.globalAlpha = opacity;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 1;

            raf = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position:      'fixed',
                inset:         0,
                width:         '100%',
                height:        '100%',
                pointerEvents: 'none',
                zIndex:        0,
                willChange:    'transform',  // promote to own compositor layer
            }}
        />
    );
};

export default StarField;
