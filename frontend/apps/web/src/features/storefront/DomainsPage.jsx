import { useState } from 'react';
import {
  BadgeCheck, Copy, Globe, Loader2, Plus, RefreshCw, ShieldCheck, Star, Trash2, TriangleAlert,
} from 'lucide-react';
import { fmtDate } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const VERIFY_META = {
  pending: { label: 'Awaiting DNS', tone: 'amber' },
  verified: { label: 'Verified', tone: 'emerald' },
  failed: { label: 'Check failed', tone: 'rose' },
};
const TLS_META = {
  none: { label: 'No certificate', tone: 'slate' },
  provisioning: { label: 'Issuing certificate', tone: 'amber' },
  active: { label: 'HTTPS active', tone: 'emerald' },
  failed: { label: 'Certificate failed', tone: 'rose' },
};

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-0.5 flex w-full items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-left font-mono text-xs text-slate-700 transition hover:bg-slate-100"
      >
        <span className="truncate">{value}</span>
        {copied ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
      </button>
    </div>
  );
}

function AddDomainModal({ onClose, onAdded }) {
  const [hostname, setHostname] = useState('');
  const { busy, run } = useAction();
  const go = async () => {
    try {
      const r = await run(() => api.domains.add(hostname.trim().toLowerCase()));
      toast.success('Domain added — publish the DNS record, then verify');
      onAdded?.(r.data);
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a custom domain"
      subtitle="You will prove ownership with a DNS record before it goes live."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} icon={Plus} disabled={hostname.trim().length < 4} onClick={go}>Add domain</Button>
        </>
      )}
    >
      <Field label="Domain" hint="For example shop.yourbrand.com — without https://">
        <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="shop.yourbrand.com" />
      </Field>
      <p className="mt-3 text-xs text-slate-500">
        Your domain resolves to nothing until verification passes. That protects both of us: an unverified
        domain could otherwise point someone else&apos;s traffic at your store.
      </p>
    </Modal>
  );
}

export default function DomainsPage() {
  const { data, loading, refetch } = useApi(() => api.domains.list(), []);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState('');

  const domains = data?.items || [];

  const verify = async (id) => {
    setChecking(id);
    try {
      const r = await run(() => api.domains.verify(id));
      if (r.data?.verified || r.data?.alreadyVerified) toast.success('Domain verified');
      else toast.error(r.message || 'Not verified yet');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setChecking('');
    }
  };

  const act = async (kind, id) => {
    try {
      if (kind === 'primary') { await run(() => api.domains.setPrimary(id)); toast.success('Primary domain updated'); }
      else { await run(() => api.domains.remove(id)); toast.success('Domain removed'); }
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Where customers reach your storefront."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add domain</Button>}
      />

      <Card className="mb-5" title="Your platform address" subtitle="Always available, HTTPS included, nothing to configure.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={data?.platformSubdomain || '#'}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 font-mono text-sm font-medium text-rose-600 hover:underline"
          >
            <Globe className="h-4 w-4" />
            {data?.platformSubdomain || '—'}
          </a>
          <Badge tone="emerald"><ShieldCheck className="h-3 w-3" />Covered by the wildcard certificate</Badge>
        </div>
      </Card>

      {loading && !data ? (
        <Card><p className="py-6 text-sm text-slate-400">Loading…</p></Card>
      ) : domains.length === 0 ? (
        <Card bodyClassName="p-0!">
          <EmptyState
            icon={Globe}
            title="No custom domains yet"
            message="Add your own domain to serve the storefront from your brand instead of a platform subdomain."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {domains.map((d) => {
            const v = VERIFY_META[d.verification?.status] || VERIFY_META.pending;
            const t = TLS_META[d.tls?.status] || TLS_META.none;
            const verified = d.verification?.status === 'verified';
            return (
              <Card key={d.id} bodyClassName="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-mono text-sm font-semibold text-slate-800">
                      <Globe className="h-4 w-4 text-slate-400" />
                      {d.hostname}
                      {d.isPrimary && <Badge tone="violet"><Star className="h-3 w-3" />Primary</Badge>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={v.tone}>{v.label}</Badge>
                      <Badge tone={t.tone}>{t.label}</Badge>
                      {d.verification?.verifiedAt && (
                        <span className="text-[11px] text-slate-400">since {fmtDate(d.verification.verifiedAt)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!verified && (
                      <Button
                        variant="secondary"
                        icon={checking === d.id ? Loader2 : RefreshCw}
                        loading={checking === d.id}
                        onClick={() => verify(d.id)}
                      >
                        Check DNS
                      </Button>
                    )}
                    {verified && !d.isPrimary && (
                      <Button variant="secondary" icon={Star} loading={busy} onClick={() => act('primary', d.id)}>
                        Make primary
                      </Button>
                    )}
                    <Button variant="ghost" icon={Trash2} loading={busy} onClick={() => act('remove', d.id)}>
                      Remove
                    </Button>
                  </div>
                </div>

                {!verified && d.dnsRecord && (
                  <div className={cn(
                    'space-y-3 rounded-xl border px-4 py-3',
                    d.verification?.status === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
                  )}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <TriangleAlert className="h-4 w-4 text-amber-600" />
                      Add this record at your DNS provider, then press “Check DNS”.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <CopyField label="Type" value={d.dnsRecord.type} />
                      <CopyField label="Name" value={d.dnsRecord.name} />
                      <CopyField label="Value" value={d.dnsRecord.value} />
                    </div>
                    {d.verification?.lastError && (
                      <p className="text-xs text-rose-700">
                        Last check: {d.verification.lastError}
                        {d.verification.lastCheckedAt ? ` (${fmtDate(d.verification.lastCheckedAt)})` : ''}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      DNS can take a few minutes to propagate — up to an hour on some providers.
                    </p>
                  </div>
                )}

                {verified && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    Point your domain at the platform with a CNAME to{' '}
                    <span className="font-mono text-slate-800">{data?.platformSubdomain?.replace(/^https?:\/\//, '') || 'your platform subdomain'}</span>.
                    A certificate is issued automatically on the first request.
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {adding && <AddDomainModal onClose={() => setAdding(false)} onAdded={refetch} />}
    </div>
  );
}
