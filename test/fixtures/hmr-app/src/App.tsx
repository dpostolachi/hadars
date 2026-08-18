import React, { useState } from 'react';

// The PROBE_ text in this file is overwritten in-place by test/hmr.e2e.test.ts
// to simulate a live edit, then restored afterward.
//
// The counter is load-bearing for the test, not decoration: a full page reload
// also makes an edit "appear", so text alone cannot distinguish true Fast
// Refresh from a reload. Component state that survives the edit can — React
// Fast Refresh patches the component in place and preserves useState, while a
// reload resets it to 0.
export default function App() {
    const [count, setCount] = useState(0);
    return (
        <div>
            <h1 id="probe">PROBE_INITIAL</h1>
            <button id="inc" onClick={() => setCount(c => c + 1)}>inc</button>
            <span id="count">{count}</span>
        </div>
    );
}
