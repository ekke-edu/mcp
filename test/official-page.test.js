import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHtml, extractLocations, parsePage } from "../dist/official-page.js";

test("decodes named and numeric HTML entities", () => {
  assert.equal(decodeHtml("&nbsp;&#160;&amp;&quot;&#39;&lt;&#62;&#x1F642;"), "  &\"'<>🙂");
});

test("extracts readable page text and excludes non-content elements", () => {
  const page = parsePage("https://uni-eszterhazy.hu/study", `
    <html>
      <head><title>Tanulmányi &amp; információ</title><style>.hidden { display:none }</style></head>
      <body>
        <h1>Vizsgaidőszak</h1>
        <script>const secret = "not content";</script>
        <noscript>Enable JavaScript</noscript>
        <svg><text>icon label</text></svg>
        <!-- internal comment -->
        <p>A vizsgák &#233;rvényes dátumai.</p>
      </body>
    </html>
  `);

  assert.equal(page.title, "Tanulmányi & információ");
  assert.equal(page.text, "Vizsgaidőszak A vizsgák érvényes dátumai.");
});

test("uses the URL path when a page has no title", () => {
  assert.deepEqual(parsePage("https://uni-eszterhazy.hu/calendar", "<p>Tanítási rend</p>"), {
    title: "/calendar",
    text: "Tanítási rend",
  });
});

test("extracts and decodes sitemap locations", () => {
  assert.deepEqual(extractLocations("<url><loc>https://uni-eszterhazy.hu/a?x=1&amp;y=2</loc></url>"), [
    "https://uni-eszterhazy.hu/a?x=1&y=2",
  ]);
});
