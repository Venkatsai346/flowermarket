import { useRef, useState } from 'react';
import { CheckCircle2, Film, ImagePlus, UploadCloud, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { uploadFile, uploadErrorText, isSameOrigin } from '../../lib/upload.js';

/**
 * Drag-drop / picker uploader with a progress bar.
 * Calls onUploaded(asset) with the verified media asset; supports multiple files.
 */
export default function MediaUploader({ purpose, onUploaded, multiple = false, accept, className, buttonLabel }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState([]); // {name, progress, status: 'uploading'|'done'|'error', error?, url?}

  const pick = (files) => {
    for (const f of Array.from(files || [])) {
      const id = `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((s) => [...s, { id, name: f.name, progress: 0, status: 'uploading' }]);
      uploadFile({ file: f, purpose, onProgress: (p) => setItems((s) => s.map((i) => (i.id === id ? { ...i, progress: p } : i))) })
        .then((asset) => {
          setItems((s) => s.map((i) => (i.id === id ? { ...i, status: 'done', url: asset.url } : i)));
          onUploaded?.(asset);
        })
        .catch((err) => {
          setItems((s) => s.map((i) => (i.id === id ? { ...i, status: 'error', error: uploadErrorText(err) } : i)));
        });
    }
  };

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (multiple) pick(e.dataTransfer.files); else pick(e.dataTransfer.files?.[0] ? [e.dataTransfer.files[0]] : []); }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition',
          dragging ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-slate-50/60 hover:border-rose-300 hover:bg-rose-50/40'
        )}
      >
        <UploadCloud className="h-6 w-6 text-rose-400" />
        <p className="text-sm font-medium text-slate-600">{buttonLabel || 'Upload from device'}</p>
        <p className="text-[11px] text-slate-400">Drag &amp; drop or click · images ≤ 10 MB · videos ≤ 250 MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept || 'image/*,video/*'}
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
      />

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {it.status === 'done' ? (
                it.url?.endsWith('.mp4') || it.url?.endsWith('.webm') || it.url?.endsWith('.mov') ? (
                  <Film className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                )
              ) : it.status === 'error' ? (
                <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
              ) : (
                <ImagePlus className="h-4 w-4 shrink-0 text-slate-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-700">{it.name}</p>
                {it.status === 'uploading' && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${it.progress}%` }} />
                  </div>
                )}
                {it.status === 'done' && <p className="text-[11px] text-emerald-600">Uploaded ✓</p>}
                {it.status === 'error' && <p className="text-[11px] text-rose-600">{it.error}</p>}
              </div>
              {it.status === 'uploading' && <span className="text-xs font-semibold text-slate-500">{it.progress}%</span>}
              {it.status === 'done' && isSameOrigin(it.url) && (
                <span className="text-[10px] text-slate-400">local</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
