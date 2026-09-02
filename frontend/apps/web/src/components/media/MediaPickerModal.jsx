import { useEffect, useState } from 'react';
import { Film, ImageIcon, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import { LoadingBlock } from '../ui/Spinner.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import MediaUploader from './MediaUploader.jsx';

/**
 * Media gallery — pick an existing uploaded asset (any purpose) or upload a
 * new one inline. onPick(url) receives the chosen public URL.
 */
export default function MediaPickerModal({ open, onClose, purpose, onPick, accept }) {
  const [items, setItems] = useState(null);
  const { busy, run } = useAction();

  const load = () => {
    api.media
      .list({ limit: 50 })
      .then((r) => setItems(r.data))
      .catch((e) => toast.error(errMsg(e)));
  };

  useEffect(() => {
    if (open) { setItems(null); load(); }
  }, [open]);

  const remove = async (e, id) => {
    e.stopPropagation();
    try {
      await run(() => api.media.remove(id));
      toast.success('Asset deleted');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Media library" subtitle="Pick an uploaded image/video or upload a new one." size="lg">
      <div className="space-y-4">
        <MediaUploader
          purpose={purpose}
          multiple={false}
          accept={accept}
          buttonLabel={`Upload ${purpose === 'product_video' ? 'video' : 'image'}`}
          onUploaded={(asset) => {
            toast.success('Uploaded ✓');
            load();
            onPick?.(asset.url);
            onClose?.();
          }}
        />

        {items === null ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState icon={ImageIcon} title="Nothing uploaded yet" message="Uploads appear here and can be reused across the console." />
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onPick?.(a.url); onClose?.(); }}
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-rose-400 hover:ring-2 hover:ring-rose-400/30'
                )}
                title={a.filename ? undefined : a.url}
              >
                {a.type === 'video' ? (
                  <div className="grid h-full w-full place-items-center bg-slate-900 text-white">
                    <Film className="h-6 w-6 text-slate-400" />
                  </div>
                ) : (
                  <img src={a.url} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 text-left text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                  {a.purpose} · {(a.sizeBytes / 1024).toFixed(0)} KB
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => remove(e, a.id)}
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/50 text-white opacity-0 transition hover:bg-rose-600 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
