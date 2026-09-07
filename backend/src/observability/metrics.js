/**
 * Minimal, dependency-free Prometheus metrics registry.
 *
 * Produces the Prometheus text exposition format (version 0.0.4) — counters,
 * gauges and histograms with labelled series, proper label-value escaping,
 * canonically sorted label names, and monotonic histogram buckets. Kept
 * intentionally small (this app is hand-rolled end to end) but exact:
 *
 *   - `# HELP` / `# TYPE` precede every family
 *   - label names sorted alphabetically (canonical form); values escaped
 *     (`\` → `\\`, `"` → `\"`, newline → `\n`)
 *   - histogram: `*_bucket{…,le=…}` (monotonic, +Inf last), `*_sum`, `*_count`
 *   - non-finite gauge values are dropped (never emit NaN/Inf for gauges)
 *
 * In-memory only: process-scoped (counters/histograms) plus dynamic gauges
 * re-computed on each scrape (see observability/registry.js). A process
 * restart resets counters — standard for in-process metrics.
 */

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Escape a label value per the Prometheus text-format spec. */
export function escapeLabelValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Render `{a="1",b="2"}` (sorted names) from a name→value pair map, or ''. */
function renderLabels(pairs) {
  const names = Object.keys(pairs).sort();
  if (!names.length) return '';
  const inner = names.map((n) => `${n}="${escapeLabelValue(pairs[n])}"`).join(',');
  return `{${inner}}`;
}

/** Canonical label key for a metric's declared label names (for the series map). */
function seriesKey(labelNames, labels) {
  const pairs = {};
  for (const n of labelNames) pairs[n] = labels?.[n] ?? '';
  return Object.keys(pairs).sort().map((n) => `${n}=${String(pairs[n])}`).join('|');
}

class Metric {
  constructor(name, help, type, labelNames = []) {
    this.name = name;
    this.help = String(help).replace(/\n/g, ' ');
    this.type = type;
    this.labelNames = labelNames;
    this.series = new Map(); // seriesKey -> value (or histogram state)
    this.seriesLabels = new Map(); // seriesKey -> original labels object
  }
  reset() {
    this.series.clear();
    this.seriesLabels.clear();
  }
  _labels(k) {
    return this.seriesLabels.get(k) || {};
  }
}

/**
 * Unpack the (labels, value) argument pair. No-label metrics accept the
 * shorthand `metric(5)` / `metric.inc(5)` — a bare first number is the value.
 */
function unpack(labelNames, labels, value) {
  if (labelNames.length === 0 && typeof labels === 'number' && value === undefined) {
    return [{}, labels];
  }
  return [labels || {}, value];
}

export class Counter extends Metric {
  inc(labels = {}, value = 1) {
    const [ls, v] = unpack(this.labelNames, labels, value);
    if (!Number.isFinite(v) || v < 0) return;
    const k = seriesKey(this.labelNames, ls);
    this.seriesLabels.set(k, ls);
    this.series.set(k, (this.series.get(k) || 0) + v);
  }
  value(labels = {}) {
    return this.series.get(seriesKey(this.labelNames, labels)) || 0;
  }
}

export class Gauge extends Metric {
  set(labels = {}, value) {
    const [ls, v] = unpack(this.labelNames, labels, value);
    if (!Number.isFinite(v)) return;
    const k = seriesKey(this.labelNames, ls);
    this.seriesLabels.set(k, ls);
    this.series.set(k, v);
  }
  inc(labels = {}, value = 1) {
    const [ls, v] = unpack(this.labelNames, labels, value);
    const k = seriesKey(this.labelNames, ls);
    this.seriesLabels.set(k, ls);
    this.series.set(k, (this.series.get(k) || 0) + v);
  }
  dec(labels = {}, value = 1) {
    this.inc(labels, -value);
  }
  value(labels = {}) {
    return this.series.get(seriesKey(this.labelNames, labels)) || 0;
  }
}

export class Histogram extends Metric {
  constructor(name, help, type, labelNames = [], buckets = DEFAULT_BUCKETS) {
    super(name, help, type, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(labels = {}, value) {
    const [ls, v] = unpack(this.labelNames, labels, value);
    if (!Number.isFinite(v)) return;
    const k = seriesKey(this.labelNames, ls);
    this.seriesLabels.set(k, ls);
    let h = this.series.get(k);
    if (!h) {
      h = { counts: this.buckets.map(() => 0), sum: 0, n: 0 };
      this.series.set(k, h);
    }
    h.n += 1;
    h.sum += v;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (v <= this.buckets[i]) h.counts[i] += 1;
    }
  }
  value(labels = {}) {
    return this.series.get(seriesKey(this.labelNames, labels)) || null;
  }
}

export class Registry {
  constructor(prefix = 'fm') {
    this.prefix = prefix;
    this.metrics = new Map();
    this.order = [];
  }

  counter(name, help, labelNames = []) {
    return this._get('counter', name, help, labelNames);
  }

  gauge(name, help, labelNames = []) {
    return this._get('gauge', name, help, labelNames);
  }

  histogram(name, help, labelNames = [], buckets = DEFAULT_BUCKETS) {
    return this._get('histogram', name, help, labelNames, buckets);
  }

  _get(kind, name, help, labelNames, buckets) {
    const full = `${this.prefix}_${name}`;
    if (!this.metrics.has(full)) {
      const m =
        kind === 'counter' ? new Counter(full, help, kind, labelNames)
        : kind === 'gauge' ? new Gauge(full, help, kind, labelNames)
        : new Histogram(full, help, kind, labelNames, buckets);
      this.metrics.set(full, m);
      this.order.push(full);
    }
    return this.metrics.get(full);
  }

  /** Render the current state as Prometheus text exposition format. */
  render() {
    const out = [];
    for (const full of this.order) {
      const m = this.metrics.get(full);
      if (m.series.size === 0) continue;
      out.push(`# HELP ${full} ${m.help}`);
      out.push(`# TYPE ${full} ${m.type}`);

      for (const [k, v] of m.series) {
        const labels = m._labels(k);
        if (m.type === 'histogram') {
          for (let i = 0; i < m.buckets.length; i += 1) {
            out.push(`${full}_bucket${renderLabels({ ...labels, le: m.buckets[i] })} ${v.counts[i]}`);
          }
          out.push(`${full}_bucket${renderLabels({ ...labels, le: '+Inf' })} ${v.n}`);
          out.push(`${full}_sum${renderLabels(labels)} ${v.sum}`);
          out.push(`${full}_count${renderLabels(labels)} ${v.n}`);
        } else {
          out.push(`${full}${renderLabels(labels)} ${v}`);
        }
      }
    }
    return out.join('\n') + '\n';
  }
}

export function createRegistry(prefix = 'fm') {
  return new Registry(prefix);
}
