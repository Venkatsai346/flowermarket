import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ExternalLink, ImageIcon, Megaphone,
  Palette, Plus, Save, Trash2,
} from 'lucide-react';
import { pickMeta, ONBOARDING_META, BRAND_KITS, BRAND_KIT_IDS } from '@flower-market/shared';
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
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import PublishBlockedPanel from '../dashboard/PublishBlockedPanel.jsx';

/**
 * Highlight icon names. The storefront maps these to line icons and falls
 * back to a sparkle for anything unknown — keep this list in sync with
 * `StoreHighlights.jsx` in the storefront app.
 */
const ICON_OPTIONS = [
  ['sparkles', 'Sparkles'], ['truck', 'Delivery truck'], ['leaf', 'Leaf / fresh'],
  ['shield', 'Shield / guarantee'], ['award', 'Award'], ['medal', 'Medal'],
  ['gem', 'Gem / premium'], ['heart', 'Heart'], ['star', 'Star'],
  ['thumbsup', 'Thumbs up'], ['badge', 'Verified badge'], ['store', 'Store'],
  ['package', 'Package'], ['clock', 'Clock / timing'], ['headset', 'Support headset'],
  ['chat', 'Chat'], ['pin', 'Location pin'], ['zap', 'Fast'], ['refresh', 'Easy returns'],
  ['flower', 'Flower'], ['bag', 'Shopping bag'],
];

const blankSlide = () => ({
  imageUrl: '', mobileImageUrl: '', title: '', subtitle: '',
  ctaLabel: '', ctaLink: '', isActive: true,
});
const blankHighlight = () => ({ icon: 'sparkles', title: '', text: '' });
const blankTestimonial = () => ({ name: '', text: '', rating: 5, avatarUrl: '' });
const nullish = (v) => (v === '' || v === undefined ? null : v);

function fromTenant(t) {
  const s = t.store || {};
  return {
    name: t.name || '',
    tagline: s.tagline || '',
    description: s.description || '',
    logoUrl: t.logoUrl || '',
    bannerUrl: s.bannerUrl || '',
    kit: t.theme?.kit || 'rose',
    instagram: s.socialLinks?.instagram || '',
    facebook: s.socialLinks?.facebook || '',
    website: s.socialLinks?.website || '',
    youtube: s.socialLinks?.youtube || '',
    x: s.socialLinks?.x || '',
    whatsappSocial: s.socialLinks?.whatsapp || '',
    isPublished: Boolean(s.isPublished),
    announcement: {
      text: s.announcement?.text || '',
      linkUrl: s.announcement?.linkUrl || '',
      isActive: s.announcement?.isActive !== false,
    },
    heroSlides: (s.heroSlides || []).map((x) => ({
      imageUrl: x.imageUrl || '',
      mobileImageUrl: x.mobileImageUrl || '',
      title: x.title || '',
      subtitle: x.subtitle || '',
      ctaLabel: x.ctaLabel || '',
      ctaLink: x.ctaLink || '',
      isActive: x.isActive !== false,
    })),
    about: {
      title: s.about?.title || '',
      content: s.about?.content || '',
      imageUrl: s.about?.imageUrl || '',
      videoUrl: s.about?.videoUrl || '',
    },
    highlights: (s.highlights || []).map((x) => ({
      icon: x.icon || 'sparkles', title: x.title || '', text: x.text || '',
    })),
    testimonials: (s.testimonials || []).map((x) => ({
      name: x.name || '', text: x.text || '',
      rating: x.rating ?? 5, avatarUrl: x.avatarUrl || '',
    })),
    contact: {
      phone: s.contact?.phone || '',
      email: s.contact?.email || '',
      hours: s.contact?.hours || '',
      whatsapp: s.contact?.whatsapp || '',
      mapUrl: s.contact?.mapUrl || '',
      line1: s.contact?.address?.line1 || '',
      line2: s.contact?.address?.line2 || '',
      city: s.contact?.address?.city || '',
      state: s.contact?.address?.state || '',
      pincode: s.contact?.address?.pincode || '',
    },
    seo: {
      title: s.seo?.title || '',
      description: s.seo?.description || '',
    },
    footerText: s.footerText || '',
  };
}

