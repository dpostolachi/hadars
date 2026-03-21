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
                // Wrap around edges
                if (s.x < -10) s.x += w + 20;
                if (s.x > w + 10) s.x -= w + 20;
                if (s.y < -10) s.y += h + 20;
                if (s.y > h + 10) s.y -= h + 20;
            }

            // ── constellation lines ─────────────────────────────────────────
            ctx.lineWidth = 0.6;
            for (let i = 0; i < stars.length; i++) {
                for (let j = i + 1; j < stars.length; j++) {
                    const dx   = stars[i].x - stars[j].x;
                    const dy   = stars[i].y - stars[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < MAX_DIST) {
                        const alpha = LINE_OPACITY * (1 - dist / MAX_DIST);
                        // Gradient line: one star's colour → the other's
                        const grad = ctx.createLinearGradient(
                            stars[i].x, stars[i].y,
                            stars[j].x, stars[j].y,
                        );
                        grad.addColorStop(0, stars[i].color + Math.round(alpha * 255).toString(16).padStart(2, '0'));
                        grad.addColorStop(1, stars[j].color + Math.round(alpha * 255).toString(16).padStart(2, '0'));
                        ctx.beginPath();
                        ctx.moveTo(stars[i].x, stars[i].y);
                        ctx.lineTo(stars[j].x, stars[j].y);
                        ctx.strokeStyle = grad;
                        ctx.stroke();
                    }
                }
            }

            // ── stars ───────────────────────────────────────────────────────
            for (const s of stars) {
                const twinkle  = 0.65 + 0.35 * Math.sin(s.twinkle);
                const opacity  = s.baseOpacity * twinkle;
                const glowSize = s.r * (4 + twinkle * 3);

                // Glow halo
                ctx.shadowBlur  = glowSize;
                ctx.shadowColor = s.color;
                ctx.globalAlpha = opacity * 0.55;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * 1.2, 0, Math.PI * 2);
                ctx.fillStyle = s.color;
                ctx.fill();

                // Bright core
                ctx.shadowBlur  = s.r * 2;
                ctx.globalAlpha = opacity;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.shadowBlur  = 0;
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
            }}
        />
    );
};

export default StarField;
