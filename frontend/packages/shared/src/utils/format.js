/**
 * Status → { label, tone } maps + small string helpers.
 * Tone is a Tailwind palette name consumed by the <Badge> component.
 *
 * The vocabulary lives in `./status.js` so web and mobile share one source.
 * This module re-exports it for backwards compatibility and adds the tiny
 * pure helpers below.
 */
export * from './status.js';

export const titleCase = (s) =>
  String(s || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export const pickMeta = (map, value) => map[value] || { label: titleCase(value), tone: 'slate' };
