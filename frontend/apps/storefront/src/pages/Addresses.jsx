import { useState } from 'react';
import { Check, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Empty, Skeleton } from '../components/ui.jsx';
import { errMsg } from '../lib/utils.js';
import { cn } from '../lib/utils.js';

const BLANK = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', label: 'home' };

function AddressForm({ initial, title, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial);
  const toast = useShop((s) => s.toast);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      await onSave(f);
    } catch (e) {
      toast(errMsg(e), 'error');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="Full name" value={f.name} onChange={set('name')} />
        <input className="input" placeholder="Phone" inputMode="numeric" value={f.phone} onChange={set('phone')} />
      </div>
      <input className="input" placeholder="Flat / house / street" value={f.line1} onChange={set('line1')} />
      <input className="input" placeholder="Area, landmark (optional)" value={f.line2} onChange={set('line2')} />
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="City" value={f.city} onChange={set('city')} />
        <input className="input" placeholder="State" value={f.state} onChange={set('state')} />
        <input className="input" placeholder="Pincode" inputMode="numeric" value={f.pincode} onChange={set('pincode')} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" loading={saving || busy} disabled={!f.line1 || !f.pincode} onClick={save}>Save address</Button>
      </div>
    </div>
  );
}

/**
 * Address book — the customer's saved delivery addresses.
 *
 * Same fields as the checkout address form, but with the three things checkout
 * can't do: set a default (preselected at checkout), edit, and delete.
 */
export default function Addresses() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const openAuth = useShop((s) => s.openAuth);
  const toast = useShop((s) => s.toast);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: addresses, loading, refetch } = useApi(
    () => (isAuth ? api.shop.addresses() : Promise.resolve({ data: [] })),
    [isAuth]
  );

  if (!isAuth) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={MapPin}
          title="Sign in to see your addresses"
          message="Saved addresses speed up checkout."
          action={<Button onClick={openAuth}>Sign in</Button>}
        />
      </div>
    );
  }

  const setDefault = async (a) => {
    setBusy(true);
    try {
      await api.shop.setDefaultAddress(a.id);
      toast('Default address updated', 'success');
      refetch();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm('Delete this address?')) return;
    setBusy(true);
    try {
      await api.shop.removeAddress(a.id);
      toast('Address deleted', 'success');
      refetch();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async (f) => {
    const r = await api.shop.addAddress(f);
    toast('Address saved', 'success');
    setAdding(false);
    refetch();
    // a fresh address returns {data}; keep the id so we can preselect nothing
    return r.data;
  };

  const saveEdit = async (f) => {
    await api.shop.updateAddress(editing.id, f);
    toast('Address updated', 'success');
    setEditing(null);
    refetch();
  };

  return (
    <div className="wrap max-w-3xl py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Addresses</h1>
        <Button variant="soft" size="sm" icon={Plus} onClick={() => { setAdding(true); setEditing(null); }}>
          Add address
        </Button>
      </div>

      {adding && (
        <div className="mb-5">
          <AddressForm
            title="New address"
            initial={BLANK}
            busy={busy}
            onCancel={() => setAdding(false)}
            onSave={add}
          />
        </div>
      )}

      {!loading && !addresses?.length && !adding ? (
        <Empty
          icon={MapPin}
          title="No saved addresses"
          message="Add one and it will be ready at checkout."
          action={<Button size="sm" onClick={() => setAdding(true)}>Add your first address</Button>}
        />
      ) : (
        <div className="space-y-3">
          {(addresses || []).map((a) => (
            <div key={a.id} className={cn('card p-4', editing?.id === a.id && 'ring-2')} style={editing?.id === a.id ? { boxShadow: '0 0 0 2px var(--brand)' } : undefined}>
              {editing?.id === a.id ? (
                <AddressForm
                  title={`Edit — ${a.name || 'address'}`}
                  initial={{ ...BLANK, ...a }}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        {a.name || 'Address'}
                        {a.isDefault && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <Check className="h-3 w-3" />Default
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')}
                      </p>
                      {a.phone && <p className="mt-0.5 text-xs text-slate-400">+{a.countryCode || ''} {a.phone}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!a.isDefault && (
                        <button
                          type="button"
                          title="Set as default"
                          onClick={() => setDefault(a)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => { setEditing(a); setAdding(false); }}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => remove(a)}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
          {loading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      )}
    </div>
  );
}
