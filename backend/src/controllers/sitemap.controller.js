/**
 * Sitemap controller — generates dynamic sitemap.xml per tenant.
 *
 * Each storefront gets its own sitemap based on the tenant context.
 * The sitemap includes:
 *   - Home page (/)
 *   - Product pages (/p/:slug)
 *   - Category pages (/search?category=:slug)
 *
 * The sitemap is cached for 1 hour per tenant to avoid hammering the DB
 * on every crawler request.
 */

import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const sitemapCache = new Map();

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

class SitemapController {
  /**
   * GET /sitemap.xml — dynamic sitemap for the current tenant.
   */
  generate = asyncHandler(async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.setHeader('Content-Type', 'application/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }

    // Check cache
    const cached = sitemapCache.get(String(tenantId));
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.xml);
    }

    const baseUrl = `https://${req.hostname}`;
    const urls = [];

    // Home page
    urls.push({ loc: baseUrl, priority: '1.0', changefreq: 'daily' });

    // Product pages
    try {
      const Listing = mongoose.model('Listing');
      const listings = await Listing.find({
        tenantId,
        status: 'active',
        deletedAt: null,
      })
        .select('slug updatedAt')
        .limit(50000)
        .lean();

      for (const l of listings) {
        urls.push({
          loc: `${baseUrl}/p/${encodeURIComponent(l.slug)}`,
          lastmod: l.updatedAt ? new Date(l.updatedAt).toISOString().split('T')[0] : undefined,
          priority: '0.8',
          changefreq: 'weekly',
        });
      }
    } catch {
      // Listing model may not exist yet — that's fine
    }

    // Search/category pages
    try {
      const Category = mongoose.model('Category');
      const categories = await Category.find({ tenantId, deletedAt: null })
        .select('slug updatedAt')
        .lean();

      for (const c of categories) {
        urls.push({
          loc: `${baseUrl}/search?category=${encodeURIComponent(c.slug)}`,
          lastmod: c.updatedAt ? new Date(c.updatedAt).toISOString().split('T')[0] : undefined,
          priority: '0.6',
          changefreq: 'weekly',
        });
      }
    } catch {
      // Category model may not exist — that's fine
    }

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const u of urls) {
      xml += '  <url>\n';
      xml += `    <loc>${escapeXml(u.loc)}</loc>\n`;
      if (u.lastmod) xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
      xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
      xml += `    <priority>${u.priority}</priority>\n`;
      xml += '  </url>\n';
    }
    xml += '</urlset>';

    // Cache
    sitemapCache.set(String(tenantId), { xml, expiresAt: Date.now() + CACHE_TTL });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.send(xml);
  });
}

export default new SitemapController();
