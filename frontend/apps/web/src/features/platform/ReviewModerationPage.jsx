import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../api.js';
import Button from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { showToast } from '../../components/ui/Toast.jsx';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

function StarRating({ rating }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} className={`w-4 h-4 ${i <= rating ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export default function ReviewModerationPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: 'all' });
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-reviews', filters],
    queryFn: () => api.get('/admin/reviews', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.post(`/admin/reviews/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-reviews']);
      showToast('Review approved', 'success');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/admin/reviews/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-reviews']);
      showToast('Review rejected', 'success');
      setRejectModal(null);
      setRejectReason('');
    },
  });

  const items = data?.items || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Moderation</h1>
          <p className="text-sm text-gray-500 mt-1">
            {meta.pending || 0} reviews awaiting moderation
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'rejected'].map((s) => (
          <button
            key={s}
            onClick={() => setFilters({ ...filters, status: s, page: 1 })}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize transition-colors ${
              filters.status === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
            {s === 'pending' && meta.pending > 0 && (
              <span className="ml-1.5 bg-yellow-400 text-yellow-900 text-xs px-1.5 py-0.5 rounded-full">
                {meta.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Reviews list */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white rounded-xl p-5 border border-gray-200">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-16 bg-gray-200 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600">Failed to load reviews</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-lg">No reviews found</p>
          <p className="text-gray-400 text-sm mt-1">
            {filters.status === 'pending' ? 'All caught up!' : 'Try changing filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(review.userId?.name || 'U')[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {review.userId?.name || review.userId?.profile?.firstName || 'Anonymous'}
                        </span>
                        <Badge className={STATUS_COLORS[review.status] || STATUS_COLORS.pending}>
                          {review.status}
                        </Badge>
                        {review.isVerifiedPurchase && (
                          <Badge className="bg-blue-100 text-blue-700">Verified Purchase</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StarRating rating={review.rating} />
                        <span className="text-xs text-gray-400">
                          for {review.tenantProductId?.name || 'Product'}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Content */}
                  {review.title && (
                    <h4 className="font-medium text-gray-800 mt-2">{review.title}</h4>
                  )}
                  {review.body && (
                    <p className="text-gray-600 text-sm mt-1 whitespace-pre-wrap">{review.body}</p>
                  )}

                  {/* Rejection reason */}
                  {review.status === 'rejected' && review.rejectionReason && (
                    <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
                      Rejection reason: {review.rejectionReason}
                    </div>
                  )}

                  {/* Actions */}
                  {review.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(review.id)}
                        disabled={approveMutation.isLoading}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        ✓ Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejectModal(review)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        ✕ Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
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

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reject Review</h3>
            <p className="text-sm text-gray-500 mb-3">
              Optionally provide a reason for rejection:
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none h-24 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => { setRejectModal(null); setRejectReason(''); }}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, reason: rejectReason })}
                disabled={rejectMutation.isLoading}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
