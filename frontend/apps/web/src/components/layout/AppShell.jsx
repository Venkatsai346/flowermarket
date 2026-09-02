import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import Toaster from '../ui/Toaster.jsx';

export default function AppShell() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <footer className="border-t border-slate-200/70 px-6 py-3 text-center text-xs text-slate-400">
          Flower Market · Console · v0.1
        </footer>
      </div>
      <Toaster />
    </div>
  );
}
