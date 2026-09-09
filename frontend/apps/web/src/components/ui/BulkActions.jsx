/**
 * BulkActions — reusable bulk action toolbar for list pages.
 *
 * Shows a floating bar when items are selected, with action buttons.
 *
 * Usage:
 *   <BulkActions
 *     selected={selectedIds}
 *     onClear={() => setSelected(new Set())}
 *     actions={[
 *       { label: 'Approve', onClick: (ids) => approveAll(ids), color: 'green' },
 *       { label: 'Delete', onClick: (ids) => deleteAll(ids), color: 'red', confirm: true },
 *     ]}
 *   />
 */

import { useState } from 'react';
import Button from './Button.jsx';

export default function BulkActions({ selected = [], onClear, actions = [] }) {
  const [confirmAction, setConfirmAction] = useState(null);

  if (!selected.length) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
      <div className="bg-gray-900 text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
        <span className="text-sm font-medium">
          {selected.length} selected
        </span>

        <div className="h-5 w-px bg-gray-600" />

        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => {
              if (action.confirm && !confirmAction) {
                setConfirmAction(action);
                return;
              }
              action.onClick(selected);
              setConfirmAction(null);
              onClear?.();
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              confirmAction === action
                ? 'bg-red-600 text-white'
                : action.color === 'red'
                  ? 'text-red-300 hover:text-red-200 hover:bg-red-900/30'
                  : action.color === 'green'
                    ? 'text-green-300 hover:text-green-200 hover:bg-green-900/30'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            {confirmAction === action ? `Confirm ${action.label}?` : action.label}
          </button>
        ))}

        <div className="h-5 w-px bg-gray-600" />

        <button
          onClick={() => { onClear?.(); setConfirmAction(null); }}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          ✕ Clear
        </button>
      </div>
    </div>
  );
}
