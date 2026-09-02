import { useEffect, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Building2, CheckCircle2, FileCheck2, Landmark,
  Lock, Save, ShieldCheck, Smartphone,
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
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { KYC_META, BANK_META } from './payoutMeta.js';

/**
 * The three things that must all be true before a vendor can be paid.
 * Showing them as an explicit checklist is deliberate: "why haven't I been
 * paid?" is the single most common vendor question, and the answer is almost
 * always one of these three rows.
 */
function ReadinessChecklist({ account }) {
  const now = Date.now();
  const frozen = account?.frozenUntil && new Date(account.frozenUntil).getTime() > now;
  const steps = [
    {
      label: 'Bank account verified',
      done: account?.verification?.status === 'verified',
      detail: account?.verification?.status === 'verified'
        ? `Verified ${fmtDate(account.verification.verifiedAt)}`
        : 'Run verification below — we send a ₹1 test credit and match the name',
    },
    {
      label: 'KYC approved',
      done: account?.kyc?.status === 'approved',
      detail: account?.kyc?.status === 'rejected'
        ? `Rejected: ${account.kyc.rejectionReason || 'see support'}`
        : account?.kyc?.status === 'pending'
          ? 'Submitted — under review by the platform'
          : 'Submit your PAN and GSTIN below',
    },
    {
      label: 'No security hold',
      done: !frozen,
      detail: frozen
        ? `Payouts resume ${fmtDate(account.frozenUntil)} — a 24-hour hold applies after any change of bank details`
        : 'No hold in place',
    },
  ];

  const ready = steps.every((s) => s.done);

  return (
    <Card
      title="Payout readiness"
      subtitle={ready ? 'You are eligible to receive payouts.' : 'Complete these before your next cycle.'}
      className={cn(ready ? 'ring-1 ring-emerald-200' : 'ring-1 ring-amber-200')}
    >
      <ul className="space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            {s.done
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
            <div className="text-sm">
              <p className={cn('font-medium', s.done ? 'text-slate-800' : 'text-slate-900')}>{s.label}</p>
              <p className="text-xs text-slate-500">{s.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function VendorPayoutAccountPage() {
  const { data: account, loading, refetch } = useApi(() => api.payouts.me.account(), []);
  const { busy, run } = useAction();

  const [form, setForm] = useState({
    method: 'upi', accountHolderName: '', accountNumber: '', ifsc: '', vpa: '', bankName: '',
  });
  const [kyc, setKyc] = useState({ pan: '', gstin: '' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!account) return;
    setForm((f) => ({
      ...f,
      method: account.method || 'upi',
      accountHolderName: account.accountHolderName || '',
      ifsc: account.ifsc || '',
      vpa: account.vpa || '',
      bankName: account.bankName || '',
      accountNumber: '', // never sent back by the API — re-entered on change
    }));
    setKyc({ pan: account.kyc?.pan || '', gstin: account.kyc?.gstin || '' });
  }, [account]);

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  const save = async () => {
    try {
      const body = form.method === 'upi'
        ? { method: 'upi', accountHolderName: form.accountHolderName, vpa: form.vpa }
        : {
          method: 'bank',
          accountHolderName: form.accountHolderName,
          accountNumber: form.accountNumber,
          ifsc: form.ifsc.toUpperCase(),
          bankName: form.bankName || undefined,
        };
      const r = await run(() => api.payouts.me.saveAccount(body));
      toast.success(r.message || 'Saved');
      setDirty(false);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const verify = async () => {
    try {
      await run(() => api.payouts.me.verifyAccount());
      toast.success('Account verified');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const submitKyc = async () => {
    try {
      await run(() => api.payouts.me.submitKyc({
        pan: kyc.pan.toUpperCase(),
        gstin: kyc.gstin ? kyc.gstin.toUpperCase() : undefined,
      }));
      toast.success('KYC submitted for review');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const bankTone = BANK_META[account?.verification?.status]?.tone || 'slate';
  const kycTone = KYC_META[account?.kyc?.status]?.tone || 'slate';

  return (
    <div>
      <PageHeader
        title="Payout account"
        description="Where your earnings are sent, and the checks that unlock them."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card
            title="Destination"
            subtitle="Changing these details re-triggers verification and pauses payouts for 24 hours."
            actions={<Badge tone={bankTone}>{BANK_META[account?.verification?.status]?.label || 'Unverified'}</Badge>}
          >
            {loading && !account ? (
              <p className="py-6 text-sm text-slate-400">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Method">
                    <Select value={form.method} onChange={(e) => set('method', e.target.value)}>
                      <option value="upi">UPI</option>
                      <option value="bank">Bank account</option>
                    </Select>
                  </Field>
                  <Field label="Account holder name" required hint="Must match your bank records">
                    <Input value={form.accountHolderName} onChange={(e) => set('accountHolderName', e.target.value)} placeholder="Rose Farms LLP" />
                  </Field>
                </div>

                {form.method === 'upi' ? (
                  <Field label="UPI ID" required>
                    <Input value={form.vpa} onChange={(e) => set('vpa', e.target.value)} placeholder="rosefarms@okhdfcbank" />
                  </Field>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Account number"
                      required
                      hint={account?.maskedAccount ? `Currently ${account.maskedAccount} — re-enter to change` : 'Stored encrypted; never shown again'}
                    >
                      <Input value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} placeholder="••••••••8901" />
                    </Field>
                    <Field label="IFSC" required>
                      <Input value={form.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" maxLength={11} />
                    </Field>
                    <Field label="Bank name">
                      <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="HDFC Bank" />
                    </Field>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <p>
                    Your account number is encrypted at rest and never returned by the API — only the last four digits
                    are ever displayed. Any change starts a 24-hour payout hold, which protects you if your account
                    is ever compromised.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {account && account.verification?.status !== 'verified' && (
                    <Button variant="secondary" icon={ShieldCheck} loading={busy} onClick={verify}>
                      Verify account
                    </Button>
                  )}
                  <Button icon={Save} loading={busy} disabled={!dirty && Boolean(account)} onClick={save}>
                    Save destination
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card
            title="KYC"
            subtitle="Required by law before we can disburse funds."
            actions={<Badge tone={kycTone}>{KYC_META[account?.kyc?.status]?.label || 'Not submitted'}</Badge>}
          >
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PAN" required>
                  <Input value={kyc.pan} onChange={(e) => setKyc({ ...kyc, pan: e.target.value.toUpperCase() })} placeholder="AADCB2230M" maxLength={10} />
                </Field>
                <Field label="GSTIN" hint="Optional if you are unregistered">
                  <Input value={kyc.gstin} onChange={(e) => setKyc({ ...kyc, gstin: e.target.value.toUpperCase() })} placeholder="37AADCB2230M1ZS" maxLength={15} />
                </Field>
              </div>
              {account?.kyc?.status === 'rejected' && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <p className="font-semibold">KYC was rejected</p>
                  <p className="text-rose-700">{account.kyc.rejectionReason || 'Please correct your details and resubmit.'}</p>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  icon={FileCheck2}
                  loading={busy}
                  disabled={kyc.pan.length !== 10 || account?.kyc?.status === 'approved'}
                  onClick={submitKyc}
                >
                  {account?.kyc?.status === 'approved' ? 'Approved' : 'Submit for review'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <ReadinessChecklist account={account} />

          <Card title="How payouts work">
            <ol className="space-y-3 text-sm text-slate-600">
              {[
                [Building2, 'You sell', 'Your earnings are recorded the moment an order is confirmed.'],
                [Smartphone, 'The return window passes', '7 days for most items, 1 day for perishables.'],
                [Landmark, 'A cycle is computed', 'Cleared earnings are grouped into a payout batch, net of commission and taxes.'],
                [BadgeCheck, 'The platform approves', 'A person reviews every transfer before it is sent.'],
              ].map(([Icon, title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[11px] font-bold text-rose-600">
                    {i + 1}
                  </span>
                  <div>
                    <p className="flex items-center gap-1.5 font-medium text-slate-800">
                      <Icon className="h-3.5 w-3.5 text-slate-400" />{title}
                    </p>
                    <p className="text-xs text-slate-500">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
