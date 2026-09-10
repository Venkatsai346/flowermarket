import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { FIX_ROUTE } from './onboardingFixes.js';
import VerifyEmailAction from './VerifyEmailAction.jsx';

/**
 * Renders a STORE_NOT_READY answer as a way forward instead of a dead end.
 *
 * Any page with a publish control can hit it (the server is the enforcer, not
 * the button's `disabled` prop — a slot window can expire between fetch and
 * click). The panel lists what blocks checkout, links each gap to the page
 * that fixes it, verifies the owner email INLINE, and points at the full
 * launch checklist on the dashboard. The merchant is never left holding a
 * toast and a question.
 */
export default function PublishBlockedPanel({ reasons = [], blocking = [], onResolved }) {
  const emailBlocked = blocking.includes('ownerEmail');
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/60 px-5 py-4" role="alert">
      <p className="flex items-center gap-2 text-sm font-semibold text-rose-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        This store cannot take orders yet
      </p>
      {reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-800">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {blocking
          .filter((id) => id !== 'ownerEmail' && FIX_ROUTE[id])
          .map((id) => (
            <Link
              key={id}
              to={FIX_ROUTE[id].to}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
            >
              {FIX_ROUTE[id].label}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ))}
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800"
        >
          Open the launch checklist
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      {emailBlocked && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 pt-3">
          <p className="text-xs text-rose-800">
            Prove the owner email is yours — we will send a code to it now.
          </p>
          <VerifyEmailAction onVerified={onResolved} />
        </div>
      )}
    </div>
  );
}
