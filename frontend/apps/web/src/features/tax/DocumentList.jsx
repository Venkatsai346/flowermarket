import { useState } from 'react';
import { Eye, FilePlus2, ReceiptText, RefreshCw, Search } from 'lucide-react';
import { fmtDateTime, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { toast } from '../../lib/toasts.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import DocumentDetailDrawer from './DocumentDetailDrawer.jsx';
import CancelDocumentModal from './CancelDocumentModal.jsx';
import IssueInvoiceModal from './IssueInvoiceModal.jsx';
import CreditNoteModal from './CreditNoteModal.jsx';
import { EINVOICE_STATUS_META, TAX_DOC_STATUS_META, TAX_DOC_TYPE_META } from './taxMeta.js';

export default function DocumentList({ refreshKey = 0 }) {
  const [page, setPage] = useState(1);
  const [docType, setDocType] = useState('');
  const [status, setStatus] = useState('');
  const [orderId, setOrderId] = useState('');
  const [selected, setSelected] = useState(null);
  const [cancelDoc, setCancelDoc] = useState(null);
  const [issueInvoice, setIssueInvoice] = useState(false);
  const [creditNote, setCreditNote] = useState(false);

  const { data, meta, loading, refetch } = useApi(
    () => api.tax.documents({
      page,
      limit: 15,
      docType: docType || undefined,
      status: status || undefined,
      orderId: orderId || undefined,
    }),
    [page, docType, status, orderId, refreshKey],
  );

  return (
    <div>
      <Card
        title="Tax documents"
        subtitle="Invoices and credit notes as they were issued — never re-priced."
        actions={
          <>
            <Button variant="secondary" icon={ReceiptText} onClick={() => setCreditNote(true)}>Issue credit note</Button>
            <Button variant="primary" icon={FilePlus2} onClick={() => setIssueInvoice(true)}>Issue invoice</Button>
          </>
        }
        bodyClassName="p-0!"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9!" placeholder="Filter by order id…" value={orderId} onChange={(e) => { setOrderId(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-44!" value={docType} onChange={(e) => { setDocType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {Object.entries(TAX_DOC_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
          <Select className="w-44!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(TAX_DOC_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </Select>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refetch}>Refresh</Button>
        </div>

        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id || r._id)}
          empty={<EmptyState icon={FilePlus2} title="No tax documents" message="Issue an invoice to start the document series." />}
          columns={[
            { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs font-semibold text-slate-800">{r.number || '—'}</span> },
            { key: 'docType', header: 'Type', render: (r) => <Badge tone={pickMeta(TAX_DOC_TYPE_META, r.docType).tone}>{pickMeta(TAX_DOC_TYPE_META, r.docType).label}</Badge> },
            { key: 'fyLabel', header: 'FY', render: (r) => <span className="font-mono text-xs">{r.fyLabel || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(TAX_DOC_STATUS_META, r.status).tone} dot>{pickMeta(TAX_DOC_STATUS_META, r.status).label}</Badge> },
            { key: 'einvoice', header: 'e-Invoice', render: (r) => {
              const e = r.einvoice || {};
              const m = pickMeta(EINVOICE_STATUS_META, e.status);
              return <Badge tone={m.tone}>{m.label}</Badge>;
            } },
            { key: 'grandTotal', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.totalsRupees?.grandTotal)}</span> },
            { key: 'issuedAt', header: 'Issued', render: (r) => (r.issuedAt ? fmtDateTime(r.issuedAt) : '—') },
            { key: 'actions', header: '', align: 'right', render: (r) => (
              <div className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" icon={Eye} aria-label="View" onClick={(e) => { e.stopPropagation(); setSelected(r.id || r._id); }}>View</Button>
                {r.status === 'issued' && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setCancelDoc(r); }}>Cancel</Button>
                )}
              </div>
            ) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {selected && <DocumentDetailDrawer documentId={selected} onClose={() => setSelected(null)} onChanged={refetch} />}
      {cancelDoc && <CancelDocumentModal document={cancelDoc} onClose={() => { setCancelDoc(null); refetch(); }} />}
      {issueInvoice && <IssueInvoiceModal onClose={() => { setIssueInvoice(false); refetch(); }} />}
      {creditNote && <CreditNoteModal onClose={() => { setCreditNote(false); refetch(); }} />}
    </div>
  );
}
