import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import Button from '../../components/ui/Button.jsx';

export default function NoAccessPage() {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">No console access</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Your account role is <b>{role || 'unknown'}</b>. The admin console is for platform
          operators, store owners and vendors. Customer shopping comes with the storefront app.
        </p>
        <Link to="/login" className="mt-5 inline-block">
          <Button variant="secondary">Back to sign in</Button>
        </Link>
      </div>
    </div>
  );
}
