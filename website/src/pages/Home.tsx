import React, { useState } from "react";
import { HadarsHead } from "hadars";
import LiveDemo from "../components/LiveDemo";
import RemixSprite from "../components/RemixSprite";
import LambdaLogo from "../assets/aws-lambda.svg";
import CloudflareLogo from "../assets/cloudflare-workers.svg";
import BunnyLogo from "../assets/bunny-net.svg";
import "../styles/landing.css";

export interface HomeProps {
  serverTime: string;
  bunVersion: string;
  rcClient?: any;
}

export default function Home({ serverTime, bunVersion }: HomeProps) {
  const [copied, setCopied] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText("npx hadars new my-app");
      setCopied(true);
      setCopyStatus("Create-app command copied.");
    } catch {
      setCopyStatus("Select and copy the command: npx hadars new my-app");
    }
  };
  return (
    <>
      <HadarsHead status={200}>
        <title>hadars — SSR for React</title>
        <meta
          name="description"
          content="Server-side React without the ceremony. Build with TypeScript and deploy to AWS Lambda, Cloudflare Workers, Bunny.net Edge Scripts, or your own server."
        />
        <meta property="og:title" content="hadars — SSR for React" />
        <meta
          property="og:description"
          content="Your React app. Your deployment. Serverless and edge exports for AWS Lambda, Cloudflare Workers and Bunny.net."
        />
        <meta property="og:site_name" content="hadars" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <link rel="canonical" href="https://hadars.xyz/" />
      </HadarsHead>
      <div id="home" className="event-horizon">
        <RemixSprite />
        <a className="landing-skip" href="#main-content">
          Skip to content
        </a>
        <header className="site-header">
          <a className="wordmark" href="/">
            <span className="logo" aria-hidden="true">
              h
            </span>
            hadars<span className="brand-period">.</span>
          </a>
          <nav aria-label="Website">
            <a href="#deployment">Deployment</a>
            <a href="/docs/getting-started">Documentation</a>
            <a href="https://app.hadars.xyz" className="button secondary">
              Open the platform
            </a>
          </nav>
        </header>
        <main id="main-content">
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="line"></span> THE REACT SSR FRAMEWORK
              </div>
              <h1>
                A new center
                <br />
                of <em>gravity.</em>
              </h1>
              <p>
                Export a component. Fetch your data. Ship your app.
                <br className="desktop" /> Deploy to AWS Lambda, Cloudflare
                Workers, or Bunny.net Edge Scripts.
              </p>
              <div className="hero-actions">
                <a className="button primary" href="/docs/getting-started">
                  Start building
                </a>
                <a className="text-link" href="#deployment">
                  Explore deployment
                </a>
              </div>
              <button
                id="copy-command"
                onClick={copyCommand}
                className="install"
                aria-label="Copy create app command"
              >
                <span aria-hidden="true">$</span>
                <code>npx hadars new my-app</code>
                <span className="copy-label">{copied ? "Copied" : "Copy"}</span>
              </button>
              <div className="hero-caption">
                React 19 <span>·</span> TypeScript <span>·</span> Powered by
                rspack
              </div>
            </div>
            <div
              className="hero-visual"
              aria-label="Stylized black hole with an accretion disk, surrounded by React and server data"
            >
              <div className="blackhole-scene" aria-hidden="true">
                <div className="starfield"></div>
                <div className="cosmic-coordinate">REACT / SERVER / CLIENT</div>
                <div className="gravity-well">
                  <div className="relativistic-jet"></div>
                  <div className="lensing-ring"></div>
                  <div className="accretion-disk"></div>
                  <div className="event-core"></div>
                  <div className="accretion-disk disk-front"></div>
                  <div className="photon-ring"></div>
                </div>
                <div className="orbit-label label-react">
                  React<span>Your components</span>
                </div>
                <div className="orbit-label label-server">
                  Server<span>Your data</span>
                </div>
                <div className="cosmic-caption">Everything in its orbit.</div>
              </div>
            </div>
          </section>
          <div className="runtime-strip">
            <span>YOUR APP. YOUR RUNTIME.</span>
            <strong>Bun</strong>
            <strong>Node.js</strong>
            <strong>Deno</strong>
            <span className="runtime-detail">
              Built on the standard Fetch API
            </span>
          </div>
          <section
            className="deployment-section"
            id="deployment"
            aria-labelledby="deployment-title"
          >
            <div className="deployment-intro">
              <div>
                <div className="eyebrow">SERVERLESS &amp; EDGE, BUILT IN</div>
                <h2 id="deployment-title">
                  Your app.
                  <br />
                  <em>Your deployment.</em>
                </h2>
              </div>
              <div>
                <p>
                  Run server-rendered React on AWS Lambda, Cloudflare Workers,
                  or Bunny.net Edge Scripts. Let your hosting platform handle
                  the infrastructure and scaling while you build your product.
                </p>
                <span className="deployment-promise">
                  One React app. Three built-in export targets.
                </span>
              </div>
            </div>
            <div className="deployment-targets">
              <article className="deployment-target">
                <div className="deployment-head">
                  <LambdaLogo
                    className="provider-logo"
                    width="48"
                    height="48"
                    aria-hidden="true"
                  />
                  <span className="deployment-tag">SERVERLESS</span>
                </div>
                <h3>AWS Lambda</h3>
                <p>
                  Render on demand behind API Gateway, with AWS managing
                  execution environments as traffic grows.
                </p>
                <div className="deployment-command">
                  <span>EXPORT YOUR HANDLER</span>
                  <code>hadars export lambda</code>
                </div>
                <div className="deployment-assets">
                  <span>STATIC ASSETS</span>
                  <strong>S3 + CloudFront</strong>
                </div>
                <a className="text-link" href="/docs/deployment">
                  Lambda deployment guide
                </a>
              </article>
              <article className="deployment-target">
                <div className="deployment-head">
                  <CloudflareLogo
                    className="provider-logo"
                    width="48"
                    height="48"
                    aria-hidden="true"
                  />
                  <span className="deployment-tag">EDGE</span>
                </div>
                <h3>Cloudflare Workers</h3>
                <p>
                  Run your SSR handler on Cloudflare’s edge network using the
                  standard Web Request and Response APIs.
                </p>
                <div className="deployment-command">
                  <span>EXPORT YOUR WORKER</span>
                  <code>hadars export cloudflare</code>
                </div>
                <div className="deployment-assets">
                  <span>STATIC ASSETS</span>
                  <strong>R2 or your CDN</strong>
                </div>
                <a className="text-link" href="/docs/cloudflare">
                  Workers deployment guide
                </a>
              </article>
              <article className="deployment-target">
                <div className="deployment-head">
                  <BunnyLogo
                    className="provider-logo provider-logo-bunny"
                    width="149"
                    height="43"
                    aria-hidden="true"
                  />
                  <span className="deployment-tag">EDGE</span>
                </div>
                <h3>Bunny.net Edge Scripts</h3>
                <p>
                  Serve SSR through a standalone edge script on Bunny’s Deno +
                  V8 runtime, with Web APIs throughout.
                </p>
                <div className="deployment-command">
                  <span>EXPORT YOUR EDGE SCRIPT</span>
                  <code>hadars export bunny</code>
                </div>
                <div className="deployment-assets">
                  <span>STATIC ASSETS</span>
                  <strong>Bunny Storage + CDN</strong>
                </div>
                <a className="text-link" href="/docs/bunny">
                  Bunny deployment guide
                </a>
              </article>
            </div>
            <div className="deployment-options">
              <span>BUILD. EXPORT. DEPLOY.</span>
              <p>
                Each target exports a self-contained SSR <code>.mjs</code>{" "}
                bundle. Deploy with your provider’s tooling and serve static
                assets separately.
              </p>
            </div>
            <div className="deployment-selfhost">
              <span>Prefer your own server?</span>
              <strong>Bun · Node.js · Deno</strong>
              <span>The same app runs there, too.</span>
            </div>
          </section>
          <section className="workflow" id="workflow">
            <div>
              <div className="eyebrow">LESS SETUP. MORE MOMENTUM.</div>
              <h2>
                From a component
                <br />
                to a running app.
              </h2>
              <p>
                A familiar React workflow, with the server already connected.
              </p>
            </div>
            <div className="workflow-steps">
              <div>
                <span className="step-icon">
                  <svg
                    className="ui-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <use href="#ri-code-s-slash-line"></use>
                  </svg>
                </span>
                <h3>Write your React</h3>
                <p>
                  Components and TypeScript. The tools you already reach for.
                </p>
              </div>
              <div>
                <span className="step-icon">
                  <svg
                    className="ui-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <use href="#ri-database-2-line"></use>
                  </svg>
                </span>
                <h3>Bring your data</h3>
                <p>
                  Load it on the server with <code>getInitProps</code>, then
                  hydrate on the client.
                </p>
              </div>
              <div>
                <span className="step-icon">
                  <svg
                    className="ui-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <use href="#ri-server-line"></use>
                  </svg>
                </span>
                <h3>Choose your runtime</h3>
                <p>
                  Run on Bun, Node.js or Deno. Keep deployment in your hands.
                </p>
              </div>
            </div>
          </section>
          <section className="example-section" id="example">
            <div>
              <div className="eyebrow">SMALL BY DESIGN</div>
              <h2>
                A component.
                <br />A data function.
                <br />
                <em>That’s your app.</em>
              </h2>
              <p>
                No special page convention to learn. Export your component and
                let Hadars handle rendering.
              </p>
              <a className="text-link" href="/docs/getting-started">
                Read the getting started guide
              </a>
            </div>
            <div className="code-window">
              <div className="code-header">
                <span>src/App.tsx</span>
                <span>TypeScript / React</span>
              </div>
              <pre>
                <code>
                  <span className="syntax">export default function</span>{" "}
                  App(&#123; user &#125;) &#123;
                  <span className="syntax">return</span> ( &lt;main&gt;
                  &lt;h1&gt;Hello, &#123;user.name&#125;&lt;/h1&gt;
                  &lt;p&gt;Rendered on the server.&lt;/p&gt; &lt;/main&gt; );
                  &#125;
                  <span className="syntax">export async function</span>{" "}
                  getInitProps(req) &#123;
                  <span className="syntax">return</span> &#123; user:{" "}
                  <span className="syntax">await</span> getUser(req) &#125;;
                  &#125;
                </code>
              </pre>
              <div className="code-footer">
                Simplified example · add types for your app
              </div>
            </div>
          </section>
          <LiveDemo serverTime={serverTime} bunVersion={bunVersion} />
          <section className="platform-callout">
            <div>
              <div className="eyebrow">BUILDING WITH MICRO-FRONTENDS?</div>
              <h2>
                Independent builds.
                <br />
                Deliberate releases.
              </h2>
              <p>
                The Hadars platform gives your team a shared place to manage
                versions and move them through environments.
              </p>
            </div>
            <a href="https://app.hadars.xyz" className="button primary">
              Open the platform
            </a>
          </section>
        </main>
        <footer>
          <a className="wordmark" href="/">
            hadars.
          </a>
          <span>Server-side React, without the ceremony.</span>
          <a href="https://github.com/dpostolachi/hadars">
            GitHub · MIT licence
          </a>
        </footer>
      </div>
      <span className="landing-status" role="status">
        {copyStatus}
      </span>
    </>
  );
}
