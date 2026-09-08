import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Empty } from '../components/ui.jsx';
import { errMsg } from '../lib/utils.js';

/**
 * Profile — name, chrome language, marketing consent.
 * Identity (phone) is OTP and is not editable here. PATCH /users/me.
 */
export default function Account() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const updateUser = useShopAuth((s) => s.updateUser);
  const openAuth = useShop((s) => s.openAuth);
  const toast = useShop((s) => s.toast);
  const setLanguage = useShop((s) => s.setLanguage);

  const { data, loading, refetch } = useApi(
    () => (isAuth ? api.shop.me() : Promise.resolve({ data: null })),
    [isAuth],
  );

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) {
      setForm(null);
      return;
    }
    setForm({
      firstName: data.profile?.firstName || '',
      lastName: data.profile?.lastName || '',
      language: data.preferences?.language === 'te' ? 'te' : 'en',
      marketing: Boolean(data.marketing?.optedIn),
    });
  }, [data]);

  if (!isAuth) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={User}
          title="Sign in to manage your profile"
          message="Name, language and marketing consent live on your account."
          action={<Button onClick={openAuth}>Sign in</Button>}
        />
      </div>
    );
  }

  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (k === 'language') setLanguage(value);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.shop.updateMe({
        profile: { firstName: form.firstName.trim(), lastName: form.lastName.trim() },
        preferences: { language: form.language },
        marketing: { optedIn: form.marketing },
      });
      if (r.data) updateUser(r.data);
      setLanguage(form.language);
      toast('Profile saved', 'success');
      refetch();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const phone = data?.phone?.number
    ? `+${data.phone.countryCode || '91'} ${data.phone.number}`
    : null;

  return (
    <div className="wrap max-w-xl py-8">
      <h1 className="font-display text-3xl tracking-tight text-slate-900">My profile</h1>
      <p className="mt-1 text-sm text-slate-500">
        How we greet you, the language of the shop chrome, and whether we may send offers.
      </p>

      {loading && !form ? (
        <div className="mt-8 space-y-3">
          <div className="skeleton h-12 w-full rounded-2xl" />
          <div className="skeleton h-12 w-full rounded-2xl" />
        </div>
      ) : form ? (
        <form onSubmit={save} className="card mt-6 space-y-5 p-5">
          {phone && (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Signed in as <span className="font-medium text-slate-800">{phone}</span>
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">First name</span>
              <input
                className="input"
                value={form.firstName}
                onChange={set('firstName')}
                autoComplete="given-name"
                maxLength={60}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Last name</span>
              <input
                className="input"
                value={form.lastName}
                onChange={set('lastName')}
                autoComplete="family-name"
                maxLength={60}
              />
            </label>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Language</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['en', 'English'],
                ['te', 'తెలుగు'],
              ].map(([id, label]) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium"
                  style={form.language === id
                    ? { background: 'var(--brand-soft)', boxShadow: '0 0 0 2px var(--brand)', borderColor: 'transparent' }
                    : undefined}
                >
                  <input
                    type="radio"
                    name="language"
                    value={id}
                    checked={form.language === id}
                    onChange={set('language')}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Catalogue titles stay as the florist wrote them. Buttons, search and arrival copy switch.
            </p>
          </fieldset>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.marketing}
              onChange={set('marketing')}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block font-medium">Offers and seasonal notes</span>
              <span className="mt-0.5 block text-xs text-slate-400">
                Occasional SMS or WhatsApp about festivals and restocks. You can turn this off any time.
              </span>
            </span>
          </label>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit" loading={busy}>Save profile</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
