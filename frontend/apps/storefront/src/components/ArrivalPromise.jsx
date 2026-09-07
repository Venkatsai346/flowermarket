import { Clock3, MapPin } from 'lucide-react';
import { useShop } from '../store.js';
import { t } from '../i18n.js';
import { formatArrival } from '../lib/arrival.js';

export default function ArrivalPromise({ compact = false, className = '' }) {
  const language = useShop((s) => s.language);
  const pincode = useShop((s) => s.pincode);
  const serviceability = useShop((s) => s.serviceability);
  const nextSlot = useShop((s) => s.nextSlot);
  const openPin = useShop((s) => s.openPin);

  if (!pincode) {
    return (
      <button type="button" onClick={openPin} className={`arrival-chip ${className}`}>
        <MapPin className="h-3.5 w-3.5" />
        {t(language, 'setPinForSlots')}
      </button>
    );
  }
  if (serviceability && serviceability.serviceable === false) {
    return (
      <button type="button" onClick={openPin} className={`arrival-chip arrival-chip-warn ${className}`}>
        <MapPin className="h-3.5 w-3.5" />
        {t(language, 'dontDeliver')} {pincode}
      </button>
    );
  }
  const copy = formatArrival(nextSlot, { lang: language });
  return (
    <button type="button" onClick={openPin} className={`arrival-chip ${className}`}>
      <Clock3 className="h-3.5 w-3.5" />
      {copy || (compact ? t(language, 'deliveringTo') + ' ' + pincode : t(language, 'checkingSlot'))}
    </button>
  );
}
