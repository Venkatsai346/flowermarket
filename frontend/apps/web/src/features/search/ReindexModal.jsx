import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Checkbox } from '../../components/ui/Field.jsx';

export default function ReindexModal({ onClose }) {
  const action = useAction();
  const role = useAuthStore((s) => s.user?.role);
  const [allTenants, setAllTenants] = useState(false);
  const [result, setResult] = useState(null);
  const isSuperAdmin = role === 'super_admin';

  const submit = async () => {
    setResult(null);
    try {
      const r = await action.run(() => api.search.reindex({ allTenants: allTenants ? true : undefined }));
      setResult(r.data || {});
      toast.success('Reindex complete');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Run reindex"
      subtitle="Rebuild the search index from the active catalogue."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={RefreshCw} loading={action.busy} onClick={submit}>
            {result ? 'Reindex again' : 'Run reindex'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Search is served from an index, not live catalogue queries. This job scans listings, builds
          documents and writes them back. Large catalogues can take a few minutes.
        </p>
        {isSuperAdmin && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Checkbox
              label="Platform-wide reindex"
              checked={allTenants}
              onChange={(e) => setAllTenants(e.target.checked)}
            />
            <p className="mt-1.5 text-xs text-amber-700">Super admin only — this rebuilds every store’s index.</p>
          </div>
        )}
        {!isSuperAdmin && (
          <p className="text-xs text-slate-400">Super admin accounts can additionally reindex the whole platform.</p>
        )}
        {result && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs">
            <p className="font-semibold text-emerald-700">Job summary</p>
            <p className="mt-1 text-emerald-600">
              {Number(result.scanned) || 0} scanned · {Number(result.indexed) || 0} indexed · {Number(result.batches) || 0} batches
              {result.lastId ? ` · last id ${String(result.lastId).slice(-8)}` : ''}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
