import { EventEmitter } from 'events';

export type KeyEvent = {
  name: string;
  sequence: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

// Map escape/control sequences to semantic key names
const KEYMAP: Record<string, Omit<KeyEvent, 'sequence'>> = {
  // Control keys
  '\u0003': { name: 'ctrl-c', ctrl: true }, // ^C
  '\u0004': { name: 'ctrl-d', ctrl: true }, // ^D
  '\r': { name: 'enter' },
  '\n': { name: 'enter' },
  '\u007f': { name: 'backspace' }, // DEL
  '\u0008': { name: 'backspace' }, // BS (Windows)
  '\u001b': { name: 'escape' },

  // Arrows (ANSI)
  '\u001b[A': { name: 'up' },
  '\u001b[B': { name: 'down' },
  '\u001b[C': { name: 'right' },
  '\u001b[D': { name: 'left' },

  // Home/End/Delete variants
  '\u001b[H': { name: 'home' },
  '\u001b[F': { name: 'end' },
  '\u001b[1~': { name: 'home' },
  '\u001b[4~': { name: 'end' },
  '\u001b[3~': { name: 'delete' },
};

// For efficient prefix checks
const KEY_PREFIXES = new Set<string>();
for (const seq of Object.keys(KEYMAP)) {
  for (let i = 1; i <= seq.length; i++) {
    KEY_PREFIXES.add(seq.slice(0, i));
  }
}

export class Keyboard extends EventEmitter {
  private active = false;
  private buffer = '';

  start() {
    if (this.active) return;
    this.active = true;
    const stdin = process.stdin as any;
    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const onData = (data: string) => this.handleData(data);
    stdin.on('data', onData);
    this.once('stop', () => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
    });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.emit('stop');
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
