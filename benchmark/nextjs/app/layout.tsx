export const metadata = {
    title: 'SSR Benchmark — Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body style={{ margin: 0 }}>{children}</body>
        </html>
    );
}
