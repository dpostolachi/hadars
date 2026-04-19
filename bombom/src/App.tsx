import React from 'react';
import { HadarsHead, type HadarsApp } from 'hadars';

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f13;
    color: #e2e8f0;
    min-height: 100vh;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 2rem;
    border-bottom: 1px solid #1e1e2e;
  }
  .nav-brand { font-weight: 700; font-size: 1.1rem; color: #a78bfa; letter-spacing: -0.02em; }
  .nav-links { display: flex; gap: 1.5rem; }
  .nav-links a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; }
  .nav-links a:hover { color: #e2e8f0; }

  .hero {
    text-align: center;
    padding: 5rem 1rem 4rem;
    max-width: 680px;
    margin: 0 auto;
  }
  .hero-badge {
    display: inline-block;
    background: #1e1a2e;
    border: 1px solid #4c1d95;
    color: #a78bfa;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.3rem 0.8rem;
    border-radius: 999px;
    margin-bottom: 1.5rem;
  }
  .hero h1 {
    font-size: clamp(2rem, 5vw, 3.25rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    margin-bottom: 1rem;
  }
  .hero h1 span { color: #a78bfa; }
  .hero p {
    font-size: 1.1rem;
    color: #94a3b8;
    line-height: 1.7;
    margin-bottom: 2.5rem;
  }
  .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 1.4rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, transform 0.1s;
    text-decoration: none;
  }
  .btn:hover { opacity: 0.85; transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }
  .btn-primary { background: #7c3aed; color: #fff; }
  .btn-ghost { background: #1e1e2e; color: #e2e8f0; border: 1px solid #2d2d3e; }

  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    max-width: 900px;
    margin: 0 auto 4rem;
    padding: 0 1.5rem;
  }
  .card {
    background: #16161f;
    border: 1px solid #1e1e2e;
    border-radius: 12px;
    padding: 1.5rem;
  }
  .card-icon { font-size: 1.5rem; margin-bottom: 0.75rem; }
  .card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; }
  .card p { font-size: 0.85rem; color: #64748b; line-height: 1.6; }

  .demo {
    max-width: 480px;
    margin: 0 auto 4rem;
    padding: 0 1.5rem;
    text-align: center;
  }
  .demo-box {
    background: #16161f;
    border: 1px solid #1e1e2e;
    border-radius: 12px;
    padding: 2rem;
  }
  .demo-box h2 { font-size: 0.8rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 1.25rem; }
  .counter { font-size: 3.5rem; font-weight: 800; color: #a78bfa; letter-spacing: -0.04em; margin-bottom: 1.25rem; }
  .demo-actions { display: flex; gap: 0.75rem; justify-content: center; }

`;

const App: HadarsApp<{}> = () => {
  const [count, setCount] = React.useState(0);

  return (
    <>
      <HadarsHead status={200}>
        <title>My App</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style data-id="app-styles" dangerouslySetInnerHTML={{ __html: css }} />
      </HadarsHead>

      <nav className="nav">
        <span className="nav-brand">my-app</span>
        <div className="nav-links">
          <a href="https://github.com/dpostolachi/hadar" target="_blank" rel="noopener">github</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">built with hadars</div>
        <h1>Ship <span>React apps</span><br />at full speed</h1>
        <p>
          SSR out of the box, zero config, instant hot-reload.
          Edit <code>src/App.tsx</code> to get started.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => setCount(c => c + 1)}>
            Try the counter ↓
          </button>
        </div>
      </section>

      <div className="features">
        <div className="card">
          <div className="card-icon">⚡</div>
          <h3>Server-side rendering</h3>
          <p>Pages render on the server and hydrate on the client — great for SEO and first paint.</p>
        </div>
        <div className="card">
          <div className="card-icon">🔥</div>
          <h3>Hot module reload</h3>
          <p>Changes in <code>src/App.tsx</code> reflect instantly in the browser during development.</p>
        </div>
        <div className="card">
          <div className="card-icon">📦</div>
          <h3>Zero config</h3>
          <p>One config file. Export a React component, run <code>hadars dev</code>, done.</p>
        </div>
        <div className="card">
          <div className="card-icon">🗄️</div>
          <h3>Server data hooks</h3>
          <p>Use <code>useServerData</code> to fetch data on the server without extra round-trips.</p>
        </div>
      </div>

      <div className="demo">
        <div className="demo-box">
          <h2>Client interactivity works</h2>
          <div className="counter">{count}</div>
          <div className="demo-actions">
            <button className="btn btn-ghost" onClick={() => setCount(c => c - 1)}>− dec</button>
            <button className="btn btn-primary" onClick={() => setCount(c => c + 1)}>+ inc</button>
          </div>
        </div>
      </div>

    </>
  );
};

export default App;
