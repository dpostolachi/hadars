import React from "react";
import { Link } from "react-router-dom";
import RemixIcon from "./components/RemixIcon";

export default function DemoLibrary() {
  return (
    <div className="demo-library-grid">
      <Link to="/cache-test">
        <RemixIcon name="time-line" />
        <h3>Response caching</h3>
        <p>Repeat a request and compare the server’s render IDs.</p>
        <span>Open cache inspector</span>
      </Link>
      <Link to="/data-demo">
        <RemixIcon name="database-2-line" />
        <h3>Server data batching</h3>
        <p>Inspect one response shared by four independent components.</p>
        <span>Open data playground</span>
      </Link>
      <Link to="/i18n-demo">
        <RemixIcon name="global-line" />
        <h3>Languages &amp; formatting</h3>
        <p>Switch a sample storefront between English and Romanian.</p>
        <span>Open language preview</span>
      </Link>
    </div>
  );
}
