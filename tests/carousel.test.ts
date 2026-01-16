import assert from "node:assert/strict";
import { test } from "node:test";

import { getDisplayWidth } from "../src/carousel";

void test("getDisplayWidth handles ansi, emoji, combining, and full width", () => {
  assert.equal(getDisplayWidth("abc"), 3);
  assert.equal(getDisplayWidth("\u001b[31mred\u001b[0m"), 3);
  assert.equal(getDisplayWidth("e\u0301"), 1);
  assert.equal(getDisplayWidth("界"), 2);
  assert.equal(getDisplayWidth("🙂"), 2);
});
