import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../api.js';
import Button from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';

export default function DemandForecastPage() {
  const [method, setMethod] = useState('weighted');
  const [weeks, setWeeks] = useState(12);
  const [forecastWeeks, setForecastWeeks] = useState(4);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['demand-forecast', method, weeks, forecastWeeks],
    queryFn: () => api.get('/admin/phase74/demand/forecast', {
      params: { method, weeks, forecastWeeks },
    }).then((r) => r.data?.data),
  });

  const forecasts = data?.forecasts || [];
  const meta = data?.meta || {};
  const reorderAlerts = forecasts.filter((f) => f.reorderNeeded);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Demand Forecasting</h1>
          <p className="text-sm text-gray-500 mt-1">
            Inventory demand prediction based on historical order data
          </p>
        </div>
        <Button onClick={() => refetch()} variant="secondary">↻ Refresh</Button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="simple">Simple Average</option>
              <option value="weighted">Weighted Average</option>
              <option value="trend">Trend-Adjusted</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">History (weeks)</label>
            <input
              type="number"
              min={4}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-20 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Forecast (weeks)</label>
            <input
              type="number"
              min={1}
              max={12}
              value={forecastWeeks}
              onChange={(e) => setForecastWeeks(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-20 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={() => refetch()}>Generate</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Products Analyzed</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{meta.productsAnalyzed || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Reorder Alerts</div>
          <div className={`text-2xl font-bold mt-1 ${reorderAlerts.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {reorderAlerts.length}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Method</div>
          <div className="text-2xl font-bold text-gray-900 mt-1 capitalize">{method}</div>
        </div>
      </div>

      {/* Reorder alerts */}
      {reorderAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-2">⚠️ Reorder Alerts</h3>
          <div className="space-y-2">
            {reorderAlerts.slice(0, 5).map((alert) => (
              <div key={alert.productId} className="flex items-center justify-between text-sm">
                <span className="text-red-700">
                  {alert.productName} — {alert.weeksOfStock !== null ? `${alert.weeksOfStock}w stock` : 'No stock'}
                </span>
                <span className="font-medium text-red-800">
                  Reorder {alert.reorderQty} units
                </span>
              </div>
            ))}
            {reorderAlerts.length > 5 && (
              <p className="text-xs text-red-600">+{reorderAlerts.length - 5} more alerts</p>
            )}
          </div>
        </div>
      )}

      {/* Forecast table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white rounded-xl p-4 border border-gray-200">
              <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Stock</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Avg/Week</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Forecast</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Weeks Left</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">Trend</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forecasts.map((f) => (
                  <tr key={f.productId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{f.productName}</div>
                      {f.sku && <div className="text-xs text-gray-400">{f.sku}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{f.currentStock}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{f.avgWeeklyDemand}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{f.forecastTotalDemand}</td>
                    <td className="px-4 py-3 text-right">
                      {f.weeksOfStock !== null ? (
                        <span className={f.weeksOfStock <= 2 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          {f.weeksOfStock}w
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {f.trend === 'growing' && <span className="text-green-600">📈</span>}
                      {f.trend === 'declining' && <span className="text-red-600">📉</span>}
                      {f.trend === 'flat' && <span className="text-gray-400">→</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {f.reorderNeeded ? (
                        <Badge className="bg-red-100 text-red-700">Reorder</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-700">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {forecasts.length === 0 && (
            <div className="p-8 text-center text-gray-400">
              No forecast data available. Try adjusting parameters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
