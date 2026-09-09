import { useState, useRef } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { fmtDate, inr } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Settlement Ingestion UI — upload bank settlement CSVs to reconcile payouts.
 * Super admin can upload a CSV from Razorpay/Cashfree and the system matches
 * settlement entries against pending payout batches.
 */
export default function SettlementIngestionPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const { data, loading } = useApi(() => api.payouts.admin.settlements({ limit: 50 }), []);

  const items = data?.items || data || [];

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const text = await file.text();
      const rows = text.split('\n').filter(Boolean);
      const r = await api.payouts.admin.ingestSettlements({ rows, filename: file.name });
      setResult({ success: true, message: `Ingested ${r.data?.matched ?? 0} settlements`, data: r.data });
    } catch (err) {
      setResult({ success: false, message: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement Ingestion"
        subtitle="Upload bank settlement CSVs to reconcile pending payouts."
      />

      {/* Upload card */}
      <Card title="Upload Settlement CSV">
        <div className="flex flex-col items-start gap-4 p-4">
          <p className="text-sm text-slate-600">
            Upload a CSV from your payment gateway (Razorpay, Cashfree, or bank statement).
            The system will match settlement entries against pending payout batches.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-6 py-4 text-sm font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-600">
            <Upload className="h-5 w-5" />
            {uploading ? 'Uploading…' : 'Choose CSV file'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>

          {result && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {result.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {result.message}
            </div>
          )}
        </div>
      </Card>

      {/* Recent settlements */}
      <Card title="Recent Settlements">
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No settlements yet" message="Upload a settlement CSV to get started." />
        ) : (
          <Table
            columns={[
              { key: 'utr', label: 'UTR / Reference', width: '160px', mono: true },
              { key: 'amount', label: 'Amount', width: '120px', render: (v) => inr(v) },
              { key: 'settledAt', label: 'Settled', width: '120px', render: (v) => fmtDate(v) },
              { key: 'matched', label: 'Matched', width: '100px', render: (v) => v ? <Badge color="emerald">Yes</Badge> : <Badge color="amber">Pending</Badge> },
              { key: 'payoutBatchId', label: 'Batch', width: '120px', mono: true, render: (v) => v ? String(v).slice(0, 8) + '…' : '—' },
              { key: 'source', label: 'Source', width: '100px', render: (v) => v || '—' },
            ]}
            rows={items}
          />
        )}
      </Card>
    </div>
  );
}
