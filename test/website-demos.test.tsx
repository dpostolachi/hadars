import {
  test,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  decodeDataCards,
  decodeRenderSnapshot,
} from "../website/src/lib/demo-protocol";
import en from "../website/static/locales/en/storefront.json";
import ro from "../website/static/locales/ro/storefront.json";

// Website components and the library use one React instance in these DOM tests.
const reactModule = await import("react");
mock.module(
  new URL("../website/node_modules/react/index.js", import.meta.url).pathname,
  () => reactModule,
);
const { MemoryRouter, Routes, Route } =
  await import("../website/node_modules/react-router-dom/dist/index.mjs");
const { CacheInspector: CacheDemo } =
  await import("../website/src/pages/CacheTest");
const { default: DataDemo } = await import("../website/src/pages/DataDemo");
const { default: LanguageDemo } = await import("../website/src/pages/I18nDemo");

let root: Root | undefined,
  container: HTMLDivElement,
  counter = 0;
const originalFetch = globalThis.fetch;
const cards = (release = "v1.2.0") => ({
  release: {
    kind: "release",
    value: release,
    detail: "Latest published release",
  },
  branch: { kind: "branch", value: "main", detail: null },
  commit: { kind: "commit", value: "abc1234", detail: "2026-11-24T12:00:00Z" },
  message: { kind: "message", value: "Improve examples", detail: "abc1234" },
});
const snapshotHTML = (renderId: string) =>
  `<script id="hadars" type="application/json">${JSON.stringify({ hadars: { props: { __serverData: { snapshot: { kind: "cache-render", renderId, renderedAt: 1795521600000 } } } } })}</script>`;
const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
async function mount(ui: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(<Suspense fallback={<p>Loading…</p>}>{ui}</Suspense>);
    await flush();
  });
  await act(flush);
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
    await flush();
  });
  await act(flush);
}

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://demo.example.test/", settings: { disableJavaScriptFileLoading: true } });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  globalThis.fetch = originalFetch;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  mock.restore();
});
beforeEach(() => {
  window.history.replaceState({}, "", `/i18n-demo?unit=${++counter}`);
  document.head.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
      await flush();
    });
    root = undefined;
  }
  container.remove();
  globalThis.fetch = originalFetch;
});

test("response inspector validates server-rendered identities and rejects missing data", () => {
  expect(decodeRenderSnapshot(snapshotHTML("same"))).toEqual({
    renderId: "same",
    renderedAt: 1795521600000,
  });
  expect(() =>
    decodeRenderSnapshot("<html>not a Hadars page</html>"),
  ).toThrow();
  expect(() =>
    decodeRenderSnapshot(
      '<script id="hadars" type="application/json">{"hadars":{"props":{"renderId":null}}}</script>',
    ),
  ).toThrow();
  expect(Object.keys(decodeDataCards({ serverData: cards() }))).toHaveLength(4);
  expect(() =>
    decodeDataCards({ serverData: { release: cards().release } }),
  ).toThrow();
  expect(() =>
    decodeDataCards({ serverData: { ...cards(), duplicate: cards().release } }),
  ).toThrow();
});

test("cache inspector compares real render IDs, handles a new render and retains state on failure", async () => {
  let request = 0;
  globalThis.fetch = mock(async () => {
    request++;
    if (request === 3) return new Response("Unavailable", { status: 503 });
    return new Response(snapshotHTML(request === 1 ? "initial" : "new-render"));
  }) as typeof fetch;
  await mount(<CacheDemo renderId="initial" renderedAt={1795521600000} />);
  await click("Send request");
  expect(container.textContent).toContain("The server reused this render.");
  await click("Send request");
  expect(container.textContent).toContain(
    "A different server render was returned.",
  );
  expect(container.textContent).toContain("new-rend");
  await click("Send request");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be inspected",
  );
  expect(container.querySelectorAll(".demo-history li")).toHaveLength(2);
});

test("data playground makes one explicit request for all four components and handles incomplete responses", async () => {
  let requests = 0;
  globalThis.fetch = mock(async () => {
    requests++;
    return Response.json({
      serverData:
        requests < 3
          ? cards(requests === 1 ? "v1.2.0" : "v1.3.0")
          : { release: cards().release },
    });
  }) as typeof fetch;
  await mount(<DataDemo />);
  expect(container.textContent).toContain("v1.2.0");
  const initial = requests;
  await click("Fetch server data");
  expect(requests - initial).toBe(1);
  expect(container.querySelector(".demo-data-release")?.textContent).toContain(
    "v1.3.0",
  );
  expect(container.querySelector(".demo-payload pre")?.textContent).toContain(
    "serverData",
  );
  await click("Fetch server data");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "failed",
  );
  expect(container.querySelector(".demo-data-release")?.textContent).toContain(
    "v1.3.0",
  );
});

test("language preview uses same-origin translations, preserves quantity, changes plural and money formats, and caches revisits", async () => {
  let romanianRequests = 0;
  globalThis.fetch = mock(async (input) => {
    const url = String(input);
    if (url.includes("/api/demo-locales/ro/storefront.json")) {
      romanianRequests++;
      expect(url).toBe(
        "/api/demo-locales/ro/storefront.json",
      );
      return Response.json(ro);
    }
    return Response.json({ serverData: { initial: en } });
  }) as typeof fetch;
  await mount(
    <MemoryRouter initialEntries={["/i18n-demo"]}>
      <Routes>
        <Route path="/i18n-demo" element={<LanguageDemo />} />
        <Route path="/ro/i18n-demo" element={<LanguageDemo />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(container.textContent).toContain("Orbit desk lamp");
  await click("Increase quantity");
  expect(container.querySelector("output")?.textContent).toBe("2");
  expect(container.textContent).toContain("2 items");
  await click("Română");
  expect(container.textContent).toContain("Lampă de birou Orbit");
  expect(container.textContent).toContain("2 produse");
  expect(container.querySelector("output")?.textContent).toBe("2");
  expect(container.querySelector(".demo-order-total strong")?.textContent).toBe(
    new Intl.NumberFormat("ro-RO", {
      style: "currency",
      currency: "EUR",
    }).format(178),
  );
  expect(window.location.pathname).toBe("/ro/i18n-demo");
  await click("English");
  expect(container.textContent).toContain("2 items");
  await click("Română");
  expect(romanianRequests).toBe(1);
});

test("a failed language request leaves the current product and quantity usable", async () => {
  globalThis.fetch = mock(async (input) => {
    if (String(input).includes("/api/demo-locales/ro/"))
      throw new Error("synthetic network failure");
    return Response.json({ serverData: { initial: en } });
  }) as typeof fetch;
  await mount(
    <MemoryRouter initialEntries={["/i18n-demo"]}>
      <Routes>
        <Route path="/i18n-demo" element={<LanguageDemo />} />
        <Route path="/ro/i18n-demo" element={<LanguageDemo />} />
      </Routes>
    </MemoryRouter>,
  );
  await click("Română");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be loaded",
  );
  expect(container.textContent).toContain("Orbit desk lamp");
  await click("Increase quantity");
  expect(container.querySelector("output")?.textContent).toBe("2");
});
