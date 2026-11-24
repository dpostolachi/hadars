import React from "react";
import { HadarsHead, useServerData } from "hadars";
import Code from "../components/Code";
import RemixIcon from "../components/RemixIcon";
import { readDemoCard } from "../lib/demo-data";
import {
  decodeDataCards,
  type DataCards,
  type DataCardKind,
  type DataCard,
} from "../lib/demo-protocol";
import "../styles/demos.css";

const Override = React.createContext<DataCards | null>(null);
const labels: Record<DataCardKind, string> = {
  release: "Latest release",
  branch: "Default branch",
  commit: "Latest commit",
  message: "Commit message",
};
function Card({
  initial,
  kind,
}: {
  initial: DataCard | undefined;
  kind: DataCardKind;
}) {
  const override = React.useContext(Override),
    value = override?.[kind] ?? initial;
  return (
    <div className={`demo-data-card demo-data-${kind}`}>
      <span>{labels[kind]}</span>
      <strong>{value?.value ?? "Unavailable"}</strong>
      <small>
        {kind === "commit" && value?.detail
          ? new Date(value.detail).toISOString().slice(0, 10)
          : kind === "message"
            ? value?.detail
            : (value?.detail ?? "GitHub metadata could not be loaded.")}
      </small>
    </div>
  );
}
function ReleaseCard() {
  const data = useServerData(() => readDemoCard("release"), { cache: false });
  return <Card initial={data} kind="release" />;
}
function BranchCard() {
  const data = useServerData(() => readDemoCard("branch"), { cache: false });
  return <Card initial={data} kind="branch" />;
}
function CommitCard() {
  const data = useServerData(() => readDemoCard("commit"), { cache: false });
  return <Card initial={data} kind="commit" />;
}
function MessageCard() {
  const data = useServerData(() => readDemoCard("message"), { cache: false });
  return <Card initial={data} kind="message" />;
}

export default function DataDemo() {
  const [cards, setCards] = React.useState<DataCards | null>(null),
    [busy, setBusy] = React.useState(false),
    [ready, setReady] = React.useState(false);
  const [requests, setRequests] = React.useState(0),
    [result, setResult] = React.useState<{
      duration: number;
      bytes: number;
      payload: unknown;
    } | null>(null),
    [error, setError] = React.useState("");
  const lock = React.useRef(false);
  React.useEffect(() => {
    setReady(true);
  }, []);
  const run = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setRequests((n) => n + 1);
    const start = performance.now();
    try {
      const response = await fetch("/data-demo", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const text = await response.text(),
        payload = JSON.parse(text),
        next = decodeDataCards(payload);
      setCards(next);
      setResult({
        duration: Math.round(performance.now() - start),
        bytes: new TextEncoder().encode(text).byteLength,
        payload,
      });
    } catch {
      setError("The server data request failed. Try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <HadarsHead status={200}>
        <title>Server data batching — hadars</title>
        <meta
          name="description"
          content="Inspect one real Hadars request that returns data for four independent React components."
        />
      </HadarsHead>
      <h1>Server data batching</h1>
      <p>
        Four components load their own repository data on the server. Inspect a
        single browser request that brings all four results back together.
      </p>
      <section
        className="demo-workbench"
        aria-labelledby="data-workbench-title"
      >
        <div className="demo-toolbar">
          <div>
            <span className="demo-eyebrow">LIVE GITHUB REPOSITORY</span>
            <h2 id="data-workbench-title">dpostolachi / hadars</h2>
          </div>
          <button
            className="demo-button"
            onClick={run}
            disabled={!ready || busy}
          >
            <RemixIcon name="refresh-line" />
            {busy ? "Fetching…" : "Fetch server data"}
          </button>
        </div>
        <Override.Provider value={cards}>
          <div className="demo-data-grid">
            <React.Suspense
              fallback={
                <div className="demo-empty">Loading repository data…</div>
              }
            >
              <ReleaseCard />
              <BranchCard />
              <CommitCard />
              <MessageCard />
            </React.Suspense>
          </div>
        </Override.Provider>
        <div className="demo-request-summary" role="status">
          <div>
            <span>Requests sent here</span>
            <strong>{requests}</strong>
          </div>
          <div>
            <span>Values per successful response</span>
            <strong>{result ? "4" : "—"}</strong>
          </div>
          <div>
            <span>Round trip</span>
            <strong>{result ? `${result.duration} ms` : "—"}</strong>
          </div>
          <div>
            <span>Response size</span>
            <strong>
              {result ? `${result.bytes.toLocaleString("en-GB")} B` : "—"}
            </strong>
          </div>
        </div>
        {error && (
          <p className="demo-error" role="alert">
            {error}
          </p>
        )}
        <div className="demo-payload">
          <div className="demo-section-label">
            <h3>Response inspector</h3>
            <span>GET /data-demo · application/json</span>
          </div>
          {result ? (
            <pre tabIndex={0} aria-label="Actual server data response">
              <code>{JSON.stringify(result.payload, null, 2)}</code>
            </pre>
          ) : (
            <div className="demo-empty">
              The cards load through useServerData. Run a request to inspect a
              fresh server response.
            </div>
          )}
        </div>
        <div className="demo-footnote">
          This is live repository metadata. It is cached for 60 seconds to
          respect GitHub’s rate limits, so repeated requests can return the same
          values. Unavailable fields are shown explicitly.
        </div>
      </section>
      <section className="demo-explanation">
        <h2>Independent components. One response.</h2>
        <p>
          Each card calls <code>useServerData</code> separately. Hadars resolves
          the loaders on the server and returns their values as one map. The
          browser can update all four components from that one response.
        </p>
        <Code lang="tsx">{`function ReleaseCard() {
    const release = useServerData(() => readRelease());
    return <Release version={release} />;
}

function BranchCard() {
    const branch = useServerData(() => readBranch());
    return <Branch name={branch} />;
}`}</Code>
        <div className="demo-source-links">
          <a href="/docs/data">Read the data fetching guide</a>
          <a href="https://github.com/dpostolachi/hadars/blob/main/website/src/pages/DataDemo.tsx">
            View demo source
          </a>
        </div>
      </section>
    </>
  );
}
