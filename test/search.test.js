import assert from "node:assert/strict";
import { test } from "node:test";
import { expandQuery, makeSnippet, normalize, safeOfficialUrl, scoreText } from "../dist/search.js";

test("normalizes Hungarian accented characters", () => {
  assert.equal(normalize("Vizsgaidőszak"), "vizsgaidoszak");
});

test("expands Hungarian academic terms to English", () => {
  const terms = expandQuery("vizsgaidőszak");
  assert.ok(terms.includes("exam period"));
});

test("expands English academic terms to Hungarian", () => {
  const terms = expandQuery("course registration");
  assert.ok(terms.includes("targybovites"));
  assert.ok(terms.includes("targyfelvetel"));
});

test("ranks Hungarian content for an English query", () => {
  const score = scoreText(expandQuery("exam period"), "Vizsgaidőszak", "A vizsgaidőszak dátumai");
  assert.ok(score > 0);
});

test("creates a useful source excerpt", () => {
  const snippet = makeSnippet(["targybovites"], "x".repeat(200) + "A tárgybővítés határideje péntek.", 160);
  assert.match(normalize(snippet), /targybovites/);
});

test("only accepts HTTPS URLs under configured official domains", () => {
  assert.equal(safeOfficialUrl("https://io.uni-eszterhazy.hu/course", ["uni-eszterhazy.hu"]), true);
  assert.equal(safeOfficialUrl("http://uni-eszterhazy.hu/course", ["uni-eszterhazy.hu"]), false);
  assert.equal(safeOfficialUrl("https://uni-eszterhazy.hu.attacker.test/", ["uni-eszterhazy.hu"]), false);
});