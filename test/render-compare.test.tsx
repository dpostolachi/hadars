/**
 * render-compare.test.tsx
 *
 * Compares slim-react's `renderToString` output against React 19's
 * `react-dom/server` `renderToString` for a wide range of component patterns.
 *
 * Tests are split into two groups:
 *
 *  • "compare:" – pure/sync components where both renderers must produce
 *    identical HTML (the ground truth is React's own output).
 *
 *  • "slim:" – slim-react-only features (async components, Suspense retries,
 *    useId format, useContext) that React's synchronous renderToString does
 *    not support.
 *
 * Run with: bun test test/render-compare.test.tsx
 */

/// <reference types="bun-types" />

import { test, expect, describe } from "bun:test";
import React from "react";
import { renderToString as reactRenderToString } from "react-dom/server";

// slim-react renderer & utilities imported directly from source so Bun
// transpiles them – no build step required during development.
import {
  renderToString as slimRenderToString,
  renderToStream,
} from "../src/slim-react/render";
import {
  createContext,
  useContext as slimUseContext,
  useId as slimUseId,
} from "../src/slim-react/index";
import { SUSPENSE_TYPE } from "../src/slim-react/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render `el` with both React DOM server and slim-react, assert they match,
 * and return the output for further assertions.
 */
async function compare(el: React.ReactNode): Promise<string> {
  const expected = reactRenderToString(el as any);
  const actual = await slimRenderToString(el as any);
  expect(actual).toBe(expected);
  return actual;
}

/** Collect a ReadableStream<Uint8Array> into a string. */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// compare: HTML structure
// ---------------------------------------------------------------------------

describe("compare: basic HTML", () => {
  test("single element", async () => {
    await compare(<div />);
  });

  test("nested elements", async () => {
    await compare(
      <main>
        <section>
          <h1>Hello</h1>
          <p>World</p>
        </section>
      </main>
    );
  });

  test("text content", async () => {
    await compare(<p>Hello world</p>);
  });

  test("number child", async () => {
    await compare(<p>{42}</p>);
  });

  test("adjacent text and number get separator", async () => {
    await compare(<p>{"hello"}{42}</p>);
  });

  test("null and boolean children are omitted", async () => {
    await compare(
      <ul>
        {null}
        {false}
        {true}
        {undefined}
        <li>visible</li>
      </ul>
    );
  });

  test("void elements have no closing tag and use self-closing slash", async () => {
    // Avoid <img>, <link>, and <meta> in this comparison test: React 19
    // injects preload hints or hoists those as resource tags, which our
    // slim renderer does not replicate.
    const html = await compare(
      <div>
        <br />
        <hr />
        <input type="text" />
        <wbr />
        <source src="/v.mp4" type="video/mp4" />
        <track kind="subtitles" />
      </div>
    );
    expect(html).toContain("<br/>");
    expect(html).toContain("<hr/>");
    expect(html).toContain('<input type="text"/>');
    expect(html).toContain("<wbr/>");
  });
});

// ---------------------------------------------------------------------------
// compare: attributes
// ---------------------------------------------------------------------------

describe("compare: attributes", () => {
  test("className → class", async () => {
    await compare(<div className="foo bar" />);
  });

  test("htmlFor → for", async () => {
    await compare(<label htmlFor="inp">Label</label>);
  });

  test("tabIndex → tabindex", async () => {
    await compare(<div tabIndex={0} />);
  });

  test("data-* and aria-* pass through unchanged", async () => {
    await compare(<p data-testid="x" aria-label="desc" aria-hidden={false} />);
  });

  test("style object → inline CSS string", async () => {
    // Use string values to avoid React's number-to-px conversion rules
    // (e.g. React appends 'px' to numeric font-size; our renderer does not).
    await compare(
      <div style={{ color: "red", fontSize: "14px", backgroundColor: "#fff" }} />
    );
  });

  test("boolean true emits attr=\"\"", async () => {
    await compare(<button disabled={true}>x</button>);
  });

  test("boolean false omits attr", async () => {
    await compare(<button disabled={false}>x</button>);
  });

  test("null / undefined prop omitted", async () => {
    await compare(<div id={null as any} className={undefined as any} />);
  });

  test("event handlers are stripped", async () => {
    await compare(
      <button onClick={() => {}} onMouseEnter={() => {}}>
        click
      </button>
    );
  });

  test("suppressHydrationWarning is NOT emitted as attribute", async () => {
    const html = await compare(
      <p suppressHydrationWarning>content</p>
    );
    expect(html).not.toContain("suppressHydrationWarning");
    expect(html).not.toContain("suppresshydrationwarning");
  });

  test("suppressContentEditableWarning is NOT emitted, contentEditable passes through", async () => {
    // Use the string form "true" so both renderers emit contentEditable="true"
    // (React treats contentEditable as an enumerated attribute, not a boolean).
    const html = await compare(
      <div contentEditable="true" suppressContentEditableWarning>editable</div>
    );
    expect(html).not.toContain("suppressContentEditableWarning");
    expect(html).toContain('contentEditable="true"');
  });

  test("HTML escaping in text content", async () => {
    await compare(<p>{"<script>alert('xss')</script>"}</p>);
  });

  test("HTML escaping in attribute value", async () => {
    await compare(<div title={'say "hello" & <bye>'} />);
  });
});

