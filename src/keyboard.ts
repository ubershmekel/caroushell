import { EventEmitter } from 'events';

type KeySpec = {
  sequence: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

// Map semantic key names to escape/control sequences
const KEY_DEFINITIONS: Record<string, KeySpec[]> = {
  // Control keys
  'ctrl-c': [{ sequence: '\u0003', ctrl: true }], // ^C
  'ctrl-d': [{ sequence: '\u0004', ctrl: true }], // ^D
  'ctrl-u': [{ sequence: '\u0015', ctrl: true }], // ^U
  tab: [{ sequence: '\t' }],
  enter: [{ sequence: '\r' }, { sequence: '\n' }],
  backspace: [{ sequence: '\u007f' }, { sequence: '\u0008' }], // DEL, BS (Windows)
  escape: [{ sequence: '\u001b' }],

  // Arrows (ANSI)
  up: [{ sequence: '\u001b[A' }],
  down: [{ sequence: '\u001b[B' }],
  right: [{ sequence: '\u001b[C' }],
  left: [{ sequence: '\u001b[D' }],
  'ctrl-right': [
    { sequence: '\u001b[1;5C', ctrl: true },
    { sequence: '\u001b[5C', ctrl: true },
    // Option/Alt-based word jumps (macOS/iTerm send meta-modified arrows or ESC+b/f)
    { sequence: '\u001b[1;3C', meta: true },
    { sequence: '\u001b[1;9C', meta: true },
    { sequence: '\u001bf', meta: true },
  ],
  'ctrl-left': [
    { sequence: '\u001b[1;5D', ctrl: true },
    { sequence: '\u001b[5D', ctrl: true },
    // Option/Alt-based word jumps (macOS/iTerm send meta-modified arrows or ESC+b/f)
    { sequence: '\u001b[1;3D', meta: true },
    { sequence: '\u001b[1;9D', meta: true },
    { sequence: '\u001bb', meta: true },
  ],

  // Home/End/Delete variants
  home: [{ sequence: '\u001b[H' }, { sequence: '\u001b[1~' }],
  end: [{ sequence: '\u001b[F' }, { sequence: '\u001b[4~' }],
  delete: [{ sequence: '\u001b[3~' }],

  // Focus in/out (sent by some terminals on focus change - swallow these)
  'focus-in': [{ sequence: '\u001b[I' }],
  'focus-out': [{ sequence: '\u001b[O' }],
};

export type KeyName = keyof typeof KEY_DEFINITIONS | "char";

export type KeyEvent = {
  name: KeyName;
  sequence: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

export const KEY_SEQUENCES: Record<string, string[]> = Object.fromEntries(
  Object.entries(KEY_DEFINITIONS).map(([name, defs]) => [
    name,
    defs.map((def) => def.sequence),
  ])
);

export function keySequence(name: keyof typeof KEY_SEQUENCES): string {
  return KEY_SEQUENCES[name][0];
}

// Map escape/control sequences to semantic key names
const KEYMAP: Record<string, Omit<KeyEvent, 'sequence'>> = {};
for (const [name, defs] of Object.entries(KEY_DEFINITIONS)) {
  for (const def of defs) {
    KEYMAP[def.sequence] = {
      name,
      ctrl: def.ctrl,
      meta: def.meta,
      shift: def.shift,
    };
  }
}

// For efficient prefix checks
const KEY_PREFIXES = new Set<string>();
for (const seq of Object.keys(KEYMAP)) {
  for (let i = 1; i <= seq.length; i++) {
    KEY_PREFIXES.add(seq.slice(0, i));
  }
}

export class Keyboard extends EventEmitter {
  private capturing = false;
  private buffer = '';
  private stdin: NodeJS.ReadStream;
  private onData = (data: string) => this.handleData(data);

  constructor(stdin: NodeJS.ReadStream = process.stdin as NodeJS.ReadStream) {
    super();
    this.stdin = stdin;
  }

  enableCapture() {
    if (this.capturing) return;
    this.stdin.setEncoding('utf8');
    if (this.stdin.isTTY) this.stdin.setRawMode(true);
    this.stdin.on('data', this.onData);
    this.stdin.resume();
    this.capturing = true;
  }

  disableCapture() {
    if (!this.capturing) return;
    this.stdin.off('data', this.onData);
    if (this.stdin.isTTY) this.stdin.setRawMode(false);
    this.stdin.pause();
    this.buffer = '';
    this.capturing = false;
  }

  private handleData(data: string) {
    this.buffer += data;
    this.processBuffer();
  }

  private processBuffer() {
    // Try to consume as many full key sequences as possible
    while (this.buffer.length > 0) {
      const evt = this.matchSequence(this.buffer);
      if (evt === 'need-more') return; // wait for more bytes
      if (evt) {
        // Swallow focus in/out sequences so they don't show up as visible chars
        if (evt.name === 'focus-in' || evt.name === 'focus-out') {
          this.buffer = this.buffer.slice(evt.sequence.length);
          continue;
        }
        this.emit('key', evt);
        this.buffer = this.buffer.slice(evt.sequence.length);
        continue;
      }
      // No mapped sequence at buffer start; emit first char as 'char'
      const ch = this.buffer[0];
      const code = ch.charCodeAt(0);
      if (code < 32 && ch !== '\t') {
        // ignore other control chars
        this.buffer = this.buffer.slice(1);
        continue;
      }
      this.emit('key', { name: 'char', sequence: ch });
      this.buffer = this.buffer.slice(1);
    }
  }

  private matchSequence(buf: string): KeyEvent | 'need-more' | null {
    // Fast path: exact match
    const exact = KEYMAP[buf];
    if (exact) return { ...exact, sequence: buf };

    // Try the longest possible mapped sequence that matches the buffer prefix
    // Limit search by checking prefixes set.
    let maxLen = 0;
    let matched: KeyEvent | null = null;
    for (const seq of Object.keys(KEYMAP)) {
      if (buf.startsWith(seq)) {
        if (seq.length > maxLen) {
          maxLen = seq.length;
          matched = { ...KEYMAP[seq], sequence: seq };
        }
      }
    }
    if (matched) return matched;

    // If current buffer is a prefix to any known sequence, wait for more
    if (KEY_PREFIXES.has(buf)) return 'need-more';

    // No sequence match
    return null;
  }
}
