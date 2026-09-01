export interface GithubRepoInfo {
    latestCommitSha: string | null;
    latestCommitMessage: string | null;
    latestCommitDate: string | null;
    defaultBranch: string;
    latestRelease: string | null;
}

const REPO = 'dpostolachi/hadars';

let cached: { data: GithubRepoInfo; expires: number } | null = null;
let inFlight: Promise<GithubRepoInfo> | null = null;

const FALLBACK: GithubRepoInfo = {
    latestCommitSha: null,
    latestCommitMessage: null,
    latestCommitDate: null,
    defaultBranch: 'main',
    latestRelease: null,
};

/**
 * A handful of independent demo rows on the homepage and docs pages each want
 * a different field off this repo — fetch it once and let every caller share
 * the result. GitHub rate-limits unauthenticated requests per source IP, and
 * on an edge platform that IP is shared across many tenants, so turning
 * "N demo rows" into "N GitHub requests per visit" would be an easy way to
 * get 403s under real traffic.
 */
export async function getHadarsRepoInfo(): Promise<GithubRepoInfo> {
    if (cached && cached.expires > Date.now()) return cached.data;
    if (inFlight) return inFlight;

    inFlight = (async () => {
        try {
            const [repoRes, releaseRes] = await Promise.all([
                fetch(`https://api.github.com/repos/${REPO}`, {
                    headers: { Accept: 'application/vnd.github+json' },
                }),
                fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
                    headers: { Accept: 'application/vnd.github+json' },
                }),
            ]);
            const repo = repoRes.ok ? await repoRes.json() : null;
            const release = releaseRes.ok ? await releaseRes.json() : null;

            const commitsRes = await fetch(
                `https://api.github.com/repos/${REPO}/commits?sha=${repo?.default_branch ?? 'main'}&per_page=1`,
                { headers: { Accept: 'application/vnd.github+json' } },
            );
            const commits = commitsRes.ok ? await commitsRes.json() : null;
            const latestCommit = commits?.[0] ?? null;

            const data: GithubRepoInfo = {
                latestCommitSha: latestCommit?.sha?.slice(0, 7) ?? FALLBACK.latestCommitSha,
                latestCommitMessage: latestCommit?.commit?.message?.split('\n')[0] ?? FALLBACK.latestCommitMessage,
                latestCommitDate: latestCommit?.commit?.author?.date ?? FALLBACK.latestCommitDate,
                defaultBranch: repo?.default_branch ?? FALLBACK.defaultBranch,
                latestRelease: release?.tag_name ?? FALLBACK.latestRelease,
            };
            cached = { data, expires: Date.now() + 60_000 };
            return data;
        } catch {
            return FALLBACK;
        } finally {
            inFlight = null;
        }
    })();

    return inFlight;
}

/** "3 hours ago" style formatting for a commit/release timestamp. */
export function timeAgo(iso: string | null): string {
    if (!iso) return 'unknown';
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
