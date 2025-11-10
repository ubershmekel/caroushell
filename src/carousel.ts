import type { Suggester } from './history-suggester';
import { Terminal } from './terminal';

export class Carousel {
  private top: Suggester;
  private bottom: Suggester;
  private topRows: number;
  private bottomRows: number;
  private latest = { top: [] as string[], bottom: [] as string[] };

  constructor(opts: {
    top: Suggester;
    bottom: Suggester;
    topRows: number;
    bottomRows: number;
  }) {
    this.top = opts.top;
    this.bottom = opts.bottom;
    this.topRows = opts.topRows;
    this.bottomRows = opts.bottomRows;
  }

  async update(input: string) {
    const [top, bottom] = await Promise.all([
      this.top.suggest(input, this.topRows),
      this.bottom.suggest(input, this.bottomRows),
    ]);
    this.latest = { top, bottom };
    return this.latest;
  }

  render(term: Terminal, promptLine: string) {
    const width = process.stdout.columns || 80;
    const { brightWhite, reset, dim } = term.color;
    const lines: string[] = [];

    // Top suggestions (dim white)
    for (let i = 0; i < this.topRows; i++) {
      const text = (this.latest.top[i] || '').slice(0, width - 2);
      lines.push(`${dim}${text}${reset}`);
    }

    // Prompt line
    lines.push(`${brightWhite}${promptLine}${reset}`);

    // Bottom suggestions (dim white)
    for (let i = 0; i < this.bottomRows; i++) {
      const text = (this.latest.bottom[i] || '').slice(0, width - 2);
      lines.push(`${dim}${text}${reset}`);
    }

    term.renderBlock(lines);
  }
}

