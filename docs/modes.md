# Terminal modes

Terminal modes are state in the terminal emulator. Programs change them by
writing escape sequences to stdout. That state can outlive a program, so
Caroushell establishes its prompt modes at startup and after each command.

## What `Terminal.reset()` does

`src/terminal.ts` restores the modes expected by Caroushell's keyboard parser:

| Sequence     | Mode                            | Prompt behavior                                      |
| ------------ | ------------------------------- | ---------------------------------------------------- |
| `ESC[?1l`    | Normal cursor keys (DECCKM off) | Arrows send `ESC[A`, `ESC[B`, `ESC[C`, and `ESC[D`.  |
| `ESC[?2004h` | Bracketed paste on              | Pasted text is wrapped in `ESC[200~` and `ESC[201~`. |

Here `ESC` means the escape byte (`\x1b` in TypeScript strings). The final `h`
enables a private mode; `l` disables it.

Applications such as editors may enable application cursor keys, which use
sequences such as `ESCOA`. Restoring normal cursor keys prevents leftover mode
state from making arrows insert fragments like `OA` into the prompt.

`reset()` restores prompt settings. It does not invoke the shell's `reset`
command, clear the screen, reset colors, or reset every terminal mode.
Separately, `printPermanent()` leaves its lines in the scrollback so the next
`printTemporary()` starts below them instead of redrawing over them.

## Why bracketed paste is enabled

`Keyboard` consumes the paste markers and emits the entire payload as one text
insertion. Pasted newlines stay in the input for review until the user presses
Enter, and pasted tabs do not trigger completion. CRLF and CR line endings are
normalized to LF. Suggestions and rendering update once per completed paste.

Markers can arrive across multiple input chunks, including one byte at a time.
The parser retains incomplete sequences and paste content until the end marker
arrives. Disabling keyboard capture discards unfinished input and paste state.

Without marker handling, inherited bracketed-paste mode can cause literal
`[200~` and `[201~` fragments to appear in commands. Disabling the mode hides
that symptom but loses the distinction between pasted newlines and Enter
presses. Caroushell instead enables the mode deliberately and understands the
protocol. Terminals that do not support it continue to send ordinary input and
cannot provide the same distinction between typing and pasting.

## Ownership and cleanup

1. At startup, `App.run()` installs the key handler, enables keyboard capture,
   and calls `Terminal.reset()` before displaying the prompt.
2. Before a nonempty command, `Terminal.release()` sends `ESC[?2004l` to disable
   bracketed paste. Keyboard capture and prompt writes are then disabled so the
   command can manage its own terminal state.
3. In the command's `finally` block, prompt writes and keyboard capture resume,
   and `reset()` restores normal cursor keys and enables bracketed paste again.
   This also runs if command execution or its hooks fail.
4. `App.end()` releases paste mode and keyboard capture and removes its process
   exit listener. Normal prompt exits and process exit cleanup use this path;
   startup failures after capture begins also clean up before propagating.

The exit listener does not write through the terminal while command output owns
it, because terminal writes are disabled during command execution. Termination
that does not run cleanup can still leave modes behind. Reopening the terminal
or running the shell's `reset` command remains a recovery option.

Raw input mode is separate: `Keyboard.enableCapture()` and `disableCapture()`
manage it through Node's `setRawMode()` on TTY input. It is not controlled by
the escape sequences in `Terminal.reset()`.

Protocol reference:
[XTerm control sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html).
