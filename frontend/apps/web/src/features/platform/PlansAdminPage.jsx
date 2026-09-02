import { useState } from 'react';
import { Gem, Pencil, Plus } from 'lucide-react';
import { bpsToPct, inr, titleCase } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const blank = () => ({
  code: '',
  name: '',
  description: '',
  priceMonthly: '',
  commissionRateBps: '100',
  trialDays: '14',
  sortOrder: '10',
  isActive: true,
  maxHubs: '1',
  maxProducts: '50',
  maxStaff: '3',
  marketplaceEnabled: false,
});

export default function PlansAdminPage() {
  const { data, loading, refetch } = useApi(() => api.marketplace.adminPlans(), []);
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(null); // null | 'new' | plan object

  const open = (plan) => {
    setEditing(
      plan
        ? {
            id: plan.id,
            code: plan.code,
            name: plan.name,
            description: plan.description || '',
            priceMonthly: plan.priceMonthly,
            commissionRateBps: plan.commissionRateBps,
            trialDays: plan.trialDays ?? 0,
            sortOrder: plan.sortOrder ?? 10,
            isActive: plan.isActive !== false,
            maxHubs: plan.features?.maxHubs ?? 1,
            maxProducts: plan.features?.maxProducts ?? 50,
            maxStaff: plan.features?.maxStaff ?? 3,
            marketplaceEnabled: Boolean(plan.features?.marketplaceEnabled),
          }
        : blank()
    );
  };

  const save = async (e) => {
    e.preventDefault();
    if (!editing) return;
    const body = {
      name: editing.name,
      description: editing.description || null,
      priceMonthly: Number(editing.priceMonthly),
      commissionRateBps: Number(editing.commissionRateBps),
      trialDays: Number(editing.trialDays) || 0,
      sortOrder: Number(editing.sortOrder) || 10,
      isActive: editing.isActive,
      features: {
        maxHubs: Number(editing.maxHubs) || 1,
        maxProducts: Number(editing.maxProducts) || 50,
        maxStaff: Number(editing.maxStaff) || 3,
        marketplaceEnabled: editing.marketplaceEnabled,
      },
    };
    try {
      if (editing.id) {
        await run(() => api.marketplace.updatePlan(editing.id, body));
        toast.success('Plan updated');
      } else {
        await run(() => api.marketplace.createPlan({ ...body, code: editing.code }));
        toast.success('Plan created');
      }
      setEditing(null);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Plans"
        description="The plan catalog is data — pricing and commissions are admin-editable."
        actions={<Button icon={Plus} onClick={() => open(null)}>New plan</Button>}
      />

      <Card bodyClassName="p-0!">
        <Table
          loading={loading && !data}
          data={data || []}
          empty={<EmptyState icon={Gem} title="No plans" message="Create your first plan." />}
          columns={[
            { key: 'code', header: 'Plan', render: (r) => (
              <div>
                <p className="font-semibold text-slate-800">{titleCase(r.name || r.code)}</p>
                <p className="font-mono text-[11px] text-slate-400">{r.code}</p>
              </div>
            ) },
            { key: 'price', header: 'Price', render: (r) => <span className="font-semibold text-slate-800">{inr(r.priceMonthly)}<span className="text-xs text-slate-400">/mo</span></span> },
            { key: 'commission', header: 'Commission', render: (r) => <span className="font-mono text-xs">{bpsToPct(r.commissionRateBps)}</span> },
            { key: 'trial', header: 'Trial', render: (r) => r.trialDays ? `${r.trialDays}d` : '—' },
            { key: 'features', header: 'Features', render: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.features?.marketplaceEnabled && <Badge tone="violet">marketplace</Badge>}
                <Badge tone="slate">hubs {r.features?.maxHubs ?? 1}</Badge>
                <Badge tone="slate">products {r.features?.maxProducts ?? 50}</Badge>
              </div>
            ) },
            { key: 'isActive', header: 'Status', render: (r) => <Badge tone={r.isActive === false ? 'slate' : 'emerald'}>{r.isActive === false ? 'Inactive' : 'Active'}</Badge> },
            { key: 'edit', header: '', align: 'right', render: (r) => (
              <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); open(r); }}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            ) },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && editing.code ? `Edit plan · ${editing.code}` : 'New plan'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={busy} onClick={save}>Save plan</Button>
          </>
        }
      >
        {editing ? (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" required hint="unique slug, e.g. pro">
                <Input required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase() })} />
              </Field>
              <Field label="Name" required>
                <Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Price ₹/mo" required><Input type="number" required min={0} value={editing.priceMonthly} onChange={(e) => setEditing({ ...editing, priceMonthly: e.target.value })} /></Field>
              <Field label="Commission bps" required hint="100 = 1%"><Input type="number" required min={0} value={editing.commissionRateBps} onChange={(e) => setEditing({ ...editing, commissionRateBps: e.target.value })} /></Field>
              <Field label="Trial days"><Input type="number" min={0} value={editing.trialDays} onChange={(e) => setEditing({ ...editing, trialDays: e.target.value })} /></Field>
              <Field label="Sort order"><Input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Max hubs"><Input type="number" min={1} value={editing.maxHubs} onChange={(e) => setEditing({ ...editing, maxHubs: e.target.value })} /></Field>
              <Field label="Max products"><Input type="number" min={1} value={editing.maxProducts} onChange={(e) => setEditing({ ...editing, maxProducts: e.target.value })} /></Field>
              <Field label="Max staff"><Input type="number" min={1} value={editing.maxStaff} onChange={(e) => setEditing({ ...editing, maxStaff: e.target.value })} /></Field>
            </div>
            <div className="flex items-center gap-5 pt-1">
              <Checkbox label="Marketplace mode (vendor routing)" checked={editing.marketplaceEnabled} onChange={(e) => setEditing({ ...editing, marketplaceEnabled: e.target.checked })} />
              <Checkbox label="Active" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
            </div>
          </form>
        ) : (
          <LoadingBlock />
        )}
      </Modal>
    </div>
  );
}
