/**
 * useId parity: slim-react must emit byte-identical ids to react-dom/server for
 * whichever React is installed, because the browser's hydrateRoot computes the
 * same ids and any difference is a hydration attribute mismatch.
 *
 * The id format changed with the React minor (18 / 19.0 `:R0:`, 19.1 `«R0»`,
 * 19.2+ `_R_0_`), so CI runs this file against several React versions. The
 * "format table" tests below pin each format independent of the installed React.
 *
 * Run with: bun test test/useid-parity.test.tsx
 */
/// <reference types="bun-types" />

import { describe, test, expect, afterAll } from "bun:test";
import React from "react";
import { renderToString as reactRenderToString } from "react-dom/server";
import { renderToString as slimRenderToString } from "../src/slim-react/render";
import { setReactVersion, REACT_VERSION, REACT_MAJOR } from "../src/slim-react/renderContext";

const installed = React.version;
setReactVersion(parseInt(installed.split(".")[0]!, 10), installed);
afterAll(() => setReactVersion(parseInt(installed.split(".")[0]!, 10), installed));

function Id({ tag = "i" }: { tag?: string }) {
  const id = React.useId();
  return React.createElement(tag, { id }) as any;
}
function TwoIds() {
  const a = React.useId();
  const b = React.useId();
  const c = React.useId();
  return (<div><span id={a} /><span id={b} /><span id={c} /></div>) as any;
}
/** `depth` levels, each with three children, so the tree path overflows 30 bits. */
function Deep({ depth }: { depth: number }): any {
  if (depth === 0) return <Id />;
  return (<div><span /><Deep depth={depth - 1} /><span /></div>);
}
function Wide({ n }: { n: number }) {
  return (<ul>{Array.from({ length: n }, (_, i) => <li key={i}><Id /></li>)}</ul>) as any;
}

const shapes: Record<string, () => any> = {
  "sole root component": () => <Id />,
  "sole child of an element": () => <div><Id /></div>,
  "deeply nested sole child": () => <div><section><p><Id /></p></section></div>,
  "two siblings": () => <div><Id /><Id /></div>,
  "siblings in a fragment": () => <><Id /><Id /></>,
  "three useId in one component": () => <TwoIds />,
  "sole component with several ids, then a sibling": () => <div><TwoIds /><Id /></div>,
  "sibling subtree followed by sole child": () => <div><p><Id /></p><Id /></div>,
  "wide list (8)": () => <Wide n={8} />,
  "wide list (40)": () => <Wide n={40} />,
  "path overflowing 30 bits": () => <Deep depth={22} />,
  "mixed text and elements": () => <div>text<Id />more<Id /></div>,
};

describe(`slim-react useId matches react-dom/server (React ${installed})`, () => {
  for (const [name, make] of Object.entries(shapes)) {
    for (const prefix of ["", "app"]) {
      test(`${name}${prefix ? ` [identifierPrefix="${prefix}"]` : ""}`, async () => {
        const expected = reactRenderToString(make(), { identifierPrefix: prefix });
        const actual = await slimRenderToString(make(), { identifierPrefix: prefix });
        expect(actual).toBe(expected);
      });
    }
  }
});

describe("slim-react useId format per React version (independent of installed React)", () => {
  // Expected values were produced by the real react-dom/server of each version
  // for <Id /> (sole root) and <div><Id /><Id /></div> with identifierPrefix "p".
  const table: Array<[string, string, string]> = [
    ["18.3.1", ":pR0:", ":pR1:,:pR2:"],
    ["19.0.0", ":pR0:", ":pR1:,:pR2:"],
    ["19.1.0", "«pR0»", "«pR1»,«pR2»"],
    ["19.1.1", "«pR0»", "«pR1»,«pR2»"],
    ["19.2.0", "_pR_0_", "_pR_1_,_pR_2_"],
    ["19.3.1", "_pR_0_", "_pR_1_,_pR_2_"],
  ];
  for (const [version, root, sibs] of table) {
    test(`React ${version}`, async () => {
      setReactVersion(parseInt(version.split(".")[0]!, 10), version);
      try {
        const ids = (html: string) => [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids(await slimRenderToString(<Id />, { identifierPrefix: "p" }))).toEqual([root]);
        expect(ids(await slimRenderToString(<div><Id /><Id /></div>, { identifierPrefix: "p" })).join(",")).toBe(sibs);
      } finally {
        setReactVersion(parseInt(installed.split(".")[0]!, 10), installed);
      }
    });
  }

  test("the installed version is what the parity tests ran against", () => {
    expect(REACT_VERSION).toBe(installed);
    expect(REACT_MAJOR).toBe(parseInt(installed.split(".")[0]!, 10));
  });
});
