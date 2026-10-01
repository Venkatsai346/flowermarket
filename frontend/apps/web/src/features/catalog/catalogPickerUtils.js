import { rid } from '../../lib/utils.js';

export function catalogId(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(rid(value) || '');
  return String(value);
}

/** Converts a flat category registry into a stable, depth-first taxonomy view. */
export function buildCategoryTree(categories = []) {
  const byId = new Map();
  for (const category of categories) {
    const id = catalogId(category);
    if (id) byId.set(id, { ...category, id, children: [] });
  }

  const roots = [];
  for (const category of byId.values()) {
    const parentId = catalogId(category.parentId);
    if (parentId && byId.has(parentId) && parentId !== category.id) byId.get(parentId).children.push(category);
    else roots.push(category);
  }

  const sort = (rows) => rows.sort((left, right) =>
    (left.sortOrder || 0) - (right.sortOrder || 0) || left.name.localeCompare(right.name));
  const flat = [];
  const visit = (row, depth, ancestors) => {
    sort(row.children);
    const path = [...ancestors, row.name];
    flat.push({ ...row, depth, path: path.join(' / '), isLeaf: row.children.length === 0 });
    for (const child of row.children) visit(child, depth + 1, path);
  };
  for (const root of sort(roots)) visit(root, 0, []);
  return flat;
}

export function filterCategoryTree(categories, query = '') {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return categories
    .filter((item) => {
      const haystack = `${item.name} ${item.path} ${item.slug || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map((item) => ({ ...item, disabled: !item.isLeaf }));
}

/** Keeps a selected label stable even when it is outside the current server page. */
export function resolveSelectedBrand({ value, remote, loaded = [], selectedLocal, selectedBrand }) {
  const currentPage = remote || loaded;
  return currentPage.find((brand) => catalogId(brand) === value)
    || (selectedLocal && catalogId(selectedLocal) === value ? selectedLocal : null)
    || (selectedBrand && catalogId(selectedBrand) === value ? selectedBrand : null);
}
