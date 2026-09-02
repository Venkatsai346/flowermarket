/**
 * Typed endpoint helpers — one function per API route, 1:1 with
 * `flower-market-backend/src/routes/*` (Phase 5 marketplace + Phase 4 admin + auth).
 * Returns `{ data, meta, message }`.
 */
export function createEndpoints(client) {
  const c = client;
  return {
    auth: {
      login: (body) => c.post('/auth/login', body),
      refresh: (refreshToken) => c.post('/auth/refresh', { refreshToken }, { retry: false }),
      logout: (refreshToken) => c.post('/auth/logout', { refreshToken }),
      me: () => c.get('/users/me'),
      changePassword: (body) => c.post('/auth/password/change', body),
    },

    marketplace: {
      // public
      plans: () => c.get('/marketplace/plans'),
      registerStore: (body) => c.post('/marketplace/tenants/register', body),
      stores: (q = {}) => c.get('/marketplace/stores', { query: q }),
      storefront: (slug) => c.get(`/marketplace/stores/${slug}`),

      // store owner
      myStore: () => c.get('/marketplace/store'),
      updateStore: (body) => c.patch('/marketplace/store', body),
      mySubscription: () => c.get('/marketplace/store/subscription'),
      changePlan: (planCode) => c.patch('/marketplace/store/plan', { planCode }),
      myInvoices: (q = {}) => c.get('/marketplace/store/invoices', { query: q }),
      myInvoiceDetail: (id) => c.get(`/marketplace/store/invoices/${id}`),
      storeVendors: () => c.get('/marketplace/store/vendors'),
      syncVendorProducts: (vendorId) => c.post(`/marketplace/store/vendors/${vendorId}/sync`),

      // vendor
      vendorMe: () => c.get('/marketplace/vendor/me'),
      updateVendorMe: (body) => c.patch('/marketplace/vendor/me', body),
      vendorProducts: (q = {}) => c.get('/marketplace/vendor/products', { query: q }),
      createVendorProduct: (body) => c.post('/marketplace/vendor/products', body),
      updateVendorProduct: (id, body) => c.patch(`/marketplace/vendor/products/${id}`, body),

      // platform
      adminVendorApplications: (q = {}) => c.get('/marketplace/admin/vendor-applications', { query: q }),
      reviewApplication: (id, body) => c.post(`/marketplace/admin/vendor-applications/${id}/review`, body),
      adminVendors: (q = {}) => c.get('/marketplace/admin/vendors', { query: q }),
      adminVendorDetail: (id) => c.get(`/marketplace/admin/vendors/${id}`),
      adminUpdateVendor: (id, body) => c.patch(`/marketplace/admin/vendors/${id}`, body),
      reviewVendorProduct: (id, body) => c.post(`/marketplace/admin/vendor-products/${id}/review`, body),
      adminTenants: (q = {}) => c.get('/marketplace/admin/tenants', { query: q }),
      adminPlans: () => c.get('/marketplace/admin/plans'),
      createPlan: (body) => c.post('/marketplace/admin/plans', body),
      updatePlan: (id, body) => c.patch(`/marketplace/admin/plans/${id}`, body),
      adminInvoices: (q = {}) => c.get('/marketplace/admin/billing/invoices', { query: q }),
      adminInvoiceDetail: (id) => c.get(`/marketplace/admin/billing/invoices/${id}`),
      runBillingCycle: (body = {}) => c.post('/marketplace/admin/billing/cycle', body),
      payInvoice: (id) => c.post(`/marketplace/admin/billing/invoices/${id}/pay`),
      voidInvoice: (id) => c.post(`/marketplace/admin/billing/invoices/${id}/void`),
      overdueSweep: () => c.post('/marketplace/admin/billing/overdue-sweep'),
      platformDashboard: (q = {}) => c.get('/marketplace/admin/analytics/dashboard', { query: q }),
      topTenants: (q = {}) => c.get('/marketplace/admin/analytics/top-tenants', { query: q }),
      topVendors: (q = {}) => c.get('/marketplace/admin/analytics/top-vendors', { query: q }),
      rebuildPlatform: (body = {}) => c.post('/marketplace/admin/analytics/rebuild', body),
      nightly: (body = {}) => c.post('/marketplace/admin/nightly', body),
    },

    admin: {
      products: (q = {}) => c.get('/admin/products', { query: q }),
      product: (id) => c.get(`/admin/products/${id}`),
      adjustInventory: (tenantProductId, body) => c.post(`/admin/inventory/${tenantProductId}/adjust`, body),
      inventorySummary: (q = {}) => c.get('/admin/inventory/summary', { query: q }),
      hubs: () => c.get('/admin/hubs'),
      orders: (q = {}) => c.get('/admin/orders', { query: q }),
      order: (id) => c.get(`/admin/orders/${id}`),
      analyticsDashboard: (q = {}) => c.get('/admin/analytics/dashboard', { query: q }),
      topProducts: (q = {}) => c.get('/admin/analytics/products', { query: q }),
      rebuildAnalytics: (body = {}) => c.post('/admin/analytics/rebuild', body),
      nightly: (body = {}) => c.post('/admin/maintenance/nightly', body),
    },

    public: {
      categories: () => c.get('/catalog/categories'),
      brands: () => c.get('/catalog/brands'),
    },

    catalogAdmin: {
      // categories (taxonomy)
      categories: (q = {}) => c.get('/catalog/admin/categories', { query: q }),
      categoryTree: (q = {}) => c.get('/catalog/admin/categories/tree', { query: q }),
      category: (id) => c.get(`/catalog/admin/categories/${id}`),
      createCategory: (body) => c.post('/catalog/admin/categories', body),
      updateCategory: (id, body) => c.patch(`/catalog/admin/categories/${id}`, body),
      deleteCategory: (id) => c.del(`/catalog/admin/categories/${id}`),

      // brands
      brands: (q = {}) => c.get('/catalog/admin/brands', { query: q }),
      createBrand: (body) => c.post('/catalog/admin/brands', body),
      updateBrand: (id, body) => c.patch(`/catalog/admin/brands/${id}`, body),
      verifyBrand: (id, body) => c.patch(`/catalog/admin/brands/${id}/verify`, body),
      deleteBrand: (id) => c.del(`/catalog/admin/brands/${id}`),

      // product masters
      masters: (q = {}) => c.get('/catalog/admin/masters', { query: q }),
      master: (id) => c.get(`/catalog/admin/masters/${id}`),
      createMaster: (body) => c.post('/catalog/admin/masters', body),
      updateMaster: (id, body) => c.patch(`/catalog/admin/masters/${id}`, body),
      reviewMaster: (id, body) => c.post(`/catalog/admin/masters/${id}/review`, body),
      deprecateMaster: (id, body = {}) => c.post(`/catalog/admin/masters/${id}/deprecate`, body),
      addVariant: (id, body) => c.post(`/catalog/admin/masters/${id}/variants`, body),
      addImage: (id, body) => c.post(`/catalog/admin/masters/${id}/images`, body),
      setMasterAttributes: (id, body) => c.put(`/catalog/admin/masters/${id}/attributes`, body),
    },

    /**
     * Phase 6.3 — vendor payouts. Two audiences, mirroring the API:
     * `me.*` is the vendor's own money, `admin.*` is the platform's
     * money-moving surface (super_admin only).
     */
    payouts: {
      me: {
        list: (q = {}) => c.get('/payouts/me', { query: q }),
        upcoming: () => c.get('/payouts/me/upcoming'),
        statement: (id) => c.get(`/payouts/me/${id}/statement`),
        account: () => c.get('/payouts/me/account'),
        saveAccount: (body) => c.put('/payouts/me/account', body),
        verifyAccount: () => c.post('/payouts/me/account/verify'),
        submitKyc: (body) => c.post('/payouts/me/kyc', body),
      },
      admin: {
        list: (q = {}) => c.get('/payouts/admin', { query: q }),
        get: (id) => c.get(`/payouts/admin/${id}`),
        policy: (q = {}) => c.get('/payouts/admin/policy', { query: q }),
        savePolicy: (body) => c.put('/payouts/admin/policy', body),
        sweepEligibility: () => c.post('/payouts/admin/eligibility/sweep'),
        computeCycle: (body) => c.post('/payouts/admin/cycle/compute', body),
        holdLines: (body) => c.post('/payouts/admin/lines/hold', body),
        releaseLines: (body) => c.post('/payouts/admin/lines/release', body),
        addAdjustment: (body) => c.post('/payouts/admin/adjustments', body),
        reviewKyc: (vendorId, body) => c.post(`/payouts/admin/kyc/${vendorId}/review`, body),
        submitForApproval: (id) => c.post(`/payouts/admin/${id}/submit`),
        approve: (id, body = {}) => c.post(`/payouts/admin/${id}/approve`, body),
        reject: (id, body) => c.post(`/payouts/admin/${id}/reject`, body),
        cancel: (id, body) => c.post(`/payouts/admin/${id}/cancel`, body),
        submitToProvider: (id) => c.post(`/payouts/admin/${id}/submit-to-provider`),
        reconcile: (body = {}) => c.post('/payouts/admin/reconcile', body),
        ingestSettlements: (body) => c.post('/payouts/admin/settlements/ingest', body),
      },
    },

    /** Phase 6.1 — read-only general ledger (super_admin). */
    ledger: {
      accounts: () => c.get('/ledger/accounts'),
      statement: (q = {}) => c.get('/ledger/statement', { query: q }),
      trialBalance: () => c.get('/ledger/trial-balance'),
      journals: (q = {}) => c.get('/ledger/journals', { query: q }),
      verify: (body = {}) => c.post('/ledger/verify', body),
    },

    /** Phase 6.2 — GST registration, documents and rate policy. */
    tax: {
      registration: () => c.get('/tax/registration'),
      saveRegistration: (body) => c.put('/tax/registration', body),
      documents: (q = {}) => c.get('/tax/documents', { query: q }),
      document: (id) => c.get(`/tax/documents/${id}`),
      issueInvoice: (body) => c.post('/tax/documents/invoice', body),
      issueCreditNote: (body) => c.post('/tax/documents/credit-note', body),
      cancelDocument: (id, body) => c.post(`/tax/documents/${id}/cancel`, body),
      retryEinvoice: (id) => c.post(`/tax/documents/${id}/einvoice/retry`),
      auditSeries: (q = {}) => c.get('/tax/series/audit', { query: q }),
      policies: (q = {}) => c.get('/tax/policies', { query: q }),
      savePolicy: (body) => c.post('/tax/policies', body),
      statutoryRates: (q = {}) => c.get('/tax/statutory-rates', { query: q }),
      saveStatutoryRate: (body) => c.post('/tax/statutory-rates', body),
      orderInvoice: (orderId) => c.get(`/tax/orders/${orderId}/invoice`),
    },

    /** Phase 6.4 — hostnames that resolve to this store. */
    domains: {
      list: () => c.get('/domains'),
      add: (hostname) => c.post('/domains', { hostname }),
      verify: (id) => c.post(`/domains/${id}/verify`),
      setPrimary: (id) => c.post(`/domains/${id}/primary`),
      remove: (id) => c.del(`/domains/${id}`),
      bootstrap: () => c.get('/domains/bootstrap'),
      adminAll: () => c.get('/domains/admin/all'),
    },

    /**
     * Phase 6.4/P2 — the CUSTOMER surface. Everything the storefront needs,
     * 1:1 with the public + customer routes that have existed since Phase 3
     * and until now had no client at all.
     */
    shop: {
      // discovery (public)
      bootstrap: () => c.get('/domains/bootstrap'),
      suggest: (q) => c.get('/search/suggest', { query: { q } }),
      /** Fire-and-forget relevance beacon — the only way ranking gets measured. */
      searchEvent: (body) => c.post('/search/events', body),
      products: (q = {}) => c.get('/catalog', { query: q }),
      product: (id) => c.get(`/catalog/products/${id}`),
      stock: (id) => c.get(`/catalog/products/${id}/stock`),
      categories: () => c.get('/catalog/categories'),
      brands: () => c.get('/catalog/brands'),

      // sign-in by phone OTP (the customer flow)
      requestOtp: (body) => c.post('/auth/otp/request', body),
      verifyOtp: (body) => c.post('/auth/otp/verify', body),

      // cart
      cart: () => c.get('/cart'),
      addItem: (body) => c.post('/cart/items', body),
      updateItem: (id, body) => c.patch(`/cart/items/${id}`, body),
      removeItem: (id) => c.del(`/cart/items/${id}`),
      clearCart: () => c.del('/cart'),
      revalidate: () => c.post('/cart/revalidate'),
      applyCoupon: (code) => c.post('/cart/coupon', { code }),
      removeCoupon: () => c.del('/cart/coupon'),

      // delivery slots
      slots: (q = {}) => c.get('/cart/slots', { query: q }),
      reserveSlot: (id, body = {}) => c.post(`/cart/slots/${id}/reserve`, body),

      // checkout & orders
      checkout: (body) => c.post('/cart/checkout', body),
      orders: (q = {}) => c.get('/orders', { query: q }),
      order: (id) => c.get(`/orders/${id}`),
      orderTimeline: (id) => c.get(`/orders/${id}/timeline`),
      cancelOrder: (id, body) => c.post(`/orders/${id}/cancel`, body),

      // addresses
      addresses: () => c.get('/users/me/addresses'),
      addAddress: (body) => c.post('/users/me/addresses', body),
      updateAddress: (id, body) => c.patch(`/users/me/addresses/${id}`, body),
      removeAddress: (id) => c.del(`/users/me/addresses/${id}`),
      setDefaultAddress: (id) => c.patch(`/users/me/addresses/${id}/default`),

      // after-sales
      returns: (q = {}) => c.get('/returns', { query: q }),
      createReturn: (body) => c.post('/returns', body),
      wallet: () => c.get('/wallet'),
      walletTransactions: (q = {}) => c.get('/wallet/transactions', { query: q }),
    },

    /** Phase 6.5 — search tuning (store admin). */
    search: {
      profiles: () => c.get('/search/profiles'),
      saveProfile: (body) => c.post('/search/profiles', body),
      synonyms: () => c.get('/search/synonyms'),
      addSynonym: (body) => c.post('/search/synonyms', body),
      reindex: (body = {}) => c.post('/search/reindex', body),
      health: () => c.get('/search/health'),
      analytics: (q = {}) => c.get('/search/analytics', { query: q }),
    },

    media: {
      presign: (body) => c.post('/media/presign', body),
      confirm: (id) => c.post(`/media/${id}/confirm`),
      list: (q = {}) => c.get('/media', { query: q }),
      get: (id) => c.get(`/media/${id}`),
      remove: (id) => c.del(`/media/${id}`),
    },
  };
}

export default createEndpoints;
