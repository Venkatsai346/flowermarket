/**
 * VoiceOrderService — natural language order parsing.
 *
 * Accepts voice/text input and converts it to a structured cart.
 *
 * Flow:
 *   1. Customer says "I want 2 rose bouquets and 1 lily bunch"
 *   2. NLP extracts: [{ product: "rose bouquet", qty: 2 }, { product: "lily bunch", qty: 1 }]
 *   3. Fuzzy-matches against the product catalog
 *   4. Returns a cart-ready structure with product IDs and prices
 *
 * Uses simple keyword matching (no ML dependency). For production,
 * integrate with Dialogflow, Rasa, or OpenAI function calling.
 */

import TenantProduct from '../models/tenantProduct.model.js';
import searchService from './search.service.js';

class VoiceOrderService {
  /**
   * Parse natural language into cart items.
   *
   * @param {Object} opts
   * @param {string} opts.tenantId
   * @param {string} opts.text - Voice transcription or typed text
   * @param {string} [opts.language='en'] - Input language
   */
  async parse({ tenantId, text, language = 'en' }) {
    if (!text?.trim()) return { items: [], raw: text, confidence: 0 };

    // Extract quantity + product pairs
    const parsed = this._extractItems(text);
    const items = [];
    let totalConfidence = 0;

    for (const { product: productName, qty } of parsed) {
      // Search for matching products
      // sequential product search per parsed item
      // eslint-disable-next-line no-await-in-loop
      const results = await TenantProduct.find({
        tenantId,
        status: 'active',
        $text: { $search: productName },
      })
        .limit(3)
        .select('name sku stockQty availability price')
        .lean();

      if (results.length > 0) {
        const best = results[0];
        const confidence = this._matchConfidence(productName, best.name);
        items.push({
          tenantProductId: String(best._id),
          name: best.name,
          sku: best.sku,
          quantity: qty,
          unitPrice: best.price || 0,
          confidence,
          alternatives: results.slice(1).map((r) => ({
            id: String(r._id),
            name: r.name,
            confidence: this._matchConfidence(productName, r.name),
          })),
        });
        totalConfidence += confidence;
      } else {
        items.push({
          name: productName,
          quantity: qty,
          confidence: 0,
          error: 'Product not found',
        });
      }
    }

    return {
      items,
      raw: text,
      confidence: items.length > 0 ? totalConfidence / items.length : 0,
      language,
    };
  }

  /**
   * Extract quantity + product pairs from text.
   * Handles: "2 roses", "two rose bouquets", "1 kg jasmine"
   */
  _extractItems(text) {
    const items = [];
    const words = text.toLowerCase().replace(/[.,!?]/g, '').split(/\s+/);

    const numberWords = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      a: 1, an: 1, one: 1,
    };

    // Pattern: "N product" or "N kg/ltr/pcs product"
    const patterns = [
      /(\d+)\s*(?:kg|kilo|kilos|ltr|litre|liter|pcs|piece|pieces|bunch|bunches|bouquet|bouquets|dozen)?\s+(?:of\s+)?(.+)/i,
      /(\w+)\s+(?:kg|kilo|ltr|piece|pieces|bunch|bunches|bouquet|bouquets|dozen)?\s+(?:of\s+)?(.+)/i,
    ];

    // Simple approach: look for number followed by product name
    let i = 0;
    while (i < words.length) {
      let qty = 1;
      let startIdx = i;

      // Check if current word is a number
      const num = parseInt(words[i], 10);
      if (!isNaN(num) && num > 0) {
        qty = num;
        startIdx = i + 1;
      } else if (numberWords[words[i]]) {
        qty = numberWords[words[i]];
        startIdx = i + 1;
      }

      // Skip unit words
      const units = ['kg', 'kilo', 'kilos', 'ltr', 'litre', 'liter', 'pcs', 'piece', 'pieces', 'bunch', 'bunches', 'bouquet', 'bouquets', 'dozen', 'of'];
      if (units.includes(words[startIdx])) {
        startIdx += 1;
      }

      // Collect product name (until next number or end)
      const productWords = [];
      while (startIdx < words.length && !(/^\d+$/.test(words[startIdx])) && !numberWords[words[startIdx]]) {
        productWords.push(words[startIdx]);
        startIdx += 1;
      }

      if (productWords.length > 0) {
        items.push({ product: productWords.join(' '), qty });
        i = startIdx;
      } else {
        i += 1;
      }
    }

    return items;
  }

  /**
   * Calculate match confidence between query and product name.
   */
  _matchConfidence(query, productName) {
    const qWords = query.toLowerCase().split(/\s+/);
    const pWords = productName.toLowerCase().split(/\s+/);
    const matches = qWords.filter((w) => pWords.some((p) => p.includes(w) || w.includes(p)));
    return Math.round((matches.length / Math.max(qWords.length, 1)) * 100) / 100;
  }
}

export default new VoiceOrderService();
