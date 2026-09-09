import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api.js';
import Button from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { showToast } from '../../components/ui/Toast.jsx';

/**
 * LocationManagementPage — tree view of the location hierarchy.
 *
 * Locations form a tree: Country → State → City → Area → Pincode.
 * Each node can have children, and delivery zones reference leaf nodes.
 */
export default function LocationManagementPage() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(new Set());
  const [addModal, setAddModal] = useState(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('area');

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locations-tree'],
    queryFn: () => api.get('/admin/hubs').then((r) => {
      // Build tree from flat list
      const items = r.data?.data || r.data?.items || [];
      return buildTree(items);
    }),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/admin/locations', data),
    onSuccess: () => {
      queryClient.invalidateQueries(['locations-tree']);
      showToast('Location created', 'success');
      setAddModal(null);
      setNewName('');
    },
  });

  const toggle = (id) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Location Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage the geographic hierarchy: states, cities, areas, pincodes
          </p>
        </div>
        <Button onClick={() => setAddModal({ parentId: null })}>+ Add Root Location</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" style={{ marginLeft: `${(i % 4) * 24}px` }} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TreeNode
            nodes={locations || []}
            expanded={expanded}
            toggle={toggle}
            onAdd={(parentId) => setAddModal({ parentId })}
            depth={0}
          />
          {(!locations || locations.length === 0) && (
            <div className="p-8 text-center text-gray-400">
              No locations configured. Add a root location to start building the hierarchy.
            </div>
          )}
        </div>
      )}

      {/* Add modal */}
      {addModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Add Location</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Visakhapatnam"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="state">State</option>
                  <option value="city">City</option>
                  <option value="area">Area</option>
                  <option value="pincode">Pincode</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => { setAddModal(null); setNewName(''); }}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({ name: newName, type: newType, parentId: addModal.parentId })}
                disabled={!newName.trim() || createMutation.isLoading}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TreeNode({ nodes, expanded, toggle, onAdd, depth }) {
  if (!nodes?.length) return null;

  const typeColors = {
    state: 'bg-blue-100 text-blue-700',
    city: 'bg-green-100 text-green-700',
    area: 'bg-purple-100 text-purple-700',
    pincode: 'bg-orange-100 text-orange-700',
  };

  return (
    <ul className={depth > 0 ? 'ml-6 border-l border-gray-200 pl-3' : ''}>
      {nodes.map((node) => (
        <li key={node.id || node._id} className="py-1">
          <div className="flex items-center gap-2 group">
            {node.children?.length > 0 ? (
              <button
                onClick={() => toggle(node.id || node._id)}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
              >
                {expanded.has(node.id || node._id) ? '▼' : '▶'}
              </button>
            ) : (
              <span className="w-5 h-5 flex items-center justify-center text-gray-300">•</span>
            )}
            <span className="text-sm text-gray-800 font-medium">{node.name}</span>
            {node.type && (
              <Badge className={`${typeColors[node.type] || 'bg-gray-100 text-gray-600'} text-xs`}>
                {node.type}
              </Badge>
            )}
            {node.code && (
              <span className="text-xs text-gray-400 font-mono">{node.code}</span>
            )}
            <button
              onClick={() => onAdd(node.id || node._id)}
              className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:text-blue-800 transition-opacity"
            >
              + Add child
            </button>
          </div>
          {expanded.has(node.id || node._id) && node.children?.length > 0 && (
            <TreeNode
              nodes={node.children}
              expanded={expanded}
              toggle={toggle}
              onAdd={onAdd}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Build a tree from flat location list. */
function buildTree(items) {
  const map = new Map();
  const roots = [];

  for (const item of items) {
    const id = String(item.id || item._id);
    map.set(id, { ...item, id, children: [] });
  }

  for (const item of map.values()) {
    const pid = String(item.parentId || '');
    if (pid && map.has(pid)) {
      map.get(pid).children.push(item);
    } else {
      roots.push(item);
    }
  }

  return roots;
}
