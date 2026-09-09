import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field } from '../../components/ui/Field.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { MapPin, Plus, Trash2, Edit2 } from 'lucide-react';

/**
 * Delivery Zone Management — define geographic zones for delivery pricing and availability.
 */
export default function DeliveryZonesPage() {
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, refetch } = useApi(
    () => api.admin.hubs(),
    [],
  );

  const items = data?.items || data || [];

  const [form, setForm] = useState({ name: '', pincodes: '', priority: 0, isActive: true });

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: '', pincodes: '', priority: 0, isActive: true });
    setEditOpen(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      name: item.name || '',
      pincodes: (item.pincodes || []).join(', '),
      priority: item.priority || 0,
      isActive: item.isActive !== false,
    });
    setEditOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        pincodes: form.pincodes.split(',').map((p) => p.trim()).filter(Boolean),
        priority: Number(form.priority),
        isActive: form.isActive,
      };
      if (editItem) {
        await api.admin.updateHub(editItem.id || editItem._id, payload);
      } else {
        await api.admin.createHub(payload);
      }
      setEditOpen(false);
      refetch();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this delivery zone?')) return;
    try {
      await api.admin.toggleHub(id);
      refetch();
    } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery Zones"
        subtitle="Define geographic zones for delivery pricing and availability."
        actions={<Button size="sm" icon={Plus} onClick={openCreate}>New Zone</Button>}
      />

      <Card>
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState icon={MapPin} title="No delivery zones" message="Create a zone to define delivery areas." />
        ) : (
          <Table
            columns={[
              { key: 'name', label: 'Zone Name', width: '160px' },
              { key: 'pincodes', label: 'Pincodes', render: (v) => (
                <div className="flex flex-wrap gap-1">
                  {(v || []).slice(0, 5).map((p) => <Badge key={p} color="sky">{p}</Badge>)}
                  {(v || []).length > 5 && <Badge color="slate">+{(v || []).length - 5} more</Badge>}
                </div>
              )},
              { key: 'priority', label: 'Priority', width: '80px' },
              { key: 'isActive', label: 'Active', width: '80px', render: (v) => <Badge color={v !== false ? 'emerald' : 'slate'}>{v !== false ? 'Yes' : 'No'}</Badge> },
              {
                key: 'actions',
                label: '',
                width: '80px',
                render: (_, row) => (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(row.id || row._id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ),
              },
            ]}
            rows={items}
          />
        )}
      </Card>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editItem ? 'Edit Zone' : 'New Zone'}>
        <div className="space-y-4 p-4">
          <Field label="Zone Name" required>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="e.g. Hyderabad Central" />
          </Field>
          <Field label="Pincodes" help="Comma-separated list of delivery pincodes">
            <textarea value={form.pincodes} onChange={(e) => setForm({ ...form, pincodes: e.target.value })} className="input min-h-[80px] resize-y font-mono" placeholder="500001, 500002, 500003" />
          </Field>
          <Field label="Priority">
            <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input" min="0" />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
            <span className="text-sm text-slate-700">Active</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={save}>{editItem ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
