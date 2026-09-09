import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import Button from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import { showToast } from '../ui/Toast.jsx';

/**
 * BankStatementIngestionPage — upload and reconcile bank statement CSVs.
 *
 * Flow:
 *   1. Upload CSV file (or paste text)
 *   2. Parse and preview lines
 *   3. Ingest into BankStatementLine collection
 *   4. Reconcile against payout batches
 */
export default function BankStatementIngestionPage() {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [statementRef, setStatementRef] = useState('');
  const [file, setFile] = useState(null);

  const { data: lines, isLoading } = useQuery({
    queryKey: ['bank-statement-lines'],
    queryFn: () => api.get('/payouts/admin/bank-statement-lines', { params: { limit: 100 } })
      .then((r) => r.data?.items || r.data?.data?.items || []),
  });

  const ingestMutation = useMutation({
    mutationFn: async () => {
      let content = csvText;
      if (file) {
        content = await file.text();
      }
      if (!content.trim()) throw new Error('No CSV data provided');

      const parsed = parseCSV(content);
      return api.post('/payouts/admin/bank-statement/ingest', {
        ref: statementRef || `upload-${Date.now()}`,
        lines: parsed,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries(['bank-statement-lines']);
      const count = res.data?.data?.ingested || res.data?.ingested || 0;
      showToast(`Ingested ${count} bank statement lines`, 'success');
      setCsvText('');
      setFile(null);
    },
    onError: (err) => {
      showToast(err.message || 'Ingestion failed', 'error');
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bank Statement Ingestion</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload bank statement CSVs to reconcile against payout batches
        </p>
      </div>

      {/* Upload form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Upload Statement</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Statement Reference
            </label>
            <input
              type="text"
              value={statementRef}
              onChange={(e) => setStatementRef(e.target.value)}
              placeholder="e.g. HDFC-Sep-2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload CSV File
            </label>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Or paste CSV data
          </label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={`Date,Narration,Debit,Credit,Balance\n2026-09-01,NEFT from Razorpay,,50000,150000\n2026-09-02,Payout to vendor,10000,,140000`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono h-32 resize-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <Button
          onClick={() => ingestMutation.mutate()}
          disabled={ingestMutation.isLoading || (!csvText.trim() && !file)}
        >
          {ingestMutation.isLoading ? 'Ingesting...' : 'Ingest Statement'}
        </Button>
      </div>

      {/* Existing lines */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Statement Lines</h2>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : lines?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Narration</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Debit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Credit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Balance</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, i) => (
                  <tr key={line.id || i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{line.date || line.txnDate || '—'}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs truncate">{line.narration || line.description || '—'}</td>
                    <td className="px-4 py-3 text-right text-red-600">{line.debit ? `₹${line.debit}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-green-600">{line.credit ? `₹${line.credit}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{line.balance ? `₹${line.balance}` : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={line.reconciled ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                        {line.reconciled ? 'Reconciled' : 'Pending'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-400">
            No bank statement lines uploaded yet
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple CSV parser — handles comma-separated with quoted fields. */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j] || ''; });
    rows.push({
      date: row.date || row.txndate || row.valuedate || '',
      narration: row.narration || row.description || row.remarks || '',
      debit: parseFloat(row.debit || row.withdrawal || '0') || 0,
      credit: parseFloat(row.credit || row.deposit || '0') || 0,
      balance: parseFloat(row.balance || row.closingbalance || '0') || 0,
      ref: row.ref || row.referencenumber || row.chequeno || '',
    });
  }
  return rows;
}
