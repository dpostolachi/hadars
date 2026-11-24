import React from "react";
import { Link } from "react-router-dom";
import { useServerData, loadModule } from "hadars";
import { getHadarsRepoInfo } from "../lib/githubRepo";
import RemixIcon from "./RemixIcon";
import "../styles/demos.css";

const DemoLibrary = React.lazy(() =>
  loadModule<{ default: React.FC }>("../LazyPanel"),
);
function RepositoryPreview() {
  const repo = useServerData(() => getHadarsRepoInfo(), { cache: false });
  const available = !!(repo?.latestCommitSha || repo?.latestRelease);
  return (
    <div className="demo-repository-preview">
      <div>
        <RemixIcon name="github-line" />
        <span>dpostolachi / hadars</span>
        <small>
          {available
            ? "Live server data"
            : "GitHub data temporarily unavailable"}
        </small>
      </div>
      <dl>
        <div>
          <dt>Latest release</dt>
          <dd>{repo?.latestRelease ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Latest commit</dt>
          <dd>{repo?.latestCommitSha ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Default branch</dt>
          <dd>{available ? repo?.defaultBranch : "Unavailable"}</dd>
        </div>
      </dl>
      <Link to="/data-demo">Inspect the request</Link>
    </div>
  );
}
export default function LiveDemo({
  bunVersion,
}: {
  serverTime: string;
  bunVersion: string;
}) {
  return (
    <div className="landing-demo">
      <section id="demo" className="demo-library">
        <div className="demo-library-heading">
          <div>
            <div className="eyebrow">TRY IT IN YOUR BROWSER</div>
            <h2>See what Hadars does.</h2>
          </div>
          <p>
            Explore working examples with real requests and inspectable results.
          </p>
        </div>
        <React.Suspense
          fallback={<div className="demo-empty">Loading examples…</div>}
        >
          <DemoLibrary />
        </React.Suspense>
        <RepositoryPreview />
        <p className="demo-library-footnote">
          This page is server-rendered by Hadars on {bunVersion.split(" ")[0]}.
          These examples use the same framework as the site you are browsing.
        </p>
      </section>
    </div>
  );
}
