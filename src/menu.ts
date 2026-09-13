import type { KeyEvent } from "./keyboard";
import { colors } from "./terminal";

export type Panel = "top" | "bottom";
export type MenuSource<T> = { label: string; value: T };
export type MenuResult<T> =
  | { action: "close" }
  | { action: "select"; panel: Panel; value: T }
  | null;

/** Menu navigation and presentation; the app applies selections and owns the shell. */
export class CaroushellMenu<T> {
  private page: "main" | Panel = "main";
  private index = 0;

  constructor(
    private sources: MenuSource<T>[],
    private selected: Record<Panel, T>,
  ) {}

  private label(panel: Panel): string {
    return (
      this.sources.find(({ value }) => value === this.selected[panel])?.label ??
      "Off"
    );
  }

  handleKey({ name }: KeyEvent): MenuResult<T> {
    const count = this.page === "main" ? 2 : this.sources.length;
    if (name === "up" || name === "down") {
      this.index = (this.index + (name === "up" ? -1 : 1) + count) % count;
    } else if (name === "escape" && this.page !== "main") {
      this.index = this.page === "top" ? 0 : 1;
      this.page = "main";
    } else if (["escape", "ctrl-c", "alt-m"].includes(name)) {
      return { action: "close" };
    } else if (name === "enter") {
      if (this.page !== "main") {
        return {
          action: "select",
          panel: this.page,
          value: this.sources[this.index].value,
        };
      }
      const panel = this.index === 0 ? "top" : "bottom";
      this.page = panel;
      this.index = Math.max(
        0,
        this.sources.findIndex(({ label }) => label === this.label(panel)),
      );
    }
    return null;
  }

  lines(): string[] {
    const { purple, reset } = colors;
    const title =
      this.page === "main"
        ? "Menu"
        : `${this.page === "top" ? "Top" : "Bottom"} panel`;
    const page = this.page;
    const entries =
      this.page === "main"
        ? [
            { label: "Top panel", detail: this.label("top") },
            { label: "Bottom panel", detail: this.label("bottom") },
          ]
        : this.sources.map(({ label }) => ({
            label,
            detail:
              page !== "main" && label === this.label(page) ? "✓ current" : "",
          }));
    return [
      ` ${purple}🎠 Caroushell${reset}  ${reset}/ ${title}${reset}`,
      "",
      ...entries.map(({ label, detail }, index) => {
        const active = index === this.index;
        return ` ${active ? purple + "❯" : " "} ${reset}${label}${reset}${detail ? `  ${reset}${detail}${reset}` : ""}`;
      }),
      "",
      ` ${purple}↑↓${reset} ${reset}Choose${reset}   ${purple}Enter${reset} ${reset}Select${reset}   ${purple}Esc${reset} ${reset}${this.page === "main" ? "Close" : "Back"}${reset}`,
      ` ${reset}Changes apply to this session${reset}`,
    ];
  }
}
