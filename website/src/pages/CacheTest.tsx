import React from "react";
import { HadarsHead, useServerData } from "hadars";
import Code from "../components/Code";
import RemixIcon from "../components/RemixIcon";
import {
  decodeRenderSnapshot,
  type RenderSnapshot,
} from "../lib/demo-protocol";
import "../styles/demos.css";

type Observation = RenderSnapshot & { reused: boolean; duration: number };
export function CacheInspector({ renderId, renderedAt }: RenderSnapshot) {
  const [snapshot, setSnapshot] = React.useState<RenderSnapshot>({
    renderId,
    renderedAt,
  });
  const [history, setHistory] = React.useState<Observation[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    setReady(true);
  }, []);
  const lock = React.useRef(false);
  const run = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const start = performance.now();
    try {
      const response = await fetch("/cache-test", {
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const next = decodeRenderSnapshot(await response.text());
      const observation = {
        ...next,
        reused: next.renderId === snapshot.renderId,
        duration: Math.round(performance.now() - start),
      };
      setSnapshot(next);
      setHistory((previous) => [observation, ...previous].slice(0, 8));
    } catch {
      setError("The response could not be inspected. Try the request again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const latest = history[0];
  return (
    <>
      <HadarsHead status={200}>
        <title>Response caching — hadars</title>
        <meta
          name="description"
          content="Send real page requests, compare server render identities, and see Hadars response caching in action."
        />
      </HadarsHead>
      <h1>Response caching</h1>
      <p>
        Send the same request twice. A matching render ID means the server
        reused the page. After the 30-second cache window expires, a request can
        produce a new render.
      </p>
      <section
        className="demo-workbench"
        aria-labelledby="cache-workbench-title"
      >
        <div className="demo-toolbar">
          <div>
            <span className="demo-eyebrow">LIVE RESPONSE INSPECTOR</span>
            <h2 id="cache-workbench-title">Same URL. Same render?</h2>
          </div>
          <button
            className="demo-button"
            onClick={run}
            disabled={!ready || busy}
          >
            <RemixIcon name="refresh-line" />
            {busy ? "Requesting…" : "Send request"}
          </button>
        </div>
        <div className="demo-stats">
          <div>
            <span>Cache policy</span>
            <strong>30 seconds</strong>
            <small>Configured response TTL</small>
          </div>
          <div>
            <span>Render ID</span>
            <strong className="demo-mono">
              {snapshot.renderId.slice(0, 8)}
            </strong>
            <small>Generated on the server</small>
          </div>
          <div>
            <span>Rendered at</span>
            <strong className="demo-mono">
              {new Date(snapshot.renderedAt).toISOString().slice(11, 23)}
            </strong>
            <small>Server time · UTC</small>
          </div>
        </div>
        <div
          className={`demo-observation ${latest?.reused ? "is-success" : ""}`}
          role="status"
        >
          <RemixIcon
            name={
              latest
                ? latest.reused
                  ? "check-line"
                  : "refresh-line"
                : "information-line"
            }
          />
          <div>
            <strong>
              {busy
                ? "Inspecting the response…"
                : latest
                  ? latest.reused
                    ? "The server reused this render."
                    : "A different server render was returned."
                  : "Ready to inspect server responses."}
            </strong>
            <p>
              {latest
                ? `The round trip took ${latest.duration} ms. Compare the IDs below to see what changed.`
                : "Press “Send request” to compare a new response with the page you loaded."}
            </p>
          </div>
        </div>
        {error && (
          <p className="demo-error" role="alert">
            {error}
          </p>
        )}
        <div className="demo-history">
          <div className="demo-section-label">
            <h3>Requests made here</h3>
            <span>
              {history.length
                ? `${history.length} most recent`
                : "Waiting for your first request"}
            </span>
          </div>
          {history.length ? (
            <ol>
              {history.map((entry, index) => (
                <li key={`${entry.renderId}-${index}`}>
                  <span
                    className={
                      entry.reused ? "demo-result reused" : "demo-result"
                    }
                  >
                    {entry.reused ? "Reused" : "Different"}
                  </span>
                  <code>{entry.renderId.slice(0, 8)}</code>
                  <span>
                    {new Date(entry.renderedAt).toISOString().slice(11, 23)} UTC
                  </span>
                  <strong>{entry.duration} ms</strong>
                </li>
              ))}
            </ol>
          ) : (
            <div className="demo-empty">
              Run a request now, repeat it, then try again after the cache
              window expires.
            </div>
          )}
        </div>
        <div className="demo-footnote">
          The observations compare actual render IDs, rather than estimating a
          cache hit from your browser’s clock. The cache is local to each server
          instance.
        </div>
        <noscript>
          <p className="demo-footnote">
            Reload this page and compare the render ID to try this without
            JavaScript.
          </p>
        </noscript>
      </section>
      <section className="demo-explanation">
        <h2>What to look for</h2>
        <div className="demo-explanation-grid">
          <div>
            <h3>Repeat the request</h3>
            <p>
              While the cached response is available, its ID and server
              timestamp stay the same.
            </p>
          </div>
          <div>
            <h3>Wait for expiry</h3>
            <p>
              After 30 seconds, send another request. A new ID shows a new
              server render. Different server instances can also return
              different IDs.
            </p>
          </div>
        </div>
        <Code lang="typescript">{`cache: (req) => req.pathname === '/cache-test'
    ? { key: req.pathname, ttl: 30_000 }
    : null`}</Code>
        <div className="demo-source-links">
          <a href="/docs/deployment">Read about response caching</a>
          <a href="https://github.com/dpostolachi/hadars/blob/main/website/src/pages/CacheTest.tsx">
            View demo source
          </a>
        </div>
      </section>
    </>
  );
}

function CacheSnapshot() {
  const snapshot = useServerData(
    () => ({
      kind: "cache-render",
      renderId: crypto.randomUUID(),
      renderedAt: Date.now(),
    }),
    { cache: false },
  );
  return snapshot ? (
    <CacheInspector
      renderId={snapshot.renderId}
      renderedAt={snapshot.renderedAt}
    />
  ) : (
    <p>Loading server response…</p>
  );
}

export default function CacheTest() {
  return (
    <React.Suspense fallback={<p>Loading server response…</p>}>
      <CacheSnapshot />
    </React.Suspense>
  );
}
