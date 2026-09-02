import { useEffect, useState } from 'react';
import { ExternalLink, ImageIcon, Palette, Save } from 'lucide-react';
import { pickMeta, ONBOARDING_META } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import { MEDIA_PURPOSE } from '../../lib/upload.js';
import ImageField from '../../components/media/ImageField.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Textarea } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

export default function BrandingPage() {
  const store = useApi(() => api.marketplace.myStore(), []);
  const { busy, run } = useAction();

  const [form, setForm] = useState(null);

  useEffect(() => {
    if (store.data?.tenant && !form) {
      const t = store.data.tenant;
      setForm({
        name: t.name || '',
        tagline: t.store?.tagline || '',
        description: t.store?.description || '',
        logoUrl: t.logoUrl || '',
        bannerUrl: t.store?.bannerUrl || '',
        instagram: t.store?.socialLinks?.instagram || '',
        facebook: t.store?.socialLinks?.facebook || '',
        website: t.store?.socialLinks?.website || '',
        isPublished: Boolean(t.store?.isPublished),
      });
    }
  }, [store.data, form]);

  const tenant = store.data?.tenant || null;
  const onboarding = tenant?.store?.onboardingStatus;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    try {
      await run(() =>
        api.marketplace.updateStore({
          name: form.name,
          tagline: form.tagline || null,
          description: form.description || null,
          logoUrl: form.logoUrl || null,
          bannerUrl: form.bannerUrl || null,
          socialLinks: {
            instagram: form.instagram || null,
            facebook: form.facebook || null,
            website: form.website || null,
          },
        })
      );
      toast.success('Storefront branding saved');
      store.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const togglePublish = async () => {
    try {
      await run(() => api.marketplace.updateStore({ isPublished: !form.isPublished }));
      toast.success(form.isPublished ? 'Storefront unpublished' : 'Storefront is live! 🎉');
      store.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (store.loading && !store.data) return <LoadingBlock label="Loading your store…" />;

  return (
    <div>
      <PageHeader
        title="Storefront"
        description="Branding shown on your public store page."
        actions={
          <Button
            variant={form?.isPublished ? 'secondary' : 'success'}
            loading={busy}
            onClick={togglePublish}
          >
            {form?.isPublished ? 'Unpublish' : 'Publish storefront'}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Branding" className="lg:col-span-3">
          {form ? (
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store name" required>
                  <Input required value={form.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Tagline">
                  <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Fresh flowers, delivered same day" />
                </Field>
              </div>
              <Field label="Description">
                <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Tell customers what makes your store special…" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField
                  label="Logo"
                  hint="Direct image link or upload (square works best)"
                  purpose={MEDIA_PURPOSE.storeLogo}
                  value={form.logoUrl}
                  onChange={(v) => set('logoUrl', v)}
                />
                <ImageField
                  label="Banner"
                  hint="Wide banner (16:5)"
                  purpose={MEDIA_PURPOSE.storeBanner}
                  value={form.bannerUrl}
                  onChange={(v) => set('bannerUrl', v)}
                />
              </div>
              <div>
                <p className="label">Social links</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="instagram.com/…" />
                  <Input value={form.facebook} onChange={(e) => set('facebook', e.target.value)} placeholder="facebook.com/…" />
                  <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="yourwebsite.in" />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="submit" icon={Save} loading={busy}>Save branding</Button>
              </div>
            </form>
          ) : (
            <LoadingBlock />
          )}
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Status">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Onboarding</span>
              <Badge tone={pickMeta(ONBOARDING_META, onboarding).tone}>
                {pickMeta(ONBOARDING_META, onboarding).label}
              </Badge>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">Published</span>
              <Badge tone={form?.isPublished ? 'emerald' : 'slate'} dot>
                {form?.isPublished ? 'Public' : 'Hidden'}
              </Badge>
            </div>
            {onboarding === 'registered' && (
              <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
                Publish your storefront to flip onboarding to <b>Live</b> and appear in marketplace discovery.
              </p>
            )}
            {tenant?.slug && (
              <a
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700"
                href={`/api/v1/marketplace/stores/${tenant.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View storefront API · /stores/{tenant.slug}
              </a>
            )}
          </Card>

          <Card title="Preview">
            <div
              className="relative overflow-hidden rounded-xl border border-slate-200"
              style={form?.bannerUrl ? { backgroundImage: `url(${form.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'linear-gradient(135deg,#fdf2f6,#fce7ef)' }}
            >
              <div className="flex h-40 flex-col justify-end bg-gradient-to-t from-black/50 to-transparent p-4">
                <p className="text-lg font-bold text-white drop-shadow">{form?.name || 'Your store'}</p>
                {form?.tagline && <p className="text-xs text-white/90">{form.tagline}</p>}
              </div>
              <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-white/80 text-slate-500">
                {form?.logoUrl ? <img src={form.logoUrl} alt="logo" className="h-6 w-6 rounded object-contain" /> : <ImageIcon className="h-4 w-4" />}
              </span>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
              <Palette className="h-3.5 w-3.5" /> Live preview of your public storefront.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
