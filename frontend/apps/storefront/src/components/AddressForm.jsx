import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { Button } from './ui.jsx';
import { errMsg } from '../lib/utils.js';

export const BLANK_ADDRESS = {
  name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', label: 'home',
};

/**
 * Shared address fields for Checkout and the address book.
 *
 * Placeholders are a Chromium e2e contract (S14/S28) — do not reword them.
 * A 6-digit pin looks up GET /catalog/serviceability (locality + hub city)
 * and fills city/state only when those fields are still empty.
 */
export default function AddressForm({
  initial = BLANK_ADDRESS,
  title,
  onSave,
  onCancel,
  busy = false,
}) {
  const [f, setF] = useState({ ...BLANK_ADDRESS, ...initial });
  const [saving, setSaving] = useState(false);
  const [svc, setSvc] = useState(null);
  const [svcBusy, setSvcBusy] = useState(false);
  const toast = useShop((s) => s.toast);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  const pin = String(f.pincode || '').replace(/\D/g, '').slice(0, 6);

  useEffect(() => {
    if (pin.length !== 6) {
      setSvc(null);
      setSvcBusy(false);
      return undefined;
    }
    let alive = true;
    setSvcBusy(true);
    api.shop.serviceability(pin)
      .then((r) => {
        if (!alive) return;
        const data = r.data || {};
        setSvc(data);
        const loc = data.locality || {};
        setF((prev) => {
          if (String(prev.pincode || '').replace(/\D/g, '') !== pin) return prev;
          return {
            ...prev,
            city: prev.city || data.hub?.name || loc.city || '',
            state: prev.state || loc.state || '',
          };
        });
      })
      .catch(() => { if (alive) setSvc(null); })
      .finally(() => { if (alive) setSvcBusy(false); });
    return () => { alive = false; };
  }, [pin]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave?.({ ...f, pincode: pin });
    } catch (e) {
      toast(errMsg(e), 'error');
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const localityLine = [svc?.hub?.name || svc?.locality?.city, svc?.locality?.state]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
      {title && <p className="text-sm font-semibold text-slate-800">{title}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="Full name" value={f.name} onChange={set('name')} />
        <input className="input" placeholder="Phone" inputMode="numeric" value={f.phone} onChange={set('phone')} />
      </div>
      <input className="input" placeholder="Flat / house / street" value={f.line1} onChange={set('line1')} />
      <input className="input" placeholder="Area, landmark (optional)" value={f.line2} onChange={set('line2')} />
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="City" value={f.city} onChange={set('city')} />
        <input className="input" placeholder="State" value={f.state} onChange={set('state')} />
        <input
          className="input"
          placeholder="Pincode"
          inputMode="numeric"
          maxLength={6}
          value={f.pincode}
          onChange={(e) => setF((prev) => ({ ...prev, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
        />
      </div>
      {pin.length === 6 && (
        <p
          className={
            svcBusy
              ? 'text-xs text-slate-400'
              : svc?.serviceable
                ? 'text-xs font-medium text-emerald-700'
                : svc
                  ? 'text-xs font-medium text-rose-600'
                  : 'text-xs text-slate-400'
          }
        >
          {svcBusy
            ? 'Checking this pin…'
            : svc?.serviceable
              ? `We deliver here${localityLine ? ` · ${localityLine}` : ''}`
              : svc
                ? `We don't deliver to ${pin} yet${svc.locality?.state ? ` (${svc.locality.state})` : ''}`
                : localityLine || null}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" loading={saving || busy} disabled={!f.line1 || pin.length !== 6} onClick={save}>
          Save address
        </Button>
      </div>
    </div>
  );
}
