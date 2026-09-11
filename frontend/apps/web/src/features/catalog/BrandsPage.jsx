import { useState } from 'react';
import { BadgeCheck, Pencil, Plus, ShieldCheck, Trash2, Truck } from 'lucide-react';
import {
  BRAND_VERIFICATION_META,
  ENTITY_STATUS_META,
  fmtDate,
  initials,
  pickMeta,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import { MEDIA_PURPOSE } from '../../lib/upload.js';
import ImageField from '../../components/media/ImageField.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const STATUSES = [
  ['', 'All statuses'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['archived', 'Archived'],
];

const blank = () => ({
  name: '',
  slug: '',
  logoUrl: '',
  bannerUrl: '',
  tagline: '',
  description: '',
  story: '',
  countryOfOrigin: '',
  website: '',
  headquarters: '',
  foundedYear: '',
  instagram: '',
  facebook: '',
  youtube: '',
  x: '',
  isFeatured: false,
  sortOrder: 0,
  status: 'active',
});

function BrandModal({ open, onClose, initial, onSaved }) {
  const { busy, run } = useAction();
  const [form, setForm] = useState(() => (initial ? { ...blank(), ...pickFields(initial) } : blank()));
  const [error, setError] = useState(null);
  const isEdit = Boolean(initial);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Name is required');
    const body = {
      name: form.name.trim(),
      slug: form.slug || undefined,
      logoUrl: form.logoUrl || null,
      bannerUrl: form.bannerUrl || null,
      tagline: form.tagline || null,
      description: form.description || null,
      story: form.story || null,
      countryOfOrigin: form.countryOfOrigin || null,
      website: form.website || null,
      headquarters: form.headquarters || null,
      foundedYear: form.foundedYear === '' || form.foundedYear == null ? null : Number(form.foundedYear),
      socialLinks: {
        instagram: form.instagram || null,
        facebook: form.facebook || null,
        youtube: form.youtube || null,
        x: form.x || null,
      },
      isFeatured: form.isFeatured,
      sortOrder: Number(form.sortOrder) || 0,
      status: form.status,
    };
    try {
      const r = await run(() =>
        // rid(), not .id: rows inject id, but resolve either shape so edit can
        // never aim at `undefined` (same lean-row class as categories).
        isEdit ? api.catalogAdmin.updateBrand(rid(initial), body) : api.catalogAdmin.createBrand(body)
      );
      toast.success(isEdit ? 'Brand updated' : `Brand “${r.data?.name}” created`);
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
      title={isEdit ? `Edit brand · ${initial.name}` : 'New brand'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}>{isEdit ? 'Save changes' : 'Create brand'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Green Thumb" />
          </Field>
          <Field label="Slug" hint="Auto-generated when blank">
            <Input className="font-mono" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') })} placeholder="green-thumb" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField
            label="Logo"
            hint="Upload from device or paste a URL"
            purpose={MEDIA_PURPOSE.brandLogo}
            value={form.logoUrl}
            onChange={(v) => setForm({ ...form, logoUrl: v })}
          />
          <ImageField
            label="Banner"
            hint="Wide hero for the brand card"
            purpose={MEDIA_PURPOSE.brandBanner}
            value={form.bannerUrl}
            onChange={(v) => setForm({ ...form, bannerUrl: v })}
          />
        </div>
        <Field label="Tagline" hint="One line under the brand name (max 160)">
          <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Farm-fresh roses, every morning" />
        </Field>
        <Field label="Description" hint="Short summary for cards (max 500)">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="About this brand…" />
        </Field>
        <Field label="Story" hint="Long-form story for the brands page (max 3000)">
          <Textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} placeholder="How this brand started, what it stands for…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country of origin">
            <Input value={form.countryOfOrigin} onChange={(e) => setForm({ ...form, countryOfOrigin: e.target.value })} placeholder="India" />
          </Field>
          <Field label="Website" hint="https://…">
            <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://brand.example.com" />
          </Field>
          <Field label="Headquarters">
            <Input value={form.headquarters} onChange={(e) => setForm({ ...form, headquarters: e.target.value })} placeholder="Bengaluru" />
          </Field>
          <Field label="Founded year">
            <Input type="number" min={1800} max={2100} value={form.foundedYear} onChange={(e) => setForm({ ...form, foundedYear: e.target.value })} placeholder="2015" />
          </Field>
        </div>
        <div>
          <p className="label">Social links</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="Instagram URL" />
            <Input value={form.facebook} onChange={(e) => setForm({ ...form, facebook: e.target.value })} placeholder="Facebook URL" />
            <Input value={form.youtube} onChange={(e) => setForm({ ...form, youtube: e.target.value })} placeholder="YouTube URL" />
            <Input value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} placeholder="X URL" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['active', 'inactive', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Sort order" hint="Lower first">
            <Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </Field>
          <Field label="Curation">
            <label className="flex h-[42px] items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={form.isFeatured}
                onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
              />
              Featured brand
            </label>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

const pickFields = (b) => ({
  name: b.name || '',
  slug: b.slug || '',
  logoUrl: b.logoUrl || '',
  bannerUrl: b.bannerUrl || '',
  tagline: b.tagline || '',
  description: b.description || '',
  story: b.story || '',
  countryOfOrigin: b.countryOfOrigin || '',
  website: b.website || '',
  headquarters: b.headquarters || '',
  foundedYear: b.foundedYear ?? '',
  instagram: b.socialLinks?.instagram || '',
  facebook: b.socialLinks?.facebook || '',
  youtube: b.socialLinks?.youtube || '',
  x: b.socialLinks?.x || '',
  isFeatured: Boolean(b.isFeatured),
  sortOrder: b.sortOrder ?? 0,
  status: b.status || 'active',
});

export default function BrandsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [verified, setVerified] = useState('');
  const [featured, setFeatured] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | brand
  const [verify, setVerify] = useState(null); // {brand, verified}
  const [note, setNote] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const { busy, run } = useAction();

  const brands = useApi(
    () =>
      api.catalogAdmin.brands({
        page, limit: 20,
        status: status || undefined,
        verified: verified === '' ? undefined : verified === 'true',
        featured: featured === '' ? undefined : featured === 'true',
        search: q.trim() || undefined,
      }),
    [page, status, verified, featured, q]
  );

  const doVerify = async () => {
    if (!verify) return;
    try {
      await run(() => api.catalogAdmin.verifyBrand(verify.brand.id, { verified: verify.verified, note: note || null }));
      toast.success(`Brand ${verify.verified ? 'verified' : 'unverified'}`);
      setVerify(null); setNote('');
      brands.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const del = async () => {
    if (!confirmDel) return;
    try {
      await run(() => api.catalogAdmin.deleteBrand(confirmDel.id));
      toast.success('Brand removed (soft — now inactive)');
      setConfirmDel(null);
      brands.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const rows = (brands.data || []).map((b) => ({ ...b, id: rid(b) }));

  return (
    <div>
      <PageHeader
        title="Brands"
        description="The brand registry — verification is a one-click operator action."
        actions={<Button icon={Plus} onClick={() => setModal('new')}>New brand</Button>}
      />

      <Card bodyClassName="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Select className="!w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select className="!w-44" value={verified} onChange={(e) => { setVerified(e.target.value); setPage(1); }}>
            <option value="">All verification</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </Select>
          <Select className="!w-40" value={featured} onChange={(e) => { setFeatured(e.target.value); setPage(1); }}>
            <option value="">All curation</option>
            <option value="true">Featured</option>
            <option value="false">Not featured</option>
          </Select>
          <label className="relative ml-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="!w-56 !pl-9"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search brands…"
            />
          </label>
        </div>
        <Table
          loading={brands.loading && !brands.data}
          data={rows}
          empty={<EmptyState icon={Truck} title="No brands found" message="Create your first brand to attribute products." />}
          columns={[
            { key: 'brand', header: 'Brand', render: (r) => (
              <div className="flex items-center gap-3">
                {r.logoUrl ? (
                  <img src={r.logoUrl} alt="" className="h-9 w-9 rounded-lg border border-slate-200 object-contain" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{initials(r.name)}</span>
                )}
                <div>
                  <p className="font-medium text-slate-800">{r.name}</p>
                  <p className="font-mono text-[11px] text-slate-400">/{r.slug}</p>
                </div>
              </div>
            ) },
            { key: 'origin', header: 'Origin', render: (r) => r.countryOfOrigin || '—' },
            { key: 'verification', header: 'Verification', render: (r) => {
              const v = r.verification || {};
              const m = pickMeta(BRAND_VERIFICATION_META, v.isVerified ? 'verified' : v.status || 'pending');
              return (
                <div>
                  <Badge tone={m.tone} dot>{m.label}</Badge>
                  {v.verifiedAt && <p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(v.verifiedAt)}</p>}
                </div>
              );
            } },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(ENTITY_STATUS_META, r.status);
              return <Badge tone={m.tone}>{m.label}</Badge>;
            } },
            { key: 'actions', header: '', align: 'right', render: (r) => (
              <div className="flex justify-end gap-1.5">
                <button
                  className={r.verification?.isVerified ? 'btn-danger btn-sm' : 'btn-success btn-sm'}
                  onClick={(e) => { e.stopPropagation(); setVerify({ brand: r, verified: !r.verification?.isVerified }); }}
                >
                  {r.verification?.isVerified ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {r.verification?.isVerified ? 'Unverify' : 'Verify'}
                </button>
                <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setModal(r); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost btn-sm !text-rose-500" onClick={(e) => { e.stopPropagation(); setConfirmDel({ id: r.id, name: r.name }); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) },
          ]}
          footer={<Pagination meta={brands.meta} onPage={setPage} />}
        />
      </Card>

      {modal && <BrandModal open onClose={() => setModal(null)} initial={modal === 'new' ? null : modal} onSaved={brands.refetch} />}

      <Modal
        open={Boolean(verify)}
        onClose={() => setVerify(null)}
        title={`${verify?.verified ? 'Verify' : 'Unverify'} “${verify?.brand?.name}”`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVerify(null)}>Cancel</Button>
            <Button variant={verify?.verified ? 'success' : 'danger'} loading={busy} onClick={doVerify}>
              {verify?.verified ? 'Mark verified' : 'Mark unverified'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-500">
          {verify?.verified
            ? 'Verification is audited and shown on storefronts. Add a note for the record.'
            : 'Unverifying keeps the brand but flags it as not verified.'}
        </p>
        <div className="mt-3">
          <label className="label">Note (optional)</label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Certificate of origin checked…" />
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        title={`Remove “${confirmDel?.name}”?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={del}>Remove</Button>
          </>
        }
      >
        <p className="text-sm text-slate-500">
          Removing a brand soft-deletes it (status → inactive). Existing products keep their attribution.
        </p>
      </Modal>
    </div>
  );
}
