import { useState } from 'react';
import { Download, RefreshCw, UserPlus, Users as UsersIcon } from 'lucide-react';
import { pickMeta, useAuthStore } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { useDownload } from '../../lib/useDownload.js';
import { cn, errMsg } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import UserDetailDrawer from './UserDetailDrawer.jsx';
import CreateStaffModal from './CreateStaffModal.jsx';
import RiderStatsPanel from './RiderStatsPanel.jsx';
import { USER_ROLE_META, USER_STATUS_META, phoneDisplay, simpleName } from './userMeta.js';

export default function UsersPage() {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [tab, setTab] = useState('directory');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [createStaff, setCreateStaff] = useState(false);
  const { busy: exporting, run: download } = useDownload();

  const { data, meta, loading, error, refetch } = useApi(
    () => api.admin.users({
      page,
      limit: 20,
      search: search || undefined,
      role: role || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, search, role, status, from, to, refreshKey],
  );

  const refresh = () => { setRefreshKey((k) => k + 1); };
  const saveUsers = () => download(
    () => api.admin.exportUsers({ search: search || undefined, role: role || undefined, status: status || undefined, from: from || undefined, to: to || undefined }),
    'users.csv',
  );

  const rows = data || [];
  const activeStaff = rows.filter((r) => ['admin', 'picker', 'rider'].includes(r.role) && r.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="Users"
        description="Customers, staff and rider delivery performance."
        actions={
          <>
            {tab === 'directory' && (
              <>
                <Button variant="secondary" icon={Download} loading={exporting} onClick={saveUsers}>{exporting ? 'Preparing…' : 'Export CSV'}</Button>
                <Button variant="primary" icon={UserPlus} onClick={() => setCreateStaff(true)}>Create staff</Button>
              </>
            )}
          </>
        }
      />

      <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {[['directory', 'Directory'], ['riders', 'Rider delivery']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
              tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            <UsersIcon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'riders' ? (
        <RiderStatsPanel />
      ) : error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load users</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <LoadingBlock />
      ) : (
        <Card
          title="Customer & staff directory"
          subtitle={`${meta?.total ?? rows.length} accounts · ${activeStaff} active staff on this page`}
          bodyClassName="p-0!"
        >
          <FilterBar
            search={search}
            onSearch={(v) => { setSearch(v); setPage(1); }}
            searchPlaceholder="Search name, phone or email…"
            selects={[
              { label: 'Role', value: role, options: Object.entries(USER_ROLE_META).map(([v, m]) => [v, m.label]), onChange: (v) => { setRole(v); setPage(1); } },
              { label: 'Status', value: status, options: Object.entries(USER_STATUS_META).map(([v, m]) => [v, m.label]), onChange: (v) => { setStatus(v); setPage(1); } },
            ]}
            from={from}
            to={to}
            onFrom={(v) => { setFrom(v); setPage(1); }}
            onTo={(v) => { setTo(v); setPage(1); }}
            onReset={() => { setSearch(''); setRole(''); setStatus(''); setFrom(''); setTo(''); setPage(1); }}
          />

          <Table
            loading={loading && !data}
            data={rows}
            onRowClick={(r) => setSelected(r.id || r._id)}
            empty={<EmptyState icon={UsersIcon} title="No users found" message="Clear the filters or create a staff account." />}
            columns={[
              { key: 'name', header: 'Name', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">{simpleName(r) || 'Unnamed'}</p>
                  <p className="text-xs text-slate-400">{phoneDisplay(r) || 'no phone'} {r.email?.address ? ` · ${r.email.address}` : ''}</p>
                </div>
              ) },
              { key: 'role', header: 'Role', render: (r) => <Badge tone={pickMeta(USER_ROLE_META, r.role).tone}>{pickMeta(USER_ROLE_META, r.role).label}</Badge> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(USER_STATUS_META, r.status).tone} dot>{pickMeta(USER_STATUS_META, r.status).label}</Badge> },
              { key: 'loginMethods', header: 'Login', render: (r) => <span className="text-xs text-slate-500">{r.loginMethods?.length ? r.loginMethods.join(', ') : '—'}</span> },
              { key: 'createdAt', header: 'Joined', render: (r) => r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : '—' },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && (
        <UserDetailDrawer
          userId={selected}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
      {createStaff && <CreateStaffModal onClose={() => { setCreateStaff(false); refresh(); }} />}
    </div>
  );
}
