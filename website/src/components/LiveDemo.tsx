import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerData, loadModule } from "hadars";
import { getHadarsRepoInfo, timeAgo } from "../lib/githubRepo";

const LazyPanel = React.lazy(() =>
  loadModule<{ default: React.FC }>("../LazyPanel"),
);

// ── live demo components ──────────────────────────────────────────────────────
// Both rows fetch this repo's own GitHub metadata — one live value to prove
// the fetch really happened on the server, backed by a single shared/cached
// request (see lib/githubRepo.ts) rather than one GitHub call per row.

const LatestCommitRow: React.FC = () => {
  const info = useServerData(() => getHadarsRepoInfo(), { cache: false });
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground w-48 shrink-0">
        useServerData
      </span>
      <span className="text-sm font-mono">
        {info
          ? `${info.latestCommitSha ?? "unknown"} · ${timeAgo(info.latestCommitDate)}`
          : "—"}
      </span>
    </div>
  );
};

const SuspenseQueryRow: React.FC = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["hadars-repo"],
    queryFn: () => getHadarsRepoInfo(),
    staleTime: Infinity,
  });
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground w-48 shrink-0">
        useSuspenseQuery
      </span>
      <span className="text-sm font-mono">
        latest release {data.latestRelease ?? "unreleased"}
      </span>
    </div>
  );
};

const UseIdInput: React.FC<{ label: string }> = ({ label }) => {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        type="text"
        placeholder={label}
        className="flex-1 h-7 px-2 rounded-md border border-border bg-muted text-sm font-mono"
      />
      <code className="text-xs text-muted-foreground">{id}</code>
    </div>
  );
};

export default function LiveDemo({
  serverTime,
  bunVersion,
}: {
  serverTime: string;
  bunVersion: string;
}) {
  const [count, setCount] = React.useState(0);
  return (
    <div className="landing-demo">
      {" "}
      {/* live demo */}
      <section className="mb-10" id="demo">
        <h2 className="text-xl font-semibold mb-3 text-gradient-soft">
          Live demo
        </h2>
        <p className="text-muted-foreground mb-4">
          This page <em>is</em> a hadars app. The values below were produced on
          the server.
        </p>
        <div
          className="rounded-xl divide-y overflow-hidden"
          style={{
            background: "oklch(0.08 0.025 280)",
            border: "1px solid oklch(0.68 0.28 285 / 0.2)",
            boxShadow: "0 0 32px oklch(0.68 0.28 285 / 0.06)",
          }}
        >
          <DemoRow label="Server time">{serverTime}</DemoRow>
          <DemoRow label="Runtime">{bunVersion}</DemoRow>
          <LatestCommitRow />
          <React.Suspense
            fallback={
              <DemoRow label="useSuspenseQuery">
                <span className="text-muted-foreground">loading…</span>
              </DemoRow>
            }
          >
            <SuspenseQueryRow />
          </React.Suspense>
          <React.Suspense
            fallback={
              <DemoRow label="loadModule (lazy chunk)">
                <span className="text-muted-foreground">loading…</span>
              </DemoRow>
            }
          >
            <LazyPanel />
          </React.Suspense>
          <div
            className="flex items-center gap-4 px-4 py-3"
            style={{ borderColor: "oklch(0.68 0.28 285 / 0.1)" }}
          >
            <span className="text-sm text-muted-foreground w-48 shrink-0">
              useId() SSR
            </span>
            <span className="flex-1 text-sm">
              <UseIdInput label="Username" />
            </span>
          </div>
          <div
            className="flex items-center gap-4 px-4 py-3"
            style={{ borderColor: "oklch(0.68 0.28 285 / 0.1)" }}
          >
            <span className="text-sm text-muted-foreground w-48 shrink-0">
              Client counter
            </span>
            <span className="flex items-center gap-2 text-sm">
              <CosmicButton onClick={() => setCount((c) => c - 1)}>
                −
              </CosmicButton>
              <strong className="font-mono w-6 text-center tabular-nums">
                {count}
              </strong>
              <CosmicButton onClick={() => setCount((c) => c + 1)}>
                +
              </CosmicButton>
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 italic">
          Counter starts at zero on every load (SSR renders 0, client hydrates
          0). Clicking proves the React tree is live. Open the console — no
          hydration warnings.
        </p>
      </section>
    </div>
  );
}

const DemoRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div
    className="flex items-center gap-4 px-4 py-3"
    style={{ borderColor: "oklch(0.68 0.28 285 / 0.1)" }}
  >
    <span className="text-sm text-muted-foreground w-48 shrink-0">{label}</span>
    <span className="text-sm font-mono">{children}</span>
  </div>
);

const CosmicButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
}> = ({ onClick, children }) => (
  <button
    className="h-6 w-6 rounded text-sm font-bold transition-all"
    style={{
      background: "oklch(0.68 0.28 285 / 0.1)",
      border: "1px solid oklch(0.68 0.28 285 / 0.3)",
      color: "oklch(0.75 0.20 285)",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "oklch(0.68 0.28 285 / 0.2)";
      (e.currentTarget as HTMLButtonElement).style.boxShadow =
        "0 0 8px oklch(0.68 0.28 285 / 0.3)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "oklch(0.68 0.28 285 / 0.1)";
      (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
    }}
    onClick={onClick}
  >
    {children}
  </button>
);