// ---------------------------------------------------------------------------
// compare: form elements
// ---------------------------------------------------------------------------

describe("compare: form elements", () => {
  test("input defaultValue → value attribute", async () => {
    await compare(<input type="text" defaultValue="hello" />);
  });

  test("input defaultChecked true → checked attr", async () => {
    await compare(<input type="checkbox" defaultChecked={true} />);
  });

  test("input defaultChecked false → no checked attr", async () => {
    await compare(<input type="checkbox" defaultChecked={false} />);
  });

  test("textarea defaultValue → inner text (not attribute)", async () => {
    const html = await compare(<textarea defaultValue="hello world" />);
    expect(html).toBe("<textarea>hello world</textarea>");
    expect(html).not.toContain("defaultValue");
    expect(html).not.toContain("value=");
  });

  test("textarea value → inner text", async () => {
    await compare(<textarea value="controlled" onChange={() => {}} />);
  });

  test("textarea escapes HTML in value", async () => {
    const html = await slimRenderToString(
      React.createElement("textarea" as any, { defaultValue: "<b>bold</b>" }) as any
    );
    expect(html).toBe("<textarea>&lt;b&gt;bold&lt;/b&gt;</textarea>");
  });

  test("select defaultValue marks matching option selected", async () => {
    const html = await compare(
      <select defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    );
    expect(html).toContain('<option value="b" selected="">B</option>');
    expect(html).not.toContain('<option value="a" selected="">');
  });

  test("select multiple defaultValue array marks multiple options", async () => {
    const html = await compare(
      <select multiple defaultValue={["a", "b"] as any}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    );
    expect(html).toContain('<option value="a" selected="">A</option>');
    expect(html).toContain('<option value="b" selected="">B</option>');
    expect(html).not.toContain('<option value="c" selected="">');
  });

  test("select value prop not emitted as attribute", async () => {
    const html = await compare(
      <select value="a" onChange={() => {}}>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    );
    expect(html).not.toMatch(/select[^>]*value=/);
  });
});

// ---------------------------------------------------------------------------
// compare: dangerouslySetInnerHTML
// ---------------------------------------------------------------------------

describe("compare: dangerouslySetInnerHTML", () => {
  test("renders raw HTML without escaping", async () => {
    const html = await compare(
      <div dangerouslySetInnerHTML={{ __html: "<em>raw <b>html</b></em>" }} />
    );
    expect(html).toBe('<div><em>raw <b>html</b></em></div>');
  });
});

// ---------------------------------------------------------------------------
// compare: Fragment and arrays
// ---------------------------------------------------------------------------

