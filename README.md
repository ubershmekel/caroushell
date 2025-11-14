# Caroushell

Caroushell is an interactive terminal carousel that suggests commands from your
history, AI prompts, and configuration snippets so you can pick the next shell
command without leaving the keyboard.

## Features

- Dual-pane carousel that combines history-based and AI-generated command
  suggestions.
- Runs the selected command directly in your current terminal session.
- Logs activity under `~/.caroushell/logs` for easy troubleshooting.
- Extensible config file (`~/.caroushell/config.json`) so you can point the CLI
  at different API keys or settings.

## Requirements

- Node.js 18 or newer.
- A `~/.caroushell/config.json` file that contains the tokens Caroushell needs.
  Currently the file expects a Gemini API key:

```json
{
  "GEMINI_API_KEY": "your-api-key"
}
```

## Installation

Install globally (recommended):

```bash
npm install -g caroushell
caroushell
```

Or run it ad-hoc with NPX once it is published:

```bash
npx caroushell
```

## Usage

Caroushell opens an interactive prompt:

- Type to update the suggestions immediately and trigger refreshed history/AI
  results.
- Use arrow keys to move between suggestions in the carousel.
- Press `Enter` to run the highlighted command.
- Press `Ctrl+C` to exit. `Ctrl+D` exits when the current row is empty.

Logs are written to `~/.caroushell/logs/MM-DD.txt`. Inspect these files if you
need to debug AI suggestions or the terminal renderer. Configuration lives at
`~/.caroushell/config.json` (override via `CAROUSHELL_CONFIG_PATH`).

## Development

```bash
npm install
npm run dev        # tsx watch mode
npm run build      # emits dist/
npm run test:generate
npm publish --dry-run  # verify package contents before publishing
```

The `prepare` script automatically builds before `npm publish` or when
installing from git. The package ships only the compiled `dist/` output plus
this README and the MIT license so `npx caroushell` works immediately.

## License

Released under the [MIT License](./LICENSE).
