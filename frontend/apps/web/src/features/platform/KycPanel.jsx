import { useEffect, useState } from 'react';
import { BadgeCheck, RefreshCw, Search, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { fmtDate, fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Table from '../../components/ui/Table.jsx';
import { BANK_VERIFICATION_META, KYC_STATUS_META } from './platformMeta.js';

const STATUSES = Object.entries(KYC_STATUS_META);
const kycMeta = (v) => {
  const m = pickMeta(KYC_STATUS_META, v);
  return { ...m, label: m.label || 'Not submitted' };
};
const bankMeta = (v) => {
  const m = pickMeta(BANK_VERIFICATION_META, v);
  return { ...m, label: m.label || 'Unverified' };
};

export default function KycPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, meta, loading, error } = useApi(
    () => api.payouts.admin.kyc({
      page, limit: 20,
      status: status || undefined,
      search: debouncedSearch || undefined,
    }),
    [page, status, debouncedSearch, refreshKey],
  );

  const refresh = () => setRefreshKey((k) => k + 1);
  const rows = (data || []).map((r) => ({ ...r, id: r.id || r._id }));

  return (
    <div className="space-y-4">
      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load the KYC queue</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <Card
          title="Vendor KYC review"
          subtitle="A payout can only be approved once the vendor’s KYC is approved and the bank destination is verified."
          bodyClassName="p-0!"
          actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
        >
          {error && data && (
            <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">
              Refresh failed — showing the last loaded queue. {errMsg(error)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9!" placeholder="Search vendor or slug…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select className="w-48!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              {STATUSES.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </Select>
          </div>

          <Table
            loading={loading && !data}
            data={rows}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={ShieldCheck} title="No KYC rows" message="Vendors appear here after submitting their payout KYC." />}
            columns={[
              { key: 'vendor', header: 'Vendor', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">{r.vendor?.businessName || 'Unnamed vendor'}</p>
                  <p className="text-[11px] text-slate-400">@{r.vendor?.slug || '—'}</p>
                </div>
              ) },
              { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs text-slate-600">{r.kyc?.gstin || r.vendor?.gstin || '—'}</span> },
              { key: 'account', header: 'Destination', render: (r) => (
                <div className="text-xs text-slate-600">
                  <p className="font-mono">{r.maskedAccount || r.vpa || '—'}</p>
                  <p className="text-[11px] text-slate-400">{r.method || ''} {r.bankName || ''}</p>
                </div>
              ) },
              { key: 'verification', header: 'Bank', render: (r) => <Badge tone={bankMeta(r.verification?.status).tone}>{bankMeta(r.verification?.status).label}</Badge> },
              { key: 'kyc', header: 'KYC', render: (r) => <Badge tone={kycMeta(r.kyc?.status).tone} dot>{kycMeta(r.kyc?.status).label}</Badge> },
              { key: 'gate', header: 'Payout gate', render: (r) => <Badge tone={r.payable ? 'emerald' : 'rose'}>{r.payable ? 'Payable' : 'Blocked'}</Badge> },
              { key: 'reviewedAt', header: 'Reviewed', render: (r) => <span className="text-xs text-slate-500">{r.kyc?.reviewedAt ? fmtDateTime(r.kyc.reviewedAt) : '—'}</span> },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <KycDetail row={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
    </div>
  );
}

function KycDetail({ row, onClose, onChanged }) {
  const { busy, run } = useAction();
  const [decision, setDecision] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const submit = async () => {
    if (decision === 'rejected' && rejectionReason.trim().length < 3) {
      toast.error('A rejection reason is required');
      return;
    }
    try {
      await run(() => api.payouts.admin.reviewKyc(row.vendorId, {
        status: decision === 'approved' ? 'approved' : 'rejected',
        rejectionReason: decision === 'rejected' ? rejectionReason.trim() : null,
      }));
      toast.success(`KYC ${decision === 'approved' ? 'approved' : 'rejected'} — payout gate updated`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const pending = row.kyc?.status === 'pending';

  return (
    <Modal
      open
      onClose={onClose}
      title={row.vendor?.businessName || 'Vendor'}
      subtitle={`@${row.vendor?.slug || '—'} · ${row.kyc?.gstin || row.vendor?.gstin || 'no GSTIN'}`}
      size="lg"
      footer={
        decision ? (
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => { setDecision(null); setRejectionReason(''); }}>Back</Button>
            <Button variant={decision === 'approved' ? 'success' : 'danger'} loading={busy} onClick={submit} disabled={decision === 'rejected' && rejectionReason.trim().length < 3}>
              {decision === 'approved' ? 'Approve KYC' : 'Reject KYC'}
            </Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between">
            <p className="text-xs text-slate-400">KYC approval opens the payout gate for this vendor.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              {pending && (
                <>
                  <Button variant="danger" icon={XCircle} onClick={() => setDecision('rejected')}>Reject</Button>
                  <Button variant="success" icon={BadgeCheck} onClick={() => setDecision('approved')}>Approve</Button>
                </>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Info label="Vendor status" value={row.vendor?.status || '—'} />
          <Info label="City" value={row.vendor?.city || '—'} />
          <Info label="Joined" value={row.vendor?.joinedAt ? fmtDate(row.vendor.joinedAt) : '—'} />
          <Info label="Payout gate" value={row.payable ? 'Payable' : 'Blocked'} />
        </div>

        <section className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-800">Bank destination</p>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Info label="Method" value={row.method || '—'} />
            <Info label="Holder" value={row.accountHolderName || '—'} />
            <Info label="Account" value={row.maskedAccount || row.vpa || '—'} mono />
            <Info label="IFSC" value={row.ifsc || '—'} mono />
            <Info label="Bank" value={row.bankName || '—'} />
            <Info label="Verification" value={bankMeta(row.verification?.status).label} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">KYC package</p>
            <Badge tone={kycMeta(row.kyc?.status).tone} dot>{kycMeta(row.kyc?.status).label}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Info label="PAN" value={row.kyc?.pan || '—'} mono />
            <Info label="GSTIN" value={row.kyc?.gstin || '—'} mono />
            <Info label="Frozen until" value={row.frozenUntil ? fmtDate(row.frozenUntil) : '—'} />
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase text-slate-400">Documents</p>
            {(row.kyc?.documents || []).length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.kyc.documents.map((d) => <Badge key={String(d)} tone="slate" className="font-mono">{String(d).slice(0, 12)}…</Badge>)}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">No document references.</p>
            )}
          </div>
          {row.kyc?.rejectionReason && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Previous rejection: {row.kyc.rejectionReason}
            </p>
          )}
        </section>

        {decision === 'rejected' && (
          <div>
            <Field label="Rejection reason" required hint="Required — recorded on the account and available to the vendor.">
              <Textarea maxLength={300} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="PAN is blurry / GSTIN does not match the business…" />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
