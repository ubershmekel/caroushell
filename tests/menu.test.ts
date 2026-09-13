import assert from "node:assert/strict";
import { test } from "node:test";
import { CaroushellMenu } from "../src/menu";
import { colors } from "../src/terminal";

const sources = [
  { label: "History", value: "history" },
  { label: "Off", value: "off" },
];

void test("menu returns panel actions without changing the supplied layout", () => {
  const layout = { top: "history", bottom: "off" };
  const menu = new CaroushellMenu(sources, layout);
  const key = (name: string) => menu.handleKey({ name, sequence: "" });
  assert.equal(key("down"), null);
  assert.equal(key("enter"), null);
  assert.match(menu.lines().join("\n"), /✓ current/);
  key("down");
  assert.deepEqual(key("enter"), {
    action: "select",
    panel: "bottom",
    value: "history",
  });
  assert.deepEqual(layout, { top: "history", bottom: "off" });
});

void test("menu has branded color, isolates typing, and supports back and hotkey close", () => {
  const menu = new CaroushellMenu(sources, { top: "history", bottom: "off" });
  const key = (name: string) => menu.handleKey({ name, sequence: "" });
  const initial = menu.lines();
  assert.ok(initial[0].includes("🎠 Caroushell"));
  assert.ok(initial[0].includes(colors.purple));
  const styles = initial.join("\n").match(/\x1b\[[0-9;]*m/g) ?? [];
  assert.ok(
    styles.every((style) => [colors.purple, colors.reset].includes(style)),
  );
  assert.ok(initial.some((line) => line.includes("❯")));
  key("char");
  key("tab");
  assert.deepEqual(menu.lines(), initial);
  key("enter");
  assert.equal(key("escape"), null);
  assert.deepEqual(menu.lines(), initial);
  assert.deepEqual(key("alt-m"), { action: "close" });
});
