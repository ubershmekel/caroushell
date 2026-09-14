import assert from "node:assert/strict";
import { test } from "node:test";
import { CaroushellMenu, MenuOptions } from "../src/menu";
import { colors } from "../src/terminal";

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

function makeMenu(opts: Partial<MenuOptions> = {}) {
  const events: unknown[] = [];
  const menu = new CaroushellMenu({
    selected: { top: "history", bottom: "off" },
    onSelect: (panel, key) => events.push({ panel, key }),
    onClose: () => events.push("close"),
    ...opts,
  });
  const key = (name: string) => menu.handleKey({ name, sequence: "" });
  return { menu, key, events };
}

void test("menu reports the chosen suggester key for a panel", () => {
  const { menu, key, events } = makeMenu();
  key("down");
  key("enter");
  assert.match(menu.lines().join("\n"), /Off.*✓ current/);
  key("down"); // Off wraps to History.
  key("enter");
  assert.deepEqual(events, [{ panel: "bottom", key: "history" }]);
});

void test("menu lists disabled choices with their reason but won't select them", () => {
  const { menu, key, events } = makeMenu({
    disabled: { ai: "not configured" },
  });
  key("enter");
  assert.match(
    menu.lines().join("\n").replace(ANSI_ESCAPE_REGEX, ""),
    /AI {2}not configured/,
  );
  key("up"); // History wraps to Off.
  key("up"); // AI
  key("enter");
  assert.deepEqual(events, []);
  key("up"); // Folders
  key("enter");
  assert.deepEqual(events, [{ panel: "top", key: "folders" }]);
});

void test("menu has branded color, isolates typing, and supports back and hotkey close", () => {
  const { menu, key, events } = makeMenu();
  const initial = menu.lines();
  assert.ok(initial[0].includes("🎠 Caroushell"));
  assert.ok(initial[0].includes(colors.purple));
  const styles = initial.join("\n").match(ANSI_ESCAPE_REGEX) ?? [];
  assert.ok(
    styles.every((style) => [colors.purple, colors.reset].includes(style)),
  );
  assert.ok(initial.some((line) => line.includes("❯")));
  key("char");
  key("tab");
  assert.deepEqual(menu.lines(), initial);
  key("enter");
  key("escape");
  assert.deepEqual(menu.lines(), initial);
  assert.deepEqual(events, []);
  key("alt-m");
  assert.deepEqual(events, ["close"]);
});
