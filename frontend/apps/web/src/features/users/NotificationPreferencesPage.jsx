import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import Button from '../ui/Button.jsx';
import { showToast } from '../ui/Toast.jsx';

/**
 * NotificationPreferencesPage — per-channel notification toggles.
 *
 * Channels: push, email, SMS
 * Categories: order updates, promotions, system alerts
 */
export default function NotificationPreferencesPage() {
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get('/users/me').then((r) => r.data?.data?.notificationPreferences || r.data?.notificationPreferences || defaultPrefs()),
  });

  const [localPrefs, setLocalPrefs] = useState(null);
  const preferences = localPrefs || prefs || defaultPrefs();

  const saveMutation = useMutation({
    mutationFn: (data) => api.patch('/users/me', { notificationPreferences: data }),
    onSuccess: () => {
      queryClient.invalidateQueries(['notification-preferences']);
      showToast('Preferences saved', 'success');
    },
  });

  const toggle = (category, channel) => {
    const next = { ...preferences };
    if (!next[category]) next[category] = {};
    next[category][channel] = !next[category]?.[channel];
    setLocalPrefs(next);
  };

  const categories = [
    { key: 'orderUpdates', label: 'Order Updates', desc: 'Confirmations, delivery, returns' },
    { key: 'promotions', label: 'Promotions', desc: 'Sales, discounts, new products' },
    { key: 'systemAlerts', label: 'System Alerts', desc: 'Security, account changes' },
    { key: 'paymentUpdates', label: 'Payment Updates', desc: 'Refunds, wallet, billing' },
  ];

  const channels = [
    { key: 'push', label: 'Push', icon: '🔔' },
    { key: 'email', label: 'Email', icon: '✉️' },
    { key: 'sms', label: 'SMS', icon: '💬' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notification Preferences</h1>
        <p className="text-sm text-gray-500 mt-1">Choose how you receive notifications</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-4 gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <div className="text-sm font-medium text-gray-500">Category</div>
          {channels.map((ch) => (
            <div key={ch.key} className="text-sm font-medium text-gray-500 text-center">
              {ch.icon} {ch.label}
            </div>
          ))}
        </div>

        {/* Preference rows */}
        {categories.map((cat) => (
          <div key={cat.key} className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-gray-100 last:border-0">
            <div>
              <div className="text-sm font-medium text-gray-800">{cat.label}</div>
              <div className="text-xs text-gray-400">{cat.desc}</div>
            </div>
            {channels.map((ch) => (
              <div key={ch.key} className="flex justify-center">
                <ToggleSwitch
                  checked={preferences[cat.key]?.[ch.key] !== false}
                  onChange={() => toggle(cat.key, ch.key)}
                  disabled={isLoading}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(preferences)}
          disabled={saveMutation.isLoading}
        >
          {saveMutation.isLoading ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function defaultPrefs() {
  return {
    orderUpdates: { push: true, email: true, sms: true },
    promotions: { push: true, email: false, sms: false },
    systemAlerts: { push: true, email: true, sms: false },
    paymentUpdates: { push: true, email: true, sms: false },
  };
}
