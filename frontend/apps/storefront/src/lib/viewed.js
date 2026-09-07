const key = () => `fm-viewed:${typeof window !== 'undefined' ? window.location.hostname : 'server'}`;

export function readViewed() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordViewed(entry) {
  if (typeof window === 'undefined' || !entry?.slug) return;
  const next = [
    { slug: entry.slug, title: entry.title, imageUrl: entry.imageUrl || null, at: Date.now() },
    ...readViewed().filter((x) => x.slug !== entry.slug),
  ].slice(0, 8);
  window.localStorage.setItem(key(), JSON.stringify(next));
}

export default { readViewed, recordViewed };
