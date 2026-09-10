import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Layers,
  PackageX,
  Pencil,
  Plus,
  Star,
  Trash2,
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

  const removeImage = async (imageId) => {
    try {
      await run(() => api.catalogAdmin.removeImage(m.id, imageId, { expectedVersion: m.version }));
      toast.success('Image removed');
      load(true); onChanged?.();
    } catch (err) {
      if (!guard(err)) toast.error(errMsg(err));
    }
  };

  const starImage = async (imageId) => {
    try {
      await run(() => api.catalogAdmin.setImagePrimary(m.id, imageId, { expectedVersion: m.version }));
      toast.success('Primary image set');
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

  if (loading && !m) return <Modal open onClose={onClose} title="Master"><LoadingBlock compact /></Modal>;

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
            {variants.length > 0 && (
              <p className="text-[11px] text-slate-400">expand a row to edit, photograph or retire it</p>
            )}
          </header>
          {variants.length ? (
            <div className="divide-y divide-slate-100">
              {variants.map((v) => (
                <VariantRow
                  key={v.id || v._id}
                  v={v}
                  masterId={m.id}
                  version={m.version}
                  onMutated={() => { load(true); onChanged?.(); }}
                  onConflict={() => load(true)}
                />
              ))}
            </div>
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
                <div key={img.id || img._id || i} className="group/img relative">
                  <img src={img.url} alt={img.altText || m.title} className={cn('h-20 w-20 rounded-lg border border-slate-200 object-cover', img.isPrimary && 'ring-2 ring-rose-400')} />
                  {img.isPrimary && <span className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white"><BadgeCheck className="h-3 w-3" /></span>}
                  <span className="absolute inset-x-1 bottom-1 hidden justify-center gap-1 group-hover/img:flex">
                    {!img.isPrimary && (
                      <button
                        type="button"
                        title="Make primary"
                        disabled={busy}
                        onClick={() => starImage(img.id || img._id)}
                        className="grid h-6 w-6 place-items-center rounded-md bg-white/95 text-amber-500 shadow hover:bg-amber-50"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Remove image"
                      disabled={busy}
                      onClick={() => removeImage(img.id || img._id)}
                      className="grid h-6 w-6 place-items-center rounded-md bg-white/95 text-rose-500 shadow hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
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

/**
 * One variant row: thumbnail, identity, photo source — expanding into a full
 * editor (label/SKU/status/default), a per-variant photo manager with upload,
 * and a two-click retire that also retires the variant's gallery.
 */
function VariantRow({ v, masterId, version, onMutated, onConflict }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const inputRef = useRef(null);

  const vid = v.id || v._id;
  const label = v.displayLabel || v.value;
  const ownPhotos = v.imageSource === 'variant';
  const gallery = v.images || [];

  const fail = (e) => {
    if (e?.code === 'VERSION_CONFLICT') {
      toast.error('Changed by someone else — refreshed, retry your change');
      onConflict?.();
    } else {
      toast.error(errMsg(e));
    }
  };
  const done = (msg) => { toast.success(msg); onMutated(); };

  const startEdit = () => {
    setForm({
      displayLabel: v.displayLabel || '',
      sku: v.sku || '',
      sortOrder: v.sortOrder ?? 0,
      status: v.status || 'active',
      isDefault: Boolean(v.isDefault),
    });
    setEditing(true);
  };

  const save = async (e) => {
    e?.preventDefault();
    try {
      await run(() => api.catalogAdmin.updateVariant(masterId, vid, {
        displayLabel: form.displayLabel || null,
        sku: form.sku || null,
        sortOrder: Math.max(0, Math.trunc(Number(form.sortOrder) || 0)),
        status: form.status,
        isDefault: form.isDefault,
        expectedVersion: version,
      }));
      setEditing(false);
      done('Variant updated');
    } catch (err) { fail(err); }
  };

  const remove = async () => {
    try {
      await run(() => api.catalogAdmin.removeVariant(masterId, vid, { expectedVersion: version }));
      done(`“${label}” retired — its photos went with it`);
    } catch (err) { setConfirmingRemove(false); fail(err); }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadFile({ file, purpose: MEDIA_PURPOSE.productImage });
      await run(() => api.catalogAdmin.addVariantImage(masterId, vid, { url: asset.url, expectedVersion: version }));
      done(`Photo added to “${label}”`);
    } catch (err) { fail(err); }
    finally { setUploading(false); }
  };

  const attachUrl = async (e) => {
    e.preventDefault();
    if (!photoUrl.trim()) return;
    try {
      await run(() => api.catalogAdmin.addVariantImage(masterId, vid, { url: photoUrl.trim(), expectedVersion: version }));
      setPhotoUrl('');
      done('Photo added');
    } catch (err) { fail(err); }
  };

  const star = async (imageId) => {
    try {
      await run(() => api.catalogAdmin.setImagePrimary(masterId, imageId, { expectedVersion: version }));
      done('Primary photo set');
    } catch (err) { fail(err); }
  };

  const delPhoto = async (imageId) => {
    try {
      await run(() => api.catalogAdmin.removeImage(masterId, imageId, { expectedVersion: version }));
      done('Photo removed');
    } catch (err) { fail(err); }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
      >
        {v.primaryImageUrl ? (
          <img src={v.primaryImageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
            <ImageIcon className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">{label}</span>
          <span className="block text-[11px] text-slate-400">
            {VARIANT_TYPE_LABEL[v.variantType] || v.variantType}
            {v.sku ? ` · ${v.sku}` : ''}
          </span>
        </span>
        {v.isDefault && <Badge tone="rose">default</Badge>}
        {v.status && v.status !== 'active' && <Badge tone="slate">{v.status}</Badge>}
        <Badge tone={ownPhotos ? 'emerald' : 'slate'}>
          {ownPhotos ? `${gallery.length} photo${gallery.length === 1 ? '' : 's'}` : 'master photos'}
        </Badge>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {/* edit */}
          {editing ? (
            <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
              <Field label="Label"><Input className="!w-40" value={form.displayLabel} onChange={(e) => setForm({ ...form, displayLabel: e.target.value })} /></Field>
              <Field label="Value"><Input className="!w-32" value={v.value} disabled title="The value is immutable — it anchors listings and history" /></Field>
              <Field label="SKU"><Input className="!w-32" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
              <Field label="Order"><Input className="!w-20" type="number" min="0" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="archived">archived</option>
                </Select>
              </Field>
              <label className="flex items-center gap-1.5 pb-2.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-rose-600" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> default
              </label>
              <span className="flex gap-2 pb-1.5">
                <Button type="submit" size="sm" loading={busy}>Save</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </span>
            </form>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                value <span className="font-mono text-slate-700">{v.value}</span> · order {v.sortOrder ?? 0}
              </p>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={startEdit}>Edit</Button>
            </div>
          )}

          {/* photos */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">
              Photos {ownPhotos ? '— this variant’s own shoot' : '— falling back to the master gallery'}
            </p>
            {gallery.length ? (
              <div className="flex flex-wrap gap-2">
                {gallery.map((img, i) => (
                  <span key={img.id || img._id || i} className="group/img relative">
                    <img src={img.url} alt={img.altText || label} className={cn('h-16 w-16 rounded-lg border border-slate-200 object-cover', img.isPrimary && 'ring-2 ring-rose-400')} />
                    {ownPhotos && (
                      <span className="absolute inset-x-1 bottom-1 hidden justify-center gap-1 group-hover/img:flex">
                        {!img.isPrimary && (
                          <button type="button" title="Make primary" disabled={busy} onClick={() => star(img.id || img._id)} className="grid h-5 w-5 place-items-center rounded bg-white/95 text-amber-500 shadow">
                            <Star className="h-3 w-3" />
                          </button>
                        )}
                        <button type="button" title="Remove photo" disabled={busy} onClick={() => delPhoto(img.id || img._id)} className="grid h-5 w-5 place-items-center rounded bg-white/95 text-rose-500 shadow">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No photos anywhere yet — not even on the master.</p>
            )}
            {!ownPhotos && gallery.length > 0 && (
              <p className="mt-1.5 text-[11px] text-slate-400">Upload below to give “{label}” its own photos; the master gallery stays as fallback.</p>
            )}
            <form onSubmit={attachUrl} className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} />
              <Button type="button" size="sm" variant="secondary" icon={UploadCloud} loading={uploading} onClick={() => inputRef.current?.click()}>
                Upload
              </Button>
              <Input className="!w-56 flex-1" placeholder="or paste an image URL…" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
              <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!photoUrl.trim()}>Attach</Button>
            </form>
          </div>

          {/* retire */}
          <div className="flex items-center justify-between border-t border-slate-200/70 pt-2.5">
            <p className="text-[11px] text-slate-400">Retiring hides it everywhere and retires its photos. Listings stay historical.</p>
            {confirmingRemove ? (
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>Keep</Button>
                <Button size="sm" variant="danger" loading={busy} onClick={remove}>Confirm retire</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmingRemove(true)}>Retire variant</Button>
            )}
          </div>
        </div>
      )}
    </div>
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
