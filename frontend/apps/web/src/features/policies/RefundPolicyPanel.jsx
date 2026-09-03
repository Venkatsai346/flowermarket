import { useEffect, useState } from 'react';
import { WalletCards } from 'lucide-react';
import { pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { REFUND_FEE_POLICY_META } from './policiesMeta.js';

export default function RefundPolicyPanel({ policy, onChanged }) {
  const action = useAction();
  const [when, setWhen] = useState(policy?.refundDeliveryFeeWhen || 'full_order_return_only');
  const [pct, setPct] = useState(policy?.refundFeePct ?? 100);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setWhen(policy?.refundDeliveryFeeWhen || 'full_order_return_only');
    setPct(policy?.refundFeePct ?? 100);
    setDirty(false);
  }, [policy]);

  const submit = async () => {
    try {
      await action.run(() => api.policies.updateRefund({ refundDeliveryFeeWhen: when, refundFeePct: Number(pct) }));
      toast.success('Refund policy updated');
      setDirty(false);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card title="Refund policy" subtitle="Whether the delivery fee is refunded when an order is returned.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Refund delivery fee when" required>
          <Select value={when} onChange={(e) => { setWhen(e.target.value); setDirty(true); }}>
            {Object.entries(REFUND_FEE_POLICY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Fee refund %" required hint="How much of the delivery fee is refunded.">
          <Input
            type="number"
            min="0"
            max="100"
            step="1"
            value={pct}
            onChange={(e) => { setPct(e.target.value); setDirty(true); }}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <Badge tone={pickMeta(REFUND_FEE_POLICY_META, when).tone} dot>{pickMeta(REFUND_FEE_POLICY_META, when).label}</Badge>
        <span>Applies to future return calculations · {pct}% of fee</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={WalletCards} loading={action.busy} disabled={!dirty} onClick={submit}>
          Save refund policy
        </Button>
        {!dirty && <span className="text-xs text-slate-400">No unsaved changes</span>}
      </div>
    </Card>
  );
}
