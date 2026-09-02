import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Image as ImageIcon,
  Layers,
  PackageX,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  fmtDate,
  pickMeta,
  PRODUCT_MASTER_STATUS_META,
  PRODUCT_TYPE_META,
  SELLING_UNIT_LABEL,
  VARIANT_TYPE_LABEL,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import { uploadFile, uploadErrorText, MEDIA_PURPOSE } from '../../lib/upload.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const STATUS_META = PRODUCT_MASTER_STATUS_META;

/**
 * Rich master detail — attributes, variants, images, review/deprecate and
 * sub-resource management. Every mutation carries `master.version` (refetched
 * after each change) so concurrent edits surface VERSION_CONFLICT.
 */
export default function MasterDetailModal({ masterId, onClose, onChanged }) {
  const { busy, run } = useAction();
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api.catalogAdmin.master(masterId);
      setM(r.data);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [masterId]);

  // sub-forms
  const [confirm, setConfirm] = useState(null); // {kind:'approve'|'reject'|'deprecate'}
  const [note, setNote] = useState('');
  const [variantForm, setVariantForm] = useState({ variantType: 'weight', value: '', displayLabel: '', sku: '', isDefault: false });
  const [imageForm, setImageForm] = useState({ url: '', altText: '', isPrimary: false });
  const [attrsEdit, setAttrsEdit] = useState(null); // rows array or null
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef(null);

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadFile({ file, purpose: MEDIA_PURPOSE.productImage });
      setImageForm((f) => ({ ...f, url: asset.url }));
      toast.success('Image uploaded — press “Add image” to attach it');
    } catch (err) {
      toast.error(uploadErrorText(err));
    } finally {
      setUploading(false);
    }
  };

  const guard = (e) => {
    if (e?.code === 'VERSION_CONFLICT') {
      toast.error('Changed by someone else — refreshed, retry your change');
      load(true);
      return true;
    }
    return false;
  };

  const act = async (kind) => {
    try {
      if (kind === 'approve' || kind === 'reject') {
        await run(() => api.catalogAdmin.reviewMaster(m.id, { decision: kind, note: note || null }));
        toast.success(kind === 'approve' ? 'Master approved — active' : 'Master rejected');
      } else if (kind === 'deprecate') {
        await run(() => api.catalogAdmin.deprecateMaster(m.id, { note: note || null }));
        toast.success('Master deprecated — listings will be deactivated');
      }
      setConfirm(null); setNote('');
      load(true); onChanged?.();
    } catch (e) {
      if (!guard(e)) toast.error(errMsg(e));
    }
  };

  const addVariant = async (e) => {
    e.preventDefault();
    if (!variantForm.value.trim()) return;
    try {
      await run(() => api.catalogAdmin.addVariant(m.id, { ...variantForm, expectedVersion: m.version }));
      toast.success('Variant added');
      setVariantForm({ variantType: 'weight', value: '', displayLabel: '', sku: '', isDefault: false });
      load(true); onChanged?.();
    } catch (err) {
      if (!guard(err)) toast.error(errMsg(err));
    }
  };

  const addImage = async (e) => {
    e.preventDefault();
    if (!imageForm.url.trim()) return;
    try {
      await run(() => api.catalogAdmin.addImage(m.id, { ...imageForm, expectedVersion: m.version }));
      toast.success('Image added');
      setImageForm({ url: '', altText: '', isPrimary: false });
      load(true); onChanged?.();
    } catch (err) {
      if (!guard(err)) toast.error(errMsg(err));
    }
  };

  const saveAttributes = async (e) => {
    e.preventDefault();
    try {
      await run(() =>
        api.catalogAdmin.setMasterAttributes(m.id, {
          attributes: (attrsEdit || []).filter((a) => a.key && a.value).map((a) => ({ key: a.key, value: a.value, unit: a.unit || null })),
          expectedVersion: m.version,
        })
      );
      toast.success('Attributes replaced');
      setAttrsEdit(null);
      load(true); onChanged?.();
    } catch (err) {
      if (!guard(err)) toast.error(errMsg(err));
    }
  };

  if (loading && !m) return <Modal open onClose={onClose} title="Master"><LoadingBlock /></Modal>;

  if (error || !m) {
    return (
      <Modal open onClose={onClose} title="Master">
        <p className="py-6 text-center text-sm text-rose-600">{error || 'Not found'}</p>
      </Modal>
    );
  }

  const pendingReview = m.status === 'pending_review';
  const deprecated = m.status === 'deprecated';
  const attrs = m.attributes || [];
  const variants = m.variants || [];
  const images = m.images || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={m.title}
      subtitle={`SKU ${m.skuGlobal} · v${m.version}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {pendingReview && (
            <>
              <Button variant="danger" onClick={() => setConfirm('reject')} icon={X}>Reject</Button>
              <Button variant="success" onClick={() => setConfirm('approve')} icon={Check}>Approve</Button>
            </>
          )}
          {!pendingReview && !deprecated && (
            <Button variant="danger" onClick={() => setConfirm('deprecate')} icon={PackageX}>Deprecate</Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {/* identity */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pickMeta(STATUS_META, m.status).tone} dot>{pickMeta(STATUS_META, m.status).label}</Badge>
          <Badge tone={pickMeta(PRODUCT_TYPE_META, m.type).tone}>{pickMeta(PRODUCT_TYPE_META, m.type).label}</Badge>
          {m.marketplaceListed && <Badge tone="violet">marketplace listed</Badge>}
          {m.vendorId && <Badge tone="emerald">vendor-owned</Badge>}
          {m.isPerishable && <Badge tone="amber">perishable</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Info label="Category" value={m.category?.name || '—'} />
          <Info label="Brand" value={m.brand?.name || '—'} />
          <Info label="Selling unit" value={SELLING_UNIT_LABEL[m.defaultSellingUnit] || m.defaultSellingUnit || '—'} />
          <Info label="Barcode" value={m.barcode || '—'} mono />
          <Info label="Min / max qty" value={`${m.minOrderQty ?? 1} / ${m.maxOrderQty ?? 100}`} />
          <Info label="Cold chain" value={m.requiresColdChain ? 'Yes' : 'No'} />
          <Info label="Created" value={fmtDate(m.createdAt)} />
          <Info label="Updated" value={fmtDate(m.updatedAt)} />
        </div>
        {m.shortDescription && <p className="text-sm text-slate-600">{m.shortDescription}</p>}
        {(m.tags || []).length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {(m.tags || []).map((t) => <Badge key={t} tone="slate">#{t}</Badge>)}
          </p>
        )}

        {/* attributes */}
        <section className="rounded-xl border border-slate-200">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Attributes</p>
            <Button variant="ghost" size="sm" onClick={() => setAttrsEdit(attrsEdit ? null : attrs.map((a) => ({ ...a })))}>
              {attrsEdit ? 'Cancel' : 'Replace'}
            </Button>
          </header>
          {attrsEdit ? (
            <form onSubmit={saveAttributes} className="space-y-2 p-3">
              {attrsEdit.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                  <Input className="!w-36" value={a.key} onChange={(e) => setAttrsEdit(attrsEdit.map((x, j) => j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x))} />
                  <Input className="flex-1" value={a.value} onChange={(e) => setAttrsEdit(attrsEdit.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  <Input className="!w-24" placeholder="unit" value={a.unit || ''} onChange={(e) => setAttrsEdit(attrsEdit.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                  <button type="button" className="btn-ghost btn-sm !p-1.5" onClick={() => setAttrsEdit(attrsEdit.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={() => setAttrsEdit([...attrsEdit, { key: '', value: '', unit: '' }])}>
                Add attribute
              </Button>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                <Button type="submit" loading={busy}>Save attributes</Button>
              </div>
            </form>
          ) : attrs.length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {attrs.map((a, i) => (
                  <tr key={i}>
                    <td className="w-1/2 px-4 py-2 font-mono text-xs text-slate-500">{a.key}</td>
                    <td className="px-4 py-2 text-slate-800">{a.value}{a.unit ? <span className="ml-1 text-xs text-slate-400">{a.unit}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 py-4 text-center text-xs text-slate-400">No attributes.</p>}
        </section>

        {/* variants */}
        <section className="rounded-xl border border-slate-200">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Layers className="h-4 w-4" /> Variants</p>
          </header>
          {variants.length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {variants.map((v, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-xs font-medium text-slate-500">{VARIANT_TYPE_LABEL[v.variantType] || v.variantType}</td>
                    <td className="px-4 py-2 text-slate-800">{v.displayLabel || v.value}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{v.sku || '—'}</td>
                    <td className="px-4 py-2 text-right">{v.isDefault && <Badge tone="rose">default</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 py-4 text-center text-xs text-slate-400">No variants.</p>}
          <form onSubmit={addVariant} className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
            <Select className="!w-32" value={variantForm.variantType} onChange={(e) => setVariantForm({ ...variantForm, variantType: e.target.value })}>
              {Object.keys(VARIANT_TYPE_LABEL).map((t) => <option key={t} value={t}>{VARIANT_TYPE_LABEL[t]}</option>)}
            </Select>
            <Input className="!w-44" placeholder="value" value={variantForm.value} onChange={(e) => setVariantForm({ ...variantForm, value: e.target.value })} />
            <Input className="!w-36" placeholder="label" value={variantForm.displayLabel} onChange={(e) => setVariantForm({ ...variantForm, displayLabel: e.target.value })} />
            <Input className="!w-32" placeholder="SKU" value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" className="accent-rose-600" checked={variantForm.isDefault} onChange={(e) => setVariantForm({ ...variantForm, isDefault: e.target.checked })} /> default
            </label>
            <Button type="submit" size="sm" variant="secondary" loading={busy}>Add variant</Button>
          </form>
        </section>

        {/* images */}
        <section className="rounded-xl border border-slate-200">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ImageIcon className="h-4 w-4" /> Images</p>
          </header>
          {images.length ? (
            <div className="flex flex-wrap gap-3 p-3">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img.url} alt={img.altText || m.title} className={cn('h-20 w-20 rounded-lg border border-slate-200 object-cover', img.isPrimary && 'ring-2 ring-rose-400')} />
                  {img.isPrimary && <span className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white"><BadgeCheck className="h-3 w-3" /></span>}
                </div>
              ))}
            </div>
          ) : <p className="px-4 py-4 text-center text-xs text-slate-400">No images.</p>}
          <form onSubmit={addImage} className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={uploadImage} />
            <Button type="button" size="sm" variant="secondary" icon={UploadCloud} loading={uploading} onClick={() => imageInputRef.current?.click()}>
              Upload
            </Button>
            <Input className="!w-64 flex-1" placeholder="https://…/image.jpg (or paste URL)" value={imageForm.url} onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })} />
            <Input className="!w-36" placeholder="alt text" value={imageForm.altText} onChange={(e) => setImageForm({ ...imageForm, altText: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" className="accent-rose-600" checked={imageForm.isPrimary} onChange={(e) => setImageForm({ ...imageForm, isPrimary: e.target.checked })} /> primary
            </label>
            <Button type="submit" size="sm" variant="secondary" loading={busy}>Add image</Button>
          </form>
        </section>
      </div>

      {/* review / deprecate confirm */}
      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={
          confirm === 'approve' ? 'Approve master'
            : confirm === 'reject' ? 'Reject master'
            : 'Deprecate master'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm === 'approve' ? 'success' : 'danger'}
              loading={busy}
              onClick={() => act(confirm)}
            >
              {confirm === 'approve' ? 'Approve' : confirm === 'reject' ? 'Reject' : 'Deprecate'}
            </Button>
          </>
        }
      >
        {confirm === 'deprecate' && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Deprecating deactivates this product across every tenant listing. This is a soft removal.
          </p>
        )}
        <div className="mt-3">
          <label className="label">Note (optional)</label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={confirm === 'approve' ? 'Quality check passed…' : 'Reason…'} />
        </div>
      </Modal>
    </Modal>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-medium text-slate-800', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}
