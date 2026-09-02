import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { fmtDate, pickMeta, ENTITY_STATUS_META, ATTRIBUTE_FIELD_TYPE_LABEL } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import { MEDIA_PURPOSE } from '../../lib/upload.js';
import ImageField from '../../components/media/ImageField.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const FIELD_TYPES = Object.keys(ATTRIBUTE_FIELD_TYPE_LABEL);
const STATUSES = ['active', 'inactive', 'archived'];

const blank = () => ({
  name: '',
  slug: '',
  parentId: '',
  status: 'active',
  isFeatured: false,
  sortOrder: 0,
  description: '',
  imageUrl: '',
  attributeSchema: [],
});

const blankField = () => ({ key: '', label: '', type: 'string', required: false, options: '', unit: '', min: '', max: '' });

function CategoryModal({ open, onClose, initial, parents, onSaved, editing }) {
  const { busy, run } = useAction();
  const [form, setForm] = useState(() => (initial ? fromDoc(initial) : blank()));
  const [error, setError] = useState(null);
  const isEdit = Boolean(initial);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Name is required');
    if (form.attributeSchema.some((a) => a.key && !/^[a-z0-9_]+$/.test(a.key))) {
      return setError('Attribute keys can only contain lowercase letters, numbers and underscores');
    }
    const body = {
      name: form.name.trim(),
      slug: form.slug || undefined,
      parentId: form.parentId || null,
      status: form.status,
      isFeatured: form.isFeatured,
      sortOrder: Number(form.sortOrder) || 0,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      attributeSchema: form.attributeSchema.map((f) => ({
        key: f.key,
        label: f.label || null,
        type: f.type,
        required: f.required,
        options: f.options ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        unit: f.unit || null,
        min: f.min === '' ? undefined : Number(f.min),
        max: f.max === '' ? undefined : Number(f.max),
      })),
    };
    try {
      const r = await run(() =>
        isEdit ? api.catalogAdmin.updateCategory(initial.id, body) : api.catalogAdmin.createCategory(body)
      );
      toast.success(isEdit ? 'Category updated' : `Category “${r.data?.name}” created`);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit category · ${initial.name}` : 'New category'}
      subtitle={isEdit ? undefined : 'Root categories are storefront-level groups; children add structure.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}>{isEdit ? 'Save changes' : 'Create category'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Fresh flowers" />
          </Field>
          <Field label="Slug" hint="Auto-generated from name when blank">
            <Input className="font-mono" value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))} placeholder="fresh-flowers" />
          </Field>
          <Field label="Parent category">
            <Select value={form.parentId} onChange={(e) => set('parentId', e.target.value)}>
              <option value="">— Root —</option>
              {parents.filter((p) => !isEdit || rid(p) !== initial.id).map((p) => (
                <option key={rid(p)} value={rid(p)}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Sort order">
              <Input type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
          </div>
        </div>

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What belongs in this category…" />
        </Field>
        <ImageField
          label="Image"
          hint="Upload from device or paste a URL"
          purpose={MEDIA_PURPOSE.categoryImage}
          value={form.imageUrl}
          onChange={(v) => set('imageUrl', v)}
        />
        <Checkbox label="Featured (highlight on storefront)" checked={form.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} />

        <div>
          <p className="label !mb-2">Attribute schema</p>
          <p className="mb-2 text-xs text-slate-400">Fields shown when listing products in this category.</p>
          <div className="space-y-2">
            {form.attributeSchema.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
                <Input className="!w-28" placeholder="key" value={f.key} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x) }))} />
                <Input className="!w-32" placeholder="label" value={f.label} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                <Select className="!w-32" value={f.type} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, type: e.target.value } : x) }))}>
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{ATTRIBUTE_FIELD_TYPE_LABEL[t]}</option>)}
                </Select>
                {f.type === 'select' && (
                  <Input className="!w-44" placeholder="options (comma)" value={f.options} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, options: e.target.value } : x) }))} />
                )}
                <Input className="!w-20" placeholder="unit" value={f.unit} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) }))} />
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" className="accent-rose-600" checked={f.required} onChange={(e) => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) }))} /> req
                </label>
                <button type="button" className="btn-ghost btn-sm !p-1.5 ml-auto" onClick={() => setForm((s) => ({ ...s, attributeSchema: s.attributeSchema.filter((_, j) => j !== i) }))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={() => setForm((s) => ({ ...s, attributeSchema: [...s.attributeSchema, blankField()] }))}>
              Add schema field
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function fromDoc(c) {
  return {
    name: c.name || '',
    slug: c.slug || '',
    parentId: c.parentId || '',
    status: c.status || 'active',
    isFeatured: Boolean(c.isFeatured),
    sortOrder: c.sortOrder ?? 0,
    description: c.description || '',
    imageUrl: c.imageUrl || '',
    attributeSchema: (c.attributeSchema || []).map((f) => ({
      key: f.key,
      label: f.label || '',
      type: f.type || 'string',
      required: Boolean(f.required),
      options: (f.options || []).join(', '),
      unit: f.unit || '',
      min: f.min ?? '',
      max: f.max ?? '',
    })),
  };
}

export default function CategoriesPage() {
  const { data: tree, loading, refetch } = useApi(() => api.catalogAdmin.categoryTree({ includeInactive: true }), []);
  const { data: flat } = useApi(() => api.catalogAdmin.categories({ limit: 100, includeInactive: true }), []);
  const { busy, run } = useAction();
  const [modal, setModal] = useState(null); // {initial, defaultParent}
  const [confirmDel, setConfirmDel] = useState(null);

  const flatList = flat || [];
  const catId = useMemo(() => new Set(flatList.map((c) => rid(c))), [flatList]);

  const del = async () => {
    if (!confirmDel) return;
    try {
      await run(() => api.catalogAdmin.deleteCategory(confirmDel.id));
      toast.success(`Category “${confirmDel.name}” removed`);
      setConfirmDel(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err)); // e.g. CATEGORY_HAS_CHILDREN
      setConfirmDel(null);
    }
  };

  const renderNode = (node, depth = 0) => {
    const id = rid(node);
    const children = node.children || [];
    const st = pickMeta(ENTITY_STATUS_META, node.status);
    return (
      <li key={id}>
        <div
          className={cn('flex items-center gap-2 px-4 py-2.5 transition hover:bg-slate-50', depth > 0 && 'border-l border-slate-100')}
          style={{ paddingLeft: 16 + depth * 28 }}
        >
          {children.length ? (
            <FolderTree className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">
              {node.name}
              {node.isFeatured && <Star className="ml-1.5 inline h-3.5 w-3.5 text-amber-400" />}
            </p>
            <p className="text-[11px] text-slate-400">
              <span className="font-mono">/{node.slug}</span> · {children.length} children · {fmtDate(node.createdAt)}
            </p>
          </div>
          <Badge tone={st.tone} dot>{st.label}</Badge>
          {node.attributeSchema?.length > 0 && <Badge tone="violet">{node.attributeSchema.length} fields</Badge>}
          <div className="flex items-center gap-1">
            <button className="btn-ghost btn-sm !px-2" title="Add child" onClick={() => setModal({ initial: null, defaultParent: id })}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button className="btn-ghost btn-sm !px-2" title="Edit" onClick={() => setModal({ initial: node, defaultParent: null })}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button className="btn-ghost btn-sm !px-2 !text-rose-500" title="Delete" onClick={() => setConfirmDel({ id, name: node.name })}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {children.length > 0 && <ul>{children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        description="The storefront taxonomy — nested groups with optional attribute schemas."
        actions={<Button icon={Plus} onClick={() => setModal({ initial: null, defaultParent: null })}>New category</Button>}
      />

      <Card bodyClassName="!p-0">
        {loading && !tree ? (
          <LoadingBlock />
        ) : tree?.length ? (
          <ul className="divide-y divide-slate-100">{tree.map((n) => renderNode(n, 0))}</ul>
        ) : (
          <EmptyState icon={FolderTree} title="No categories yet" message="Create the first category to start structuring your catalog." />
        )}
      </Card>

      {modal && (
        <CategoryModal
          open
          onClose={() => setModal(null)}
          initial={modal.initial}
          parents={flatList}
          onSaved={() => refetch()}
        />
      )}

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        title={`Delete “${confirmDel?.name}”?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={del}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-slate-500">
          Categories with children can't be deleted — remove or move its sub-categories first.
        </p>
      </Modal>
    </div>
  );
}
