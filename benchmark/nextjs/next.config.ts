import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Disable source maps and telemetry for a clean production build
    productionBrowserSourceMaps: false,
};

export default nextConfig;
