import { useRef, useState } from 'react';
import { ImageOff, Library, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { uploadFile, uploadErrorText } from '../../lib/upload.js';
import { Field, Input } from '../ui/Field.jsx';
import MediaPickerModal from './MediaPickerModal.jsx';

/**
 * ImageField — preview + "Upload from device" + "Browse library" gallery +
 * URL-paste fallback + clear. Used for single-image fields (category image,
 * brand logo, store logo/banner).
 */
export default function ImageField({ label, value, onChange, purpose, hint, className }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadFile({ file, purpose, onProgress: () => {} });
      onChange?.(asset.url);
    } catch (err) {
      setError(uploadErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} hint={hint} className={className}>
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageOff className="h-5 w-5 text-slate-300" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {busy ? 'Uploading…' : 'Upload from device'}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
              <Library className="h-3.5 w-3.5" /> Browse library
            </button>
            {value && (
              <button type="button" className="btn-ghost btn-sm !text-rose-500" onClick={() => onChange?.('')}>
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">or paste a URL</span>
            <Input className="!h-8 !py-1 text-xs" placeholder="https://…" value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
          </div>
          {error && <p className={cn('text-xs font-medium text-rose-600')}>{error}</p>}
        </div>
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        purpose={purpose}
        onPick={(url) => { onChange?.(url); setPickerOpen(false); }}
      />
    </Field>
  );
}
