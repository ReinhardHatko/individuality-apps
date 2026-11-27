// Copyright 2026 Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { coverDrag } from '../previewnet-poc/after-game.ts';

describe("the drag that closes the collectables' book", () => {
  // The book as a phone showed it (Paseo game 376, 27 November 2026): its right page at 206,652, 171 wide, on a 412 x 820 page.
  const book = { left: 206, top: 652.16, width: 171 }, screen = { width: 412, height: 820 };

  it('takes the open cover left of the spine and lets go past the right page, inside the screen', () => {
    const { from, to, y } = coverDrag(book, screen);
    expect(from).toBeGreaterThan(book.left - book.width);
    expect(from).toBeLessThan(book.left);
    // Jollity shuts the cover by itself from 0.7 closed: the finger is past the spine by more than cos(0.7 π) of a page.
    expect(to - book.left).toBeGreaterThan(0.59 * book.width);
    expect(to).toBeLessThanOrEqual(screen.width - 4);
    expect(y).toBeGreaterThan(book.top);
    expect(y).toBeLessThanOrEqual(screen.height - 24);
  });

  it('stays on a narrow screen', () => {
    const { from, to } = coverDrag({ left: 160, top: 500, width: 171 }, { width: 320, height: 640 });
    expect(from).toBeGreaterThanOrEqual(4);
    expect(to).toBe(316);
  });
});
