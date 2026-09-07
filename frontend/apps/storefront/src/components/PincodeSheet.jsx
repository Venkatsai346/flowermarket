import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { Button, Sheet } from './ui.jsx';
import { errMsg } from '../lib/utils.js';

export default function PincodeSheet() {
  const open = useShop((s) => s.pinOpen);
  const close = useShop((s) => s.closePin);
  const pincode = useShop((s) => s.pincode);
  const setPincode = useShop((s) => s.setPincode);
  const setServiceability = useShop((s) => s.setServiceability);
  const toast = useShop((s) => s.toast);

  const [value, setValue] = useState(pincode || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(pincode || '');
  }, [open, pincode]);

  const save = async () => {
    const pin = value.replace(/\D/g, '');
    if (pin.length !== 6) { toast('Enter a 6-digit pincode', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.shop.serviceability(pin);
      setPincode(pin);
      setServiceability(r.data);
      if (r.data?.serviceable) toast(`We deliver to ${pin}`, 'success');
      else toast(r.message || `We don't deliver to ${pin} yet`);
      close();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      side="bottom"
      title="Where should we deliver?"
      subtitle="Slots and serviceability are tied to this pin — we will not pretend we cover a city we don't."
      footer={(
        <Button className="w-full" loading={busy} icon={MapPin} onClick={save}>
          Check delivery
        </Button>
      )}
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Pincode</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="533001"
          inputMode="numeric"
          autoFocus
          className="input text-center text-2xl tracking-[0.4em]"
        />
      </label>
    </Sheet>
  );
}