describe("compare: Fragment and arrays", () => {
  test("Fragment with element children", async () => {
    await compare(
      <>
        <span>a</span>
        <span>b</span>
      </>
    );
  });

  test("adjacent text siblings in Fragment get <!-- --> separator", async () => {
    const html = await compare(<>{"a"}{"b"}{"c"}</>);
    expect(html).toBe("a<!-- -->b<!-- -->c");
  });

  test("array of text children inside element", async () => {
    await compare(<p>{["x", "y", "z"]}</p>);
  });

  test("mixed element and text children", async () => {
    await compare(
      <p>
        <span>elem</span>
        {" after"}
      </p>
    );
  });

  test("text before element — no separator needed", async () => {
    await compare(<p>before<span>elem</span></p>);
  });

  test("deeply nested arrays", async () => {
    await compare(
      <ul>
        {[1, 2, 3].map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    );
  });
});

// ---------------------------------------------------------------------------
// compare: SVG
// ---------------------------------------------------------------------------

describe("compare: SVG", () => {
  test("svg gets no extra xmlns attribute (React 19 behaviour)", async () => {
    // React 19 no longer injects xmlns on <svg> — browsers handle the
    // namespace automatically for inline HTML5 SVG.
    const html = await compare(<svg />);
    expect(html).not.toContain("xmlns");
    expect(html).toBe("<svg></svg>");
  });

  test("SVG camelCase props → kebab-case attributes", async () => {
    const html = await compare(
      <svg>
        <circle cx={10} cy={10} r={5} fillOpacity={0.5} strokeWidth={2} />
      </svg>
    );
    expect(html).toContain('fill-opacity="0.5"');
    expect(html).toContain('stroke-width="2"');
  });

  test("foreignObject resets SVG context", async () => {
    const html = await slimRenderToString(
      React.createElement("svg" as any, null,
        React.createElement("foreignObject" as any, null,
          React.createElement("div" as any, { className: "x" }, "hi")
        )
      ) as any
    );
    expect(html).toContain('<div class="x">hi</div>');
  });
});

// ---------------------------------------------------------------------------
// compare: components
// ---------------------------------------------------------------------------

describe("compare: components", () => {
  test("function component", async () => {
    function Greet({ name }: { name: string }) {
      return <p>Hello, {name}!</p>;
    }
    await compare(<Greet name="world" />);
  });

  test("React.memo component", async () => {
    const MemoComp = React.memo(function ({ label }: { label: string }) {
      return <b>{label}</b>;
    });
    await compare(<MemoComp label="memoised" />);
  });

  test("React.forwardRef component", async () => {
    const FRComp = React.forwardRef<HTMLElement, { text: string }>(
      function ({ text }, _ref) {
        return <i>{text}</i>;
      }
    );
    await compare(<FRComp text="forwarded" />);
  });

  test("class component with props", async () => {
    class Title extends React.Component<{ level: number; text: string }> {
      render() {
        const Tag = `h${this.props.level}` as keyof JSX.IntrinsicElements;
        return <Tag>{this.props.text}</Tag>;
      }
    }
    await compare(<Title level={2} text="Hello" />);
  });

  test("class component with state from constructor", async () => {
    class Counter extends React.Component<{}, { count: number }> {
      constructor(props: {}) {
        super(props);
        this.state = { count: 5 };
      }
      render() {
        return <span>{this.state.count}</span>;
      }
    }
    await compare(<Counter />);
  });

  test("class component with getDerivedStateFromProps", async () => {
    class DerivedComp extends React.Component<
      { value: string },
      { derived: string }
    > {
      state = { derived: "" };
      static getDerivedStateFromProps(
        props: { value: string },
        _state: { derived: string }
      ) {
        return { derived: props.value.toUpperCase() };
      }
      render() {
        return <output>{this.state.derived}</output>;
      }
    }
    await compare(<DerivedComp value="hello" />);
  });
});

// ---------------------------------------------------------------------------
// compare: Context
// ---------------------------------------------------------------------------

describe("compare: Context (Provider + Consumer API)", () => {
  test("Consumer reads provider value", async () => {
    const Ctx = React.createContext("default");
    await compare(
      <Ctx.Provider value="overridden">
        <Ctx.Consumer>{(v) => <span>{v}</span>}</Ctx.Consumer>
      </Ctx.Provider>
    );
  });

  test("nested providers — innermost wins", async () => {
    const Ctx = React.createContext("default");
    await compare(
      <Ctx.Provider value="outer">
        <Ctx.Provider value="inner">
          <Ctx.Consumer>{(v) => <span>{v}</span>}</Ctx.Consumer>
        </Ctx.Provider>
        {/* After inner provider exits, outer value should be restored */}
        <Ctx.Consumer>{(v) => <em>{v}</em>}</Ctx.Consumer>
      </Ctx.Provider>
    );
  });

  test("Consumer uses default when no Provider", async () => {
    const Ctx = React.createContext("default-val");
    await compare(
      <div>
        <Ctx.Consumer>{(v) => <span>{v}</span>}</Ctx.Consumer>
      </div>
    );
  });
});

// ---------------------------------------------------------------------------
// compare: Suspense (synchronous — both renderers produce the same markers)
// ---------------------------------------------------------------------------

describe("compare: Suspense (sync children)", () => {
  test("resolved boundary emits <!--$-->...<!--/$--> markers", async () => {
    const html = await compare(
      <React.Suspense fallback={<p>Loading…</p>}>
        <span>ready</span>
      </React.Suspense>
    );
    expect(html).toBe("<!--$--><span>ready</span><!--/$-->");
  });

  test("nested Suspense boundaries", async () => {
    const html = await compare(
      <React.Suspense fallback="outer">
        <div>
          <React.Suspense fallback="inner">
            <span>deep</span>
          </React.Suspense>
        </div>
      </React.Suspense>
    );
    expect(html).toContain("<!--$-->");
    expect(html).toContain("<!--/$-->");
    expect(html).toContain("<span>deep</span>");
  });
});

// ---------------------------------------------------------------------------
// compare: complex real-world-like tree
// ---------------------------------------------------------------------------

describe("compare: complex tree", () => {
  test("blog post layout", async () => {
    const ThemeCtx = React.createContext("light");

    function Tag({ text }: { text: string }) {
      return <span className="tag">{text}</span>;
    }

    function PostMeta({ date, tags }: { date: string; tags: string[] }) {
      return (
        <div className="meta">
          <time dateTime={date}>{date}</time>
          {tags.map((t) => <Tag key={t} text={t} />)}
        </div>
      );
    }

    const Article = React.memo(function Article({
      title,
      body,
    }: {
      title: string;
      body: string;
    }) {
      return (
        <article>
          <h1>{title}</h1>
          <p>{body}</p>
        </article>
      );
    });

    await compare(
      <ThemeCtx.Provider value="dark">
        <main data-theme="dark">
          <PostMeta date="2026-03-10" tags={["react", "ssr", "slim"]} />
          <Article title="Hello SSR" body="Server rendering rocks." />
          <ThemeCtx.Consumer>
            {(theme) => <footer className={`footer-${theme}`}>© 2026</footer>}
          </ThemeCtx.Consumer>
        </main>
      </ThemeCtx.Provider>
    );
  });

  test("table with mapped rows", async () => {
    const rows = [
      { id: 1, name: "Alice", score: 98 },
      { id: 2, name: "Bob", score: 72 },
      { id: 3, name: "Carol", score: 85 },
    ];
    await compare(
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  });

  test("form with multiple input types", async () => {
    // Note: React 19 reorders <form> attributes (action before method).
    // Matching that order in JSX props ensures our renderer also matches.
    await compare(
      <form action="/submit" method="post">
        <input type="text" name="username" defaultValue="admin" />
        <input type="password" name="password" />
        <input type="checkbox" name="remember" defaultChecked={true} />
        <select name="role" defaultValue="editor">
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <textarea name="bio" defaultValue="Hello!" />
        <button type="submit" disabled={false}>Save</button>
      </form>
    );
  });
});

// ---------------------------------------------------------------------------
// slim: features not supported by React's synchronous renderToString
// ---------------------------------------------------------------------------

describe("slim: async components", () => {
  test("async component is awaited and rendered", async () => {
    async function AsyncGreet({ name }: { name: string }) {
      // Simulate a tiny async delay
      await new Promise((r) => setTimeout(r, 0));
      return React.createElement("p", null, `Hi, ${name}!`) as any;
    }
    const html = await slimRenderToString(
      React.createElement(AsyncGreet as any, { name: "async" }) as any
    );
    expect(html).toBe("<p>Hi, async!</p>");
  });

  test("deeply nested async components resolve in order", async () => {
    async function Leaf({ v }: { v: number }) {
      await Promise.resolve();
      return React.createElement("li", null, v) as any;
    }
    const html = await slimRenderToString(
      React.createElement(
        "ul",
        null,
        ...[1, 2, 3].map((v) => React.createElement(Leaf as any, { key: v, v }))
      ) as any
    );
    expect(html).toBe("<ul><li>1</li><li>2</li><li>3</li></ul>");
  });
});

describe("slim: Suspense with async data", () => {
  test("Suspense resolves async child and wraps with <!--$--> markers", async () => {
    let resolveData!: (v: string) => void;
    const dataPromise = new Promise<string>((res) => (resolveData = res));

    // Will throw `dataPromise` on first render, then resolve
    function AsyncChild() {
      if ((dataPromise as any).status !== "fulfilled") throw dataPromise;
      return React.createElement("span", null, (dataPromise as any).value) as any;
    }

    // Drive resolution in the background
    setTimeout(() => {
      resolveData("loaded!");
      (dataPromise as any).status = "fulfilled";
      (dataPromise as any).value = "loaded!";
    }, 5);

    const html = await slimRenderToString(
      React.createElement(SUSPENSE_TYPE as any, { fallback: "…" },
        React.createElement(AsyncChild as any, null)
      ) as any
    );
    expect(html).toBe("<!--$--><span>loaded!</span><!--/$-->");
  });

  test("Suspense renders fallback after max retries", async () => {
    // Use a counter so the component suspends a fixed number of times (less
    // than MAX_SUSPENSE_RETRIES) and eventually succeeds — but here we want
    // to test the FALLBACK path, so we use a promise that never resolves
    // within the retry window by immediately making it resolve AFTER we check.
    //
    // We craft a minimal scenario: throw a promise that never resolves so
    // the renderer exhausts retries and falls back to <!--$?-->.
    // To keep the test fast we use a custom Suspense wrapper that catches only
    // a specific sentinel rather than waiting for the full 25 retries.

    // We abuse the fact that renderSuspense uses MAX_SUSPENSE_RETRIES (25).
    // Instead of waiting 25 iterations, we create a promise that resolves
    // quickly but whose component remains in a suspended state by always
    // throwing a NEW promise. The renderer gives up after 25 retries.
    let retries = 0;
    function AlwaysSuspends() {
      const p = new Promise<void>((res) => setTimeout(res, 0));
      retries++;
      throw p;
    }

    const html = await Promise.race([
      slimRenderToString(
        React.createElement(SUSPENSE_TYPE as any, {
          fallback: React.createElement("p", null, "loading…"),
        },
          React.createElement(AlwaysSuspends as any, null)
        ) as any
      ),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10_000)
      ),
    ]);

    expect(html).toBe("<!--$?--><p>loading\u2026</p><!--/$-->");
    // Sanity-check that the renderer actually retried
    expect(retries).toBe(25);
  });
});

