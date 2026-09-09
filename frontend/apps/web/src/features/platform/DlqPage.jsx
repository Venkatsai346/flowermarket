import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api.js';
import Button from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { showToast } from '../../components/ui/Toast.jsx';

export default function DlqPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const [selectedEvent, setSelectedEvent] = useState(null);

  const { data: stats } = useQuery({
    queryKey: ['dlq-stats'],
    queryFn: () => api.get('/admin/phase74/dlq/stats').then((r) => r.data?.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dlq-list', filters],
    queryFn: () => api.get('/admin/phase74/dlq', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });

  const requeueMutation = useMutation({
    mutationFn: (eventId) => api.post(`/admin/phase74/dlq/${eventId}/requeue`),
    onSuccess: () => {
      queryClient.invalidateQueries(['dlq-list']);
      queryClient.invalidateQueries(['dlq-stats']);
      showToast('Event requeued for retry', 'success');
    },
  });

  const bulkRequeueMutation = useMutation({
    mutationFn: () => api.post('/admin/phase74/dlq/bulk-requeue', {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['dlq-list']);
      queryClient.invalidateQueries(['dlq-stats']);
      showToast(`Requeued ${res.data?.data?.requeued || 0} events`, 'success');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (olderThanDays) => api.post('/admin/phase74/dlq/purge', { olderThanDays }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['dlq-list']);
      queryClient.invalidateQueries(['dlq-stats']);
      showToast(`Purged ${res.data?.data?.purged || 0} old entries`, 'success');
    },
  });

  const items = data?.items || [];
  const meta = data?.meta || {};

  const formatAge = (ms) => {
    if (!ms) return '—';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dead Letter Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Failed outbox events awaiting manual intervention
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => bulkRequeueMutation.mutate()}
            disabled={bulkRequeueMutation.isLoading || !stats?.depth}
          >
            ↻ Requeue All
          </Button>
          <Button
            variant="secondary"
            className="text-red-600 hover:bg-red-50"
            onClick={() => {
              if (confirm('Purge DLQ entries older than 30 days?')) {
                purgeMutation.mutate(30);
              }
            }}
          >
            🗑 Purge Old
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">DLQ Depth</div>
          <div className={`text-2xl font-bold mt-1 ${(stats?.depth || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {stats?.depth || 0}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Oldest Entry</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {formatAge(stats?.oldestAgeMs)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Event Types</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {Object.keys(stats?.byEventType || {}).length}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Top Error</div>
          <div className="text-sm font-medium text-gray-900 mt-1 truncate">
            {stats?.topErrors?.[0]?.message || 'None'}
          </div>
        </div>
      </div>

      {/* Error categories */}
      {stats?.topErrors?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Top Error Categories</h3>
          <div className="space-y-2">
            {stats.topErrors.slice(0, 5).map((err, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 truncate flex-1 mr-4">{err.message}</span>
                <Badge className="bg-red-100 text-red-700">{err.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DLQ entries */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white rounded-xl p-4 border border-gray-200">
              <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-500 text-lg">DLQ is empty</p>
          <p className="text-gray-400 text-sm mt-1">No failed events in the queue</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Event Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Entity</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Error</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Retries</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Badge className="bg-purple-100 text-purple-700">{event.eventType}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {event.entityType}/{String(event.entityId).slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                      {event.lastError || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{event.retryCount || 0}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setSelectedEvent(event)}>
                          View
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => requeueMutation.mutate(event.id)}
                          disabled={requeueMutation.isLoading}
                        >
                          ↻ Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-gray-900">Event Details</h3>
              <button onClick={() => setSelectedEvent(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-gray-500">ID</dt><dd className="font-mono">{selectedEvent.id}</dd></div>
              <div><dt className="text-gray-500">Event Type</dt><dd>{selectedEvent.eventType}</dd></div>
              <div><dt className="text-gray-500">Entity</dt><dd>{selectedEvent.entityType}/{selectedEvent.entityId}</dd></div>
              <div><dt className="text-gray-500">Tenant</dt><dd className="font-mono">{selectedEvent.tenantId}</dd></div>
              <div><dt className="text-gray-500">Status</dt><dd>{selectedEvent.status}</dd></div>
              <div><dt className="text-gray-500">Retries</dt><dd>{selectedEvent.retryCount || 0}</dd></div>
              <div><dt className="text-gray-500">Last Error</dt><dd className="text-red-600">{selectedEvent.lastError || '—'}</dd></div>
              <div><dt className="text-gray-500">Payload</dt><dd><pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto">{JSON.stringify(selectedEvent.payload, null, 2)}</pre></dd></div>
              <div><dt className="text-gray-500">Created</dt><dd>{new Date(selectedEvent.createdAt).toLocaleString()}</dd></div>
            </dl>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => setSelectedEvent(null)}>Close</Button>
              <Button onClick={() => { requeueMutation.mutate(selectedEvent.id); setSelectedEvent(null); }}>
                ↻ Requeue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={filters.page <= 1}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          >
            Previous
          </Button>
          <span className="px-3 py-1.5 text-sm text-gray-500">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!meta.hasMore}
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