/** Reorderable/deletable row shell for the list editors below. */
function RowShell({ index, total, onMove, onRemove, children, title }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {title} {index + 1}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button" aria-label="Move up" disabled={index === 0}
            onClick={() => onMove(index, -1)}
            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" aria-label="Move down" disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" aria-label="Remove"
            onClick={() => onRemove(index)}
            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

const move = (list, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export default function BrandingPage() {
  const store = useApi(() => api.marketplace.myStore(), []);
  const { busy, run } = useAction();

  const [form, setForm] = useState(null);
  // The last STORE_NOT_READY answer, rendered as a way forward (not a toast
  // the merchant has to decode) until publishing succeeds or they unpublish.
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    if (store.data?.tenant && !form) setForm(fromTenant(store.data.tenant));
  }, [store.data, form]);

  const tenant = store.data?.tenant || null;
  const onboarding = tenant?.store?.onboardingStatus;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setIn = (group, k, v) => setForm((f) => ({ ...f, [group]: { ...f[group], [k]: v } }));

  const saveSlice = async (slice, label) => {
    try {
      await run(() => api.marketplace.updateStore(slice));
      toast.success(label);
      store.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const save = async (e) => {
    e.preventDefault();
    await saveSlice(
      {
        name: form.name,
        tagline: form.tagline || null,
        description: form.description || null,
        logoUrl: form.logoUrl || null,
        bannerUrl: form.bannerUrl || null,
        theme: { kit: form.kit || 'rose' },
        socialLinks: {
          instagram: form.instagram || null,
          facebook: form.facebook || null,
          website: form.website || null,
          youtube: form.youtube || null,
          x: form.x || null,
          whatsapp: form.whatsappSocial || null,
        },
      },
      'Storefront branding saved'
    );
  };

  const saveAnnouncement = () => saveSlice(
    {
      announcement: {
        text: form.announcement.text || null,
        linkUrl: form.announcement.linkUrl || null,
        isActive: form.announcement.isActive,
      },
    },
    'Announcement saved'
  );

  const saveHero = () => {
    const slides = form.heroSlides
      .filter((s) => s.imageUrl.trim())
      .map((s, i) => ({
        imageUrl: s.imageUrl.trim(),
        mobileImageUrl: s.mobileImageUrl || null,
        title: s.title || null,
        subtitle: s.subtitle || null,
        ctaLabel: s.ctaLabel || null,
        ctaLink: s.ctaLink || null,
        sortOrder: i,
        isActive: s.isActive,
      }));
    return saveSlice({ heroSlides: slides }, `Hero carousel saved (${slides.length} slide${slides.length === 1 ? '' : 's'})`);
  };

  const saveAbout = () => saveSlice(
    {
      about: {
        title: form.about.title || null,
        content: form.about.content || null,
        imageUrl: form.about.imageUrl || null,
        videoUrl: form.about.videoUrl || null,
      },
    },
    'Story saved'
  );

  const saveHighlights = () => {
    const highlights = form.highlights
      .filter((h) => h.title.trim())
      .map((h) => ({ icon: h.icon || 'sparkles', title: h.title.trim(), text: h.text || null }));
    return saveSlice({ highlights }, 'Highlights saved');
  };

  const saveTestimonials = () => {
    const testimonials = form.testimonials
      .filter((x) => x.name.trim() && x.text.trim())
      .map((x) => ({
        name: x.name.trim(),
        text: x.text.trim(),
        rating: x.rating == null || x.rating === '' ? null : Number(x.rating),
        avatarUrl: x.avatarUrl || null,
      }));
    return saveSlice({ testimonials }, 'Testimonials saved');
  };

  const saveContact = () => saveSlice(
    {
      contact: {
        phone: form.contact.phone || null,
        email: form.contact.email || null,
        hours: form.contact.hours || null,
        whatsapp: form.contact.whatsapp || null,
        mapUrl: form.contact.mapUrl || null,
        address: {
          line1: form.contact.line1 || null,
          line2: form.contact.line2 || null,
          city: form.contact.city || null,
          state: form.contact.state || null,
          pincode: form.contact.pincode || null,
        },
      },
    },
    'Contact details saved'
  );

  const saveSeo = () => saveSlice(
    {
      seo: {
        title: form.seo.title || null,
        description: form.seo.description || null,
      },
      footerText: form.footerText || null,
    },
    'SEO saved'
  );

  const togglePublish = async () => {
    try {
      await run(() => api.marketplace.updateStore({ isPublished: !form.isPublished }));
      toast.success(form.isPublished ? 'Storefront unpublished' : 'Storefront is live! 🎉');
      setBlocked(null);
      store.refetch();
    } catch (err) {
      if (err?.code === 'STORE_NOT_READY') {
        // The panel IS the message — it lists the gaps with links and the
        // inline email fix, so no toast; toasting too would double-report.
        setBlocked(err.details || {});
        return;
      }
      toast.error(errMsg(err));
    }
  };

  if (store.loading && !store.data) return <LoadingBlock label="Loading your store…" />;

  return (
    <div>
      <PageHeader
        title="Storefront"
        description="Everything customers see on your public store page."
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

      {blocked && (
        <div className="mb-6">
          <PublishBlockedPanel
            reasons={blocked.reasons || []}
            blocking={blocked.blocking || []}
            onResolved={async () => { setBlocked(null); await store.refetch(); }}
          />
        </div>
      )}

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
              <div>
                <p className="label">Brand kit</p>
                <p className="mb-2 text-xs text-slate-500">One florist identity per store — not a hex picker.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {BRAND_KIT_IDS.map((id) => {
                    const kit = BRAND_KITS[id];
                    const on = form.kit === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => set('kit', id)}
                        className={`relative overflow-hidden rounded-xl border p-3 text-left transition ${on ? 'border-transparent ring-2 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        <span className="mb-2 flex h-12 overflow-hidden rounded-lg">
                          <span className="w-2/3" style={{ background: kit.primaryColor }} />
                          <span className="w-1/3" style={{ background: kit.accentColor }} />
                        </span>
                        <span className="block text-sm font-semibold text-slate-800">{kit.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{kit.blurb}</span>
                        {on && (
                          <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                  hint="Wide fallback banner (16:5) when the carousel is empty"
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
                  <Input value={form.youtube} onChange={(e) => set('youtube', e.target.value)} placeholder="youtube.com/…" />
                  <Input value={form.x} onChange={(e) => set('x', e.target.value)} placeholder="x.com/…" />
                  <Input value={form.whatsappSocial} onChange={(e) => set('whatsappSocial', e.target.value)} placeholder="WhatsApp number" />
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

      {form && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <Card
            title="Announcement bar"
            subtitle="A single line above your header — sales, timings, anything urgent."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveAnnouncement}>Save</Button>}
          >
            <div className="space-y-4">
              <Field label="Message" hint="Max 120 characters">
                <Input
                  value={form.announcement.text}
                  onChange={(e) => setIn('announcement', 'text', e.target.value)}
                  placeholder="Diwali sale — 20% off all bouquets this week"
                  maxLength={120}
                />
              </Field>
              <Field label="Link" hint="Where tapping the bar goes — /search?q=diwali or https://…">
                <Input
                  value={form.announcement.linkUrl}
                  onChange={(e) => setIn('announcement', 'linkUrl', e.target.value)}
                  placeholder="/search?q=diwali"
                />
              </Field>
              <Checkbox
                label="Show the announcement bar"
                checked={form.announcement.isActive}
                onChange={(e) => setIn('announcement', 'isActive', e.target.checked)}
              />
            </div>
          </Card>

          <Card
            title="Our story"
            subtitle="The About page — blank title and content hide the Home teaser too."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveAbout}>Save</Button>}
          >
            <div className="space-y-4">
              <Field label="Title">
                <Input
                  value={form.about.title}
                  onChange={(e) => setIn('about', 'title', e.target.value)}
                  placeholder="Three generations of florists"
                />
              </Field>
              <Field label="Story" hint="Blank line between paragraphs">
                <Textarea
                  value={form.about.content}
                  onChange={(e) => setIn('about', 'content', e.target.value)}
                  placeholder="How your store started, what you stand for…"
                  rows={5}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField
                  label="Photo"
                  hint="Your shop, your team, your work"
                  purpose={MEDIA_PURPOSE.storeAbout}
                  value={form.about.imageUrl}
                  onChange={(v) => setIn('about', 'imageUrl', v)}
                />
                <Field label="Video" hint="YouTube / Vimeo link, or a direct .mp4 URL">
                  <Input
                    value={form.about.videoUrl}
                    onChange={(e) => setIn('about', 'videoUrl', e.target.value)}
                    placeholder="https://youtube.com/watch?v=…"
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card
            title="Hero carousel"
            subtitle="Up to 8 slides. Slides without an image are skipped — with no active slides the banner above shows instead."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveHero}>Save</Button>}
            className="lg:col-span-2"
          >
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {form.heroSlides.map((s, i) => (
                <RowShell
                  key={i}
                  title="Slide"
                  index={i}
                  total={form.heroSlides.length}
                  onMove={(idx, dir) => set('heroSlides', move(form.heroSlides, idx, dir))}
                  onRemove={(idx) => set('heroSlides', form.heroSlides.filter((_, j) => j !== idx))}
                >
                  <div className="space-y-3">
                    <ImageField
                      label="Image"
                      hint="Wide (16:9 desktop crop) — required"
                      purpose={MEDIA_PURPOSE.storeHero}
                      value={s.imageUrl}
                      onChange={(v) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, imageUrl: v } : x))}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Title">
                        <Input value={s.title} onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Festive collection" maxLength={80} />
                      </Field>
                      <Field label="Mobile image" hint="Optional portrait crop">
                        <Input value={s.mobileImageUrl} onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, mobileImageUrl: e.target.value } : x))} placeholder="Paste a URL, or leave blank" />
                      </Field>
                    </div>
                    <Field label="Subtitle">
                      <Input value={s.subtitle} onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, subtitle: e.target.value } : x))} placeholder="Hand-tied bouquets from ₹499" maxLength={160} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Button label">
                        <Input value={s.ctaLabel} onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, ctaLabel: e.target.value } : x))} placeholder="Shop now" maxLength={30} />
                      </Field>
                      <Field label="Button link">
                        <Input value={s.ctaLink} onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, ctaLink: e.target.value } : x))} placeholder="/search?q=roses" />
                      </Field>
                    </div>
                    <Checkbox
                      label="Show this slide"
                      checked={s.isActive}
                      onChange={(e) => set('heroSlides', form.heroSlides.map((x, j) => j === i ? { ...x, isActive: e.target.checked } : x))}
                    />
                  </div>
                </RowShell>
              ))}
            </div>
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                disabled={form.heroSlides.length >= 8}
                onClick={() => set('heroSlides', [...form.heroSlides, blankSlide()])}
              >
                Add slide {form.heroSlides.length >= 8 ? '(max 8)' : `(${form.heroSlides.length}/8)`}
              </Button>
            </div>
          </Card>

          <Card
            title="Highlights"
            subtitle="Up to 6 trust badges under the hero (free delivery, fresh guarantee…). Rows without a title are skipped."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveHighlights}>Save</Button>}
          >
            <div className="space-y-3">
              {form.highlights.map((h, i) => (
                <RowShell
                  key={i}
                  title="Highlight"
                  index={i}
                  total={form.highlights.length}
                  onMove={(idx, dir) => set('highlights', move(form.highlights, idx, dir))}
                  onRemove={(idx) => set('highlights', form.highlights.filter((_, j) => j !== idx))}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Icon">
                      <Select value={h.icon} onChange={(e) => set('highlights', form.highlights.map((x, j) => j === i ? { ...x, icon: e.target.value } : x))}>
                        {ICON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                    </Field>
                    <Field label="Title">
                      <Input value={h.title} onChange={(e) => set('highlights', form.highlights.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Same-day delivery" maxLength={60} />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Text">
                      <Input value={h.text} onChange={(e) => set('highlights', form.highlights.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="Order by 6 pm for delivery today" maxLength={200} />
                    </Field>
                  </div>
                </RowShell>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                disabled={form.highlights.length >= 6}
                onClick={() => set('highlights', [...form.highlights, blankHighlight()])}
              >
                Add highlight {form.highlights.length >= 6 ? '(max 6)' : `(${form.highlights.length}/6)`}
              </Button>
            </div>
          </Card>

          <Card
            title="Testimonials"
            subtitle="Up to 12 customer reviews for Home and About. Rows without a name and text are skipped."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveTestimonials}>Save</Button>}
          >
            <div className="space-y-3">
              {form.testimonials.map((x, i) => (
                <RowShell
                  key={i}
                  title="Review"
                  index={i}
                  total={form.testimonials.length}
                  onMove={(idx, dir) => set('testimonials', move(form.testimonials, idx, dir))}
                  onRemove={(idx) => set('testimonials', form.testimonials.filter((_, j) => j !== idx))}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name">
                      <Input value={x.name} onChange={(e) => set('testimonials', form.testimonials.map((y, j) => j === i ? { ...y, name: e.target.value } : x))} placeholder="Priya S." maxLength={80} />
                    </Field>
                    <Field label="Rating">
                      <Select value={x.rating} onChange={(e) => set('testimonials', form.testimonials.map((y, j) => j === i ? { ...y, rating: Number(e.target.value) } : y))}>
                        {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} star{r === 1 ? '' : 's'}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <div className="mt-3 space-y-3">
                    <Field label="Review">
                      <Textarea value={x.text} onChange={(e) => set('testimonials', form.testimonials.map((y, j) => j === i ? { ...y, text: e.target.value } : y))} placeholder="The roses were still fresh after a week…" maxLength={500} rows={3} />
                    </Field>
                    <Field label="Photo URL" hint="Optional customer photo">
                      <Input value={x.avatarUrl} onChange={(e) => set('testimonials', form.testimonials.map((y, j) => j === i ? { ...y, avatarUrl: e.target.value } : y))} placeholder="https://…" />
                    </Field>
                  </div>
                </RowShell>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                disabled={form.testimonials.length >= 12}
                onClick={() => set('testimonials', [...form.testimonials, blankTestimonial()])}
              >
                Add review {form.testimonials.length >= 12 ? '(max 12)' : `(${form.testimonials.length}/12)`}
              </Button>
            </div>
          </Card>

          <Card
            title="Contact"
            subtitle="Shown on About and in the footer. Leave anything blank to hide it."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveContact}>Save</Button>}
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  <Input value={form.contact.phone} onChange={(e) => setIn('contact', 'phone', e.target.value)} placeholder="+91 98765 43210" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.contact.email} onChange={(e) => setIn('contact', 'email', e.target.value)} placeholder="hello@yourstore.in" />
                </Field>
                <Field label="Open hours">
                  <Input value={form.contact.hours} onChange={(e) => setIn('contact', 'hours', e.target.value)} placeholder="Mon–Sat, 9 am – 9 pm" />
                </Field>
                <Field label="WhatsApp">
                  <Input value={form.contact.whatsapp} onChange={(e) => setIn('contact', 'whatsapp', e.target.value)} placeholder="+91 98765 43210" />
                </Field>
              </div>
              <Field label="Address">
                <Input value={form.contact.line1} onChange={(e) => setIn('contact', 'line1', e.target.value)} placeholder="Shop 12, Flower Market Road" />
              </Field>
              <Field label="Address line 2">
                <Input value={form.contact.line2} onChange={(e) => setIn('contact', 'line2', e.target.value)} placeholder="Kothapet" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="City">
                  <Input value={form.contact.city} onChange={(e) => setIn('contact', 'city', e.target.value)} placeholder="Hyderabad" />
                </Field>
                <Field label="State">
                  <Input value={form.contact.state} onChange={(e) => setIn('contact', 'state', e.target.value)} placeholder="Telangana" />
                </Field>
                <Field label="Pincode">
                  <Input value={form.contact.pincode} onChange={(e) => setIn('contact', 'pincode', e.target.value)} placeholder="500035" />
                </Field>
              </div>
              <Field label="Map link" hint="Google Maps share link for directions">
                <Input value={form.contact.mapUrl} onChange={(e) => setIn('contact', 'mapUrl', e.target.value)} placeholder="https://maps.google.com/…" />
              </Field>
            </div>
          </Card>

          <Card
            title="Search & footer"
            subtitle="How your store appears on Google and at the bottom of every page."
            actions={<Button size="sm" icon={Save} loading={busy} onClick={saveSeo}>Save</Button>}
          >
            <div className="space-y-4">
              <Field label={`Page title (${form.seo.title.length}/70)`} hint="Blank = store name · tagline">
                <Input
                  value={form.seo.title}
                  onChange={(e) => setIn('seo', 'title', e.target.value)}
                  placeholder="Best florist in Hyderabad | Your Store"
                  maxLength={70}
                />
              </Field>
              <Field label={`Meta description (${form.seo.description.length}/170)`} hint="Blank = store description">
                <Textarea
                  value={form.seo.description}
                  onChange={(e) => setIn('seo', 'description', e.target.value)}
                  placeholder="Fresh flowers delivered same-day across Hyderabad…"
                  maxLength={170}
                  rows={3}
                />
              </Field>
              <Field label="Footer note" hint="One line at the bottom of every page">
                <Input
                  value={form.footerText}
                  onChange={(e) => set('footerText', e.target.value)}
                  placeholder="Proudly serving Hyderabad since 2010"
                  maxLength={300}
                />
              </Field>
              <p className="flex items-start gap-1.5 text-xs text-slate-400">
                <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Home page rails (categories, brands) fill themselves from your live
                listings — no curation needed.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
