import { Save } from 'lucide-react';
import Button from './Button.jsx';

/**
 * Floating save affordance for long admin forms. Hidden until the form is dirty.
 */
export default function StickySaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  message = 'You have unsaved changes',
}) {
  if (!dirty) return null;
  return (
    <div className="pointer-events-none sticky bottom-4 z-30 mt-6 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-sm font-medium text-slate-700">{message}</span>
        {onDiscard && (
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button type="button" size="sm" icon={Save} loading={saving} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
