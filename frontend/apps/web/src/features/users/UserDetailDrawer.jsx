import { useState } from 'react';
import { Ban, ShieldCheck, UserRoundCog } from 'lucide-react';
import { fmtDateTime, inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { USER_ROLE_META, USER_STATUS_META, simpleName, phoneDisplay } from './userMeta.js';

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function UserDetailDrawer({ userId, currentUserId, onClose, onChanged }) {
  const action = useAction();
  const [statusConfirm, setStatusConfirm] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [roleConfirm, setRoleConfirm] = useState(false);
  const [nextRole, setNextRole] = useState('');
  const { data, loading, error, refetch } = useApi(() => api.admin.user(userId), [userId]);

  if (loading && !data) return <Modal open onClose={onClose} title="Customer" size="lg"><LoadingBlock /></Modal>;
  if (error) return <Modal open onClose={onClose} title="Customer" size="lg"><p className="text-sm text-rose-600">{errMsg(error)}</p></Modal>;

  const user = data?.user || {};
  const isSelf = String(user.id || user._id) === String(currentUserId);
  const staffRole = ['admin', 'picker', 'rider'].includes(user.role);
  const roleMeta = pickMeta(USER_ROLE_META, user.role);
  const statusMeta = pickMeta(USER_STATUS_META, user.status);

  const run = async (fn, msg) => {
    try {
      await action.run(fn);
      toast.success(msg);
      await refetch();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const changeStatus = () => {
    setStatusConfirm(false);
    run(() => api.admin.setUserStatus(user.id || user._id, { status: nextStatus }), `User status → ${nextStatus}`);
  };
  const changeRole = () => {
    setRoleConfirm(false);
    run(() => api.admin.setUserRole(user.id || user._id, { role: nextRole }), `User role → ${nextRole}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={simpleName(user) || user.email?.address || user.phone?.number || userId}
      subtitle={user.createdAt ? `Joined ${fmtDateTime(user.createdAt)}` : `ID ${user.id || user._id}`}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Role" value={<Badge tone={roleMeta.tone} dot>{roleMeta.label}</Badge>} />
          <Tile label="Status" value={<Badge tone={statusMeta.tone} dot>{statusMeta.label}</Badge>} />
          <Tile label="Orders" value={data?.orderSummary?.orders ?? 0} sub={`GMV ${inr(data?.orderSummary?.gmv)}`} />
          <Tile label="Wallet" value={data?.wallet ? inr(data.wallet.balance ?? 0) : '—'} sub="refundable balance" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Contact</p>
            <p className="text-sm font-medium text-slate-800">{simpleName(user) || 'Unnamed'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {phoneDisplay(user) || 'No phone'} {user.email?.address ? ` · ${user.email.address}` : ''}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Login methods {user.loginMethods?.length ? user.loginMethods.join(', ') : 'none'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Location</p>
            <p className="text-sm font-medium text-slate-800">{user.location?.pincode || '—'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {user.location?.cityId || 'No city'} · {user.location?.stateId || 'No state'}
            </p>
          </div>
        </div>

        <div>
          <p className="label mb-2">Addresses</p>
          <div className="space-y-2">
            {(data?.addresses || []).map((a) => (
              <div key={a.id || a._id} className="rounded-xl border border-slate-100 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{a.type || a.tag || 'Address'}</span>
                  {a.isDefault && <Badge tone="sky">Default</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
                  {a.city ? `, ${a.city}` : ''}{a.pincode ? ` · ${a.pincode}` : ''}
                </p>
              </div>
            ))}
            {!data?.addresses?.length && <p className="text-sm text-slate-400">No saved addresses.</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 p-4">
            <p className="label mb-2">Recent orders</p>
            <div className="space-y-2">
              {(data?.recentOrders || []).slice(0, 6).map((o) => (
                <div key={o.id || o._id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-600">{o.orderNumber || o.id}</span>
                  <span className="font-semibold text-slate-800">{inr(o.totalAmount)} <span className="text-slate-400">· {o.status}</span></span>
                </div>
              ))}
              {!data?.recentOrders?.length && <p className="text-xs text-slate-400">No orders yet.</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <p className="label mb-2">Recent returns</p>
            <div className="space-y-2">
              {(data?.recentReturns || []).slice(0, 6).map((r2) => (
                <div key={r2.id || r2._id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-600">{r2.id || r2._id}</span>
                  <span className="text-slate-500">{r2.claimType || r2.status}</span>
                </div>
              ))}
              {!data?.recentReturns?.length && <p className="text-xs text-slate-400">No returns yet.</p>}
            </div>
          </div>
        </div>

        {staffRole && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Staff actions</p>
            {isSelf ? (
              <p className="text-xs text-slate-400">You cannot change your own role or status.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">Change role</p>
                  <div className="mt-1 flex gap-2">
                    <Select className="flex-1" value={nextRole} onChange={(e) => setNextRole(e.target.value)}>
                      {['customer', 'admin', 'picker', 'rider'].map((r) => <option key={r} value={r}>{pickMeta(USER_ROLE_META, r).label}</option>)}
                    </Select>
                    <Button variant="secondary" size="sm" icon={UserRoundCog} loading={action.busy} disabled={!nextRole} onClick={() => setRoleConfirm(true)}>Save</Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Change status</p>
                  <div className="mt-1 flex gap-2">
                    <Select className="flex-1" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                      {['active', 'blocked', 'inactive', 'verification_pending'].map((s) => <option key={s} value={s}>{pickMeta(USER_STATUS_META, s).label}</option>)}
                    </Select>
                    <Button variant="secondary" size="sm" icon={Ban} loading={action.busy} disabled={!nextStatus} onClick={() => setStatusConfirm(true)}>Save</Button>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Super admins cannot be modified from this screen, and no role can be promoted to super_admin.</span>
            </div>
          </div>
        )}
      </div>

      {statusConfirm && (
        <Modal open onClose={() => setStatusConfirm(false)} title="Confirm status change" size="sm">
          <p className="text-sm text-slate-600">
            Set <span className="font-medium">{simpleName(user)}</span> to{' '}
            <Badge tone={pickMeta(USER_STATUS_META, nextStatus).tone} dot>{pickMeta(USER_STATUS_META, nextStatus).label}</Badge>?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStatusConfirm(false)}>Cancel</Button>
            <Button variant="danger" icon={Ban} loading={action.busy} onClick={changeStatus}>Confirm</Button>
          </div>
        </Modal>
      )}

      {roleConfirm && (
        <Modal open onClose={() => setRoleConfirm(false)} title="Confirm role change" size="sm">
          <p className="text-sm text-slate-600">
            Assign <span className="font-medium">{simpleName(user)}</span> as{' '}
            <Badge tone={pickMeta(USER_ROLE_META, nextRole).tone} dot>{pickMeta(USER_ROLE_META, nextRole).label}</Badge>?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleConfirm(false)}>Cancel</Button>
            <Button variant="primary" icon={UserRoundCog} loading={action.busy} onClick={changeRole}>Confirm</Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
