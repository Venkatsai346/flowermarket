import { useState } from 'react';
import { CalendarClock, ExternalLink, Layers3, Pause, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Button from '../../components/ui/Button.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const TYPES = [
  ['pin', 'Pin products'], ['boost', 'Boost products'], ['bury', 'Bury products'],
  ['redirect', 'Query redirect'], ['substitute', 'Stock substitution'], ['shelf', 'Curated shelf'],
];
const empty = { name: '', code: '', type: 'pin', query: '', match: 'exact', listingIds: '', destination: '', shelfTitle: '', boost: '0.5', startsAt: '', endsAt: '' };
const ids = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
const dateLabel = (value) => value ? new Date(value).toLocaleString() : 'Always';

export default function MerchandisingRulesPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { data, loading, error } = useApi(() => api.search.merchandisingRules().then((r) => r.data || []), [refreshKey]);
  const rules = Array.isArray(data) ? data : data?.items || [];
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const listingIds = ids(form.listingIds);
      await api.search.createMerchandisingRule({
        code: form.code, name: form.name, type: form.type, status: 'active',
        scope: { query: form.query || null, match: form.query ? form.match : 'all' },
        target: {
          listingIds: form.type === 'substitute' ? listingIds.slice(0, 1) : listingIds,
          substituteListingIds: form.type === 'substitute' ? listingIds.slice(1) : [],
          redirectPath: form.type === 'redirect' ? form.destination : null,
          shelfTitle: form.type === 'shelf' ? form.shelfTitle : null,
        },
        boost: Number(form.boost || 0.5),
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      });
      setForm(empty); setOpen(false); setRefreshKey((key) => key + 1);
    } catch (caught) { setMessage(errMsg(caught)); } finally { setBusy(false); }
  };

  const pause = async (rule) => {
    setBusy(true); setMessage('');
    try {
      await api.search.updateMerchandisingRule(rule.id, { expectedVersion: rule.version, status: rule.status === 'paused' ? 'active' : 'paused' });
      setRefreshKey((key) => key + 1);
    } catch (caught) { setMessage(errMsg(caught)); } finally { setBusy(false); }
  };
  const remove = async (rule) => {
    if (!window.confirm(`Delete “${rule.name}”?`)) return;
    setBusy(true);
    try { await api.search.deleteMerchandisingRule(rule.id); setRefreshKey((key) => key + 1); }
    catch (caught) { setMessage(errMsg(caught)); } finally { setBusy(false); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-5 py-4">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700"><Sparkles className="h-5 w-5" /></span><div><h2 className="font-semibold text-slate-900">Merchandising studio</h2><p className="text-xs text-slate-500">Schedule tenant-specific pins, boosts, redirects, shelves and substitutions.</p></div></div>
        <Button size="sm" icon={Plus} onClick={() => setOpen((value) => !value)}>{open ? 'Close' : 'New rule'}</Button>
      </header>
      {message && <p className="m-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{message}</p>}
      {open && (
        <form onSubmit={save} className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">Rule name<input required className="input mt-1 w-full" value={form.name} onChange={change('name')} placeholder="Diwali flower spotlight" /></label>
          <label className="text-xs font-semibold text-slate-600">Stable code<input required pattern="[a-z0-9][a-z0-9_-]*" className="input mt-1 w-full" value={form.code} onChange={change('code')} placeholder="diwali-flowers-2026" /></label>
          <label className="text-xs font-semibold text-slate-600">Action<select className="input mt-1 w-full" value={form.type} onChange={change('type')}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Query (blank = all)<input className="input mt-1 w-full" value={form.query} onChange={change('query')} placeholder="red roses" /></label>
          <label className="text-xs font-semibold text-slate-600">Listing IDs, comma separated<input className="input mt-1 w-full" value={form.listingIds} onChange={change('listingIds')} placeholder={form.type === 'substitute' ? 'out-of-stock ID, replacement IDs…' : 'listing IDs'} /></label>
          {form.type === 'redirect' && <label className="text-xs font-semibold text-slate-600">Destination path<input required className="input mt-1 w-full" value={form.destination} onChange={change('destination')} placeholder="/category/festive-flowers" /></label>}
          {form.type === 'shelf' && <label className="text-xs font-semibold text-slate-600">Shelf title<input required className="input mt-1 w-full" value={form.shelfTitle} onChange={change('shelfTitle')} /></label>}
          {form.type === 'boost' && <label className="text-xs font-semibold text-slate-600">Boost strength<input type="number" min="0" max="10" step="0.1" className="input mt-1 w-full" value={form.boost} onChange={change('boost')} /></label>}
          <label className="text-xs font-semibold text-slate-600">Starts at<input type="datetime-local" className="input mt-1 w-full" value={form.startsAt} onChange={change('startsAt')} /></label>
          <label className="text-xs font-semibold text-slate-600">Ends at<input type="datetime-local" className="input mt-1 w-full" value={form.endsAt} onChange={change('endsAt')} /></label>
          <div className="flex items-end"><Button type="submit" loading={busy} icon={CalendarClock}>Activate rule</Button></div>
        </form>
      )}
      {loading ? <LoadingBlock /> : error ? <p className="p-5 text-sm text-rose-600">{errMsg(error)}</p> : rules.length === 0 ? (
        <div className="grid place-items-center px-5 py-12 text-center"><Layers3 className="mb-3 h-8 w-8 text-slate-300" /><p className="text-sm font-semibold text-slate-700">No merchandising rules yet</p><p className="mt-1 text-xs text-slate-500">Create a scheduled campaign without changing your baseline ranking profile.</p></div>
      ) : <div className="divide-y divide-slate-100">{rules.map((rule) => (
        <article key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">{rule.type}</span><h3 className="truncate text-sm font-semibold text-slate-800">{rule.name}</h3><span className={`text-[10px] font-bold uppercase ${rule.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>{rule.status}</span></div><p className="mt-1 text-xs text-slate-500">{rule.scope?.query ? `“${rule.scope.query}” · ` : 'All queries · '}{dateLabel(rule.startsAt)} → {rule.endsAt ? dateLabel(rule.endsAt) : 'No end date'}</p></div>
          <div className="flex gap-1"><button title={rule.status === 'paused' ? 'Resume' : 'Pause'} disabled={busy} onClick={() => pause(rule)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pause className="h-4 w-4" /></button>{rule.target?.redirectPath && <a title="Open redirect" href={rule.target.redirectPath} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ExternalLink className="h-4 w-4" /></a>}<button title="Delete" disabled={busy} onClick={() => remove(rule)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
        </article>
      ))}</div>}
    </section>
  );
}
