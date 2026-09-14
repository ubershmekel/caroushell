import type { KeyEvent } from "./keyboard";
import { colors } from "./terminal";

export type Panel = "top" | "bottom";
export type SuggesterKey = "history" | "files" | "folders" | "ai" | "off";

/** Panel choices, in menu order. */
const SUGGESTER_LABELS: Record<SuggesterKey, string> = {
  history: "History",
  files: "Files",
  folders: "Folders",
  ai: "AI",
  off: "Off",
};
const SUGGESTER_KEYS = Object.keys(SUGGESTER_LABELS) as SuggesterKey[];
const PANELS: Panel[] = ["top", "bottom"];
const PANEL_LABELS: Record<Panel, string> = {
  top: "Top panel",
  bottom: "Bottom panel",
};

export type MenuOptions = {
  selected: Record<Panel, SuggesterKey>;
  /** Choices that are listed with this reason but can't be selected. */
  disabled?: Partial<Record<SuggesterKey, string>>;
  version?: string;
  onSelect(panel: Panel, key: SuggesterKey): void;
  onClose(): void;
};

/** Menu navigation and presentation; the app applies selections and owns the shell. */
export class CaroushellMenu {
  private page: "main" | Panel = "main";
  /** Cursor on the main page; kept while a panel page is open so Esc returns to it. */
  private mainIndex = 0;
  /** Cursor on a panel page, an index into SUGGESTER_KEYS. */
  private choiceIndex = 0;

  constructor(private opts: MenuOptions) {}

  handleKey({ name }: KeyEvent) {
    if (name === "up" || name === "down") {
      const step = name === "up" ? -1 : 1;
      if (this.page === "main") {
        this.mainIndex = wrap(this.mainIndex + step, PANELS.length);
      } else {
        this.choiceIndex = wrap(this.choiceIndex + step, SUGGESTER_KEYS.length);
      }
    } else if (name === "escape" && this.page !== "main") {
      this.page = "main";
    } else if (["escape", "ctrl-c", "alt-m"].includes(name)) {
      this.opts.onClose();
    } else if (name === "enter") {
      if (this.page === "main") {
        this.page = PANELS[this.mainIndex];
        this.choiceIndex = SUGGESTER_KEYS.indexOf(
          this.opts.selected[this.page],
        );
        return;
      }
      const key = SUGGESTER_KEYS[this.choiceIndex];
      if (!this.opts.disabled?.[key]) this.opts.onSelect(this.page, key);
    }
  }

  lines(): string[] {
    const { purple, dimmest, reset } = colors;
    const { selected, disabled, version } = this.opts;
    const versionText = version ? ` ${dimmest}v${version}${reset}` : "";
    const page = this.page;
    const title = page === "main" ? "Menu" : PANEL_LABELS[page];
    const entries =
      page === "main"
        ? PANELS.map((panel) => ({
            label: PANEL_LABELS[panel],
            detail: SUGGESTER_LABELS[selected[panel]],
          }))
        : SUGGESTER_KEYS.map((key) => ({
            label: SUGGESTER_LABELS[key],
            detail:
              key === selected[page] ? "✓ current" : (disabled?.[key] ?? ""),
          }));
    const activeIndex = page === "main" ? this.mainIndex : this.choiceIndex;
    return [
      ` ${purple}🎠 Caroushell${reset}${versionText}  ${reset}/ ${title}${reset}`,
      "",
      ...entries.map(({ label, detail }, index) => {
        const active = index === activeIndex;
        return ` ${active ? purple + "❯" : " "} ${reset}${label}${reset}${detail ? `  ${reset}${detail}${reset}` : ""}`;
      }),
      "",
      ` ${purple}↑↓${reset} ${reset}Choose${reset}   ${purple}Enter${reset} ${reset}Select${reset}   ${purple}Esc${reset} ${reset}${page === "main" ? "Close" : "Back"}${reset}`,
      ` ${reset}Changes apply to this session${reset}`,
    ];
  }
}

function wrap(index: number, count: number): number {
  return (index + count) % count;
}
