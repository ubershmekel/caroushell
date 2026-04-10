# Caroushell Design Map

This is a quick index of the authored code files in this repo. Generated output
in `dist/` and dependencies in `node_modules/` are intentionally omitted.

## Runtime code

- [../src/main.ts](../src/main.ts): CLI entrypoint that handles version output,
  onboarding, config loading, and app startup.
- [../src/app.ts](../src/app.ts): Main controller that wires keyboard input,
  carousel rendering, suggesters, and command execution together.
- [../src/carousel.ts](../src/carousel.ts): Core prompt/suggestions state
  machine plus rendering helpers for the top, prompt, and bottom rows.
- [../src/terminal.ts](../src/terminal.ts): Low-level terminal painter that
  redraws screen blocks, moves the cursor, and hides flicker.
- [../src/keyboard.ts](../src/keyboard.ts): Raw key capture layer that
  translates terminal escape sequences into semantic key events.
- [../src/spawner.ts](../src/spawner.ts): Runs shell commands and implements
  built-ins like `cd`, `pushd`, `popd`, and Windows drive switching.
- [../src/history-suggester.ts](../src/history-suggester.ts): Stores shell
  history on disk and turns recent matching commands into top-panel suggestions.
- [../src/file-suggester.ts](../src/file-suggester.ts): Lists directory entries
  and offers file/path completions near the cursor.
- [../src/ai-suggester.ts](../src/ai-suggester.ts): Calls an OpenAI-compatible
  chat endpoint to generate debounced AI command suggestions.
- [../src/config.ts](../src/config.ts): Resolves config paths, reads TOML
  config, and merges file settings with environment overrides.
- [../src/hello-new-user.ts](../src/hello-new-user.ts): Interactive first-run
  flow that writes prompt and AI settings into the local config file.
- [../src/prompt.ts](../src/prompt.ts): Expands prompt template tokens like
  hostname, user, and directory into the visible prompt prefix.
- [../src/logs.ts](../src/logs.ts): Appends timestamped log lines under
  `~/.caroushell/logs` for background diagnostics.
- [../src/test-generate.ts](../src/test-generate.ts): Small manual script for
  listing configured models and testing a single AI generation call.

## Tooling and release code

- [../scripts/release.ts](../scripts/release.ts): Release helper that enforces a
  clean git tree, runs checks, bumps the version, builds, and pushes tags.
- [../package.json](../package.json): Package manifest that defines the CLI
  binary, npm scripts, and project dependencies.
- [../tsconfig.json](../tsconfig.json): Base TypeScript configuration used for
  development, tests, and typechecking.
- [../tsconfig.release.json](../tsconfig.release.json): Release build TypeScript
  config that emits compiled `src/` output into `dist/`.
- [../eslint.config.js](../eslint.config.js): ESLint setup for the TypeScript
  source, scripts, and tests with promise-safety rules enabled.

## Tests

- [../tests/app.test.ts](../tests/app.test.ts): Integration-style tests for
  prompt redraws, multiline input behavior, and row navigation in the app shell.
- [../tests/carousel.test.ts](../tests/carousel.test.ts): Verifies display-width
  calculation for ANSI text, emoji, combining marks, and full-width characters.
- [../tests/config.test.ts](../tests/config.test.ts): Tests prompt-template
  expansion behavior despite the filename suggesting broader config coverage.
- [../tests/hello-new-user.test.ts](../tests/hello-new-user.test.ts): Covers
  onboarding flows for skipped AI setup and persisted prompt/API settings.
- [../tests/history-suggester.test.ts](../tests/history-suggester.test.ts):
  Checks that history parsing and AI-facing summaries keep newest commands
  first.
- [../tests/spawner.test.ts](../tests/spawner.test.ts): Exercises shell
  built-ins, directory stack behavior, drive switching, and SIGINT handling in
  command execution.
- [../tests/terminal.test.ts](../tests/terminal.test.ts): Verifies terminal
  repaint behavior and prompt color formatting during rendering.
