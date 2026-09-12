import { NavLink, useNavigate } from 'react-router-dom';
import { Flower2, LogOut } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { ROLE_META, initials, titleCase } from '@flower-market/shared';
import { cn } from '../../lib/utils.js';
import { GROUPS, groupsForRole, itemsForRole } from '../../lib/nav.js';
import Badge from '../ui/Badge.jsx';

function SidebarNav() {
  const role = useAuthStore((s) => s.user?.role);
  const groups = groupsForRole(role);

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {GROUPS[g].label}
          </p>
          <div className="space-y-0.5">
            {itemsForRole(role, g).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const roleMeta = ROLE_META[user?.role] || { label: 'User', tone: 'slate' };

  const logout = () => {
    clear();
    navigate('/login');
  };

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-600 text-white">
          <Flower2 className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-bold text-white">Flower Market</p>
          <p className="text-[11px] text-slate-400">Admin console</p>
        </div>
      </div>
      <SidebarNav />
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-xs font-bold text-white">
            {initials(user?.profile?.firstName || user?.email?.address || user?.phone?.number)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold text-white">
              {titleCase(user?.profile?.firstName || '')}{' '}
              {titleCase(user?.profile?.lastName || '')}
            </p>
            <Badge tone={roleMeta.tone} className="mt-0.5 px-1.5! py-0! text-[10px]!">
              {roleMeta.label}
            </Badge>
          </div>
          <button className="text-slate-400 transition hover:text-white" onClick={logout} title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
