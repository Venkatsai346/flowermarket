/** Slug helpers — deterministic URL-safe slugs with uniqueness enforcement. */
import { conflict } from './ApiError.js';

export function slugify(input, { max = 90 } = {}) {
  const base = String(input || '')
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'item').slice(0, max);
}

/**
 * Generate a unique slug for a model: appends -2, -3... until free.
 * @param {import('mongoose').Model} Model
 * @param {string} base
 * @param {object} filter extra filter (e.g. tenantId)
 */
export async function uniqueSlug(Model, base, filter = {}) {
  const slug = slugify(base);
  let candidate = slug;
  let i = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await Model.exists({ ...filter, slug: candidate })) {
    candidate = `${slug}-${i}`;
    i += 1;
  }
  return candidate;
}

/** Ensure an explicit slug is free, else 409. Returns the slug when free. */
export async function assertSlugFree(Model, slug, filter = {}, excludeId = null) {
  const q = { ...filter, slug };
  if (excludeId) q._id = { $ne: excludeId };
  if (await Model.exists(q)) {
    throw conflict(`Slug "${slug}" is already in use`, 'SLUG_TAKEN');
  }
  return slug;
}

export default slugify;
