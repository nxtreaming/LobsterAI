import { expect, test } from 'vitest';

import { resolveHoverCardTop } from './ModelSelector';

test('keeps model hover card above the viewport bottom', () => {
  expect(resolveHoverCardTop(790, 260, 900)).toBe(632);
});

test('keeps model hover card below the viewport top margin', () => {
  expect(resolveHoverCardTop(-20, 120, 900)).toBe(8);
});

test('does not move a fully visible model hover card', () => {
  expect(resolveHoverCardTop(240, 180, 900)).toBe(240);
});

test('pins model hover card to the margin when it is taller than the viewport', () => {
  expect(resolveHoverCardTop(160, 1000, 900)).toBe(8);
});