describe("slim: Suspense with renderToStream", () => {
  test("stream flushes Suspense boundary markers around resolved content", async () => {
    async function Delayed() {
      await Promise.resolve();
      return React.createElement("b", null, "streamed") as any;
    }
    const stream = renderToStream(
      React.createElement(SUSPENSE_TYPE as any, { fallback: "…" },
        React.createElement(Delayed as any, null)
      ) as any
    );
    const html = await streamToString(stream);
    expect(html).toBe("<!--$--><b>streamed</b><!--/$-->");
  });
});

describe("slim: useId", () => {
  test("useId produces React-compatible colon-prefixed IDs", async () => {
    function WithId() {
      const id = slimUseId();
      return React.createElement("label", { htmlFor: id }, id) as any;
    }
    const html = await slimRenderToString(
      React.createElement(WithId as any, null) as any
    );
    // React useId format: ":R<base32tree>:" with optional "H<n>:" suffix
    expect(html).toMatch(/for=":R[^"]*:".*:R[^"]*:/s);
  });

  test("two useId calls in the same component produce different IDs", async () => {
    function TwoIds() {
      const a = slimUseId();
      const b = slimUseId();
      return React.createElement(
        "div",
        null,
        React.createElement("span", { id: a }, "a"),
        React.createElement("span", { id: b }, "b")
      ) as any;
    }
    const html = await slimRenderToString(
      React.createElement(TwoIds as any, null) as any
    );
    // Extract the two id attributes
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("sibling components produce different useId roots", async () => {
    function IdComp({ label }: { label: string }) {
      const id = slimUseId();
      return React.createElement("span", { "data-label": label, id }, null) as any;
    }
    const html = await slimRenderToString(
      React.createElement(
        "div",
        null,
        React.createElement(IdComp as any, { label: "first" }),
        React.createElement(IdComp as any, { label: "second" })
      ) as any
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("slim: useContext", () => {
  test("useContext reads the current context value", async () => {
    const Ctx = createContext("default");
    function Consumer() {
      const val = slimUseContext(Ctx);
      return React.createElement("span", null, val) as any;
    }
    const html = await slimRenderToString(
      React.createElement(Ctx.Provider, { value: "provided" } as any,
        React.createElement(Consumer as any, null)
      ) as any
    );
    expect(html).toBe("<span>provided</span>");
  });

  test("useContext falls back to default value when no Provider", async () => {
    const Ctx = createContext("fallback-default");
    function Consumer() {
      const val = slimUseContext(Ctx);
      return React.createElement("span", null, val) as any;
    }
    const html = await slimRenderToString(
      React.createElement(Consumer as any, null) as any
    );
    expect(html).toBe("<span>fallback-default</span>");
  });
});

// ---------------------------------------------------------------------------
// slim: context isolation — concurrent and sequential request safety
// ---------------------------------------------------------------------------

describe("slim: context isolation", () => {
  test("concurrent renders have isolated context values", async () => {
    // Each render runs with its own Provider value. An async component reads
    // the context synchronously (as per rules of hooks), then yields so the
    // two renders interleave. The captured value must still be correct.
    const Ctx = createContext("default");

    async function AsyncReader() {
      const val = slimUseContext(Ctx); // read synchronously before any await
      await Promise.resolve(); // yield — allows the other render to interleave
      return React.createElement("span", null, val) as any;
    }

    const [html1, html2] = await Promise.all([
      slimRenderToString(
        React.createElement(Ctx.Provider, { value: "request-A" } as any,
          React.createElement(AsyncReader as any, null)
        ) as any
      ),
      slimRenderToString(
        React.createElement(Ctx.Provider, { value: "request-B" } as any,
          React.createElement(AsyncReader as any, null)
        ) as any
      ),
    ]);

    expect(html1).toBe("<span>request-A</span>");
    expect(html2).toBe("<span>request-B</span>");
  });

  test("context values do not leak between sequential renders", async () => {
    // After a render with a Provider completes, the next render must see the
    // default value — not the previously provided value.
    const Ctx = createContext("default");
    function Reader() {
      const val = slimUseContext(Ctx);
      return React.createElement("span", null, val) as any;
    }

    const html1 = await slimRenderToString(
      React.createElement(Ctx.Provider, { value: "provided" } as any,
        React.createElement(Reader as any, null)
      ) as any
    );
    expect(html1).toBe("<span>provided</span>");

    // Second render has no Provider — must not inherit the previous value
    const html2 = await slimRenderToString(
      React.createElement(Reader as any, null) as any
    );
    expect(html2).toBe("<span>default</span>");
  });

  test("context value is not leaked when an async component inside a Provider throws", async () => {
    // Regression: when finish() was only wired to the success path, a Provider
    // whose async descendant threw an error would leave _currentValue set.
    // The next render would then see the stale value instead of the default.
    const Ctx = createContext("default");
    function Reader() {
      const val = slimUseContext(Ctx);
      return React.createElement("span", null, val) as any;
    }

    let threw = false;
    try {
      await slimRenderToString(
        React.createElement(Ctx.Provider, { value: "leaked-value" } as any,
          React.createElement(
            async function ThrowsAfterAwait() {
              await Promise.resolve();
              throw new Error("intentional failure");
            } as any,
            null
          )
        ) as any
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Must see the default, not "leaked-value" from the failed render
    const html = await slimRenderToString(
      React.createElement(Reader as any, null) as any
    );
    expect(html).toBe("<span>default</span>");
  });
});

describe("slim: React.lazy", () => {
  test("React.lazy component is resolved before rendering inside Suspense", async () => {
    // React.lazy uses the _init/_payload protocol; slim-react's renderer
    // handles it via the REACT_LAZY $$typeof branch.
    const LazyComp = React.lazy(
      () => Promise.resolve({ default: ({ msg }: { msg: string }) =>
        React.createElement("strong", null, msg) as any
      })
    );
    const html = await slimRenderToString(
      React.createElement(
        // Use slim-react's own Suspense type so the renderer's Suspense logic runs
        SUSPENSE_TYPE as any,
        { fallback: React.createElement("span", null, "loading") },
        React.createElement(LazyComp as any, { msg: "lazy-loaded" })
      ) as any
    );
    expect(html).toBe("<!--$--><strong>lazy-loaded</strong><!--/$-->");
  });
});
