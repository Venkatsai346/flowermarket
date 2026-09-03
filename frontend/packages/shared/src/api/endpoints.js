/**
 * Typed endpoint helpers — one function per API route, 1:1 with
 * `flower-market-backend/src/routes/*` (Phase 5 marketplace + Phase 4 admin + auth).
 * JSON helpers return `{ data, meta, message }`; download helpers return the
 * raw API response `{ data: Response, headers, status, raw: true }`.
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
      // product / catalog reads + CSV
      products: (q = {}) => c.get('/admin/products', { query: q }),
      product: (id) => c.get(`/admin/products/${id}`),
      exportProducts: (q = {}) => c.download('/admin/products/export.csv', { query: q }),

      // inventory
      inventorySummary: (q = {}) => c.get('/admin/inventory/summary', { query: q }),
      inventory: (q = {}) => c.get('/admin/inventory', { query: q }),
      inventoryLedger: (id) => c.get(`/admin/inventory/ledger/${id}`),
      exportInventory: (q = {}) => c.download('/admin/inventory/export.csv', { query: q }),
      adjustInventory: (tenantProductId, body) => c.post(`/admin/inventory/${tenantProductId}/adjust`, body),

      // hubs + slots
      hubs: () => c.get('/admin/hubs'),
      createHub: (body) => c.post('/admin/hubs', body),
      updateHub: (id, body) => c.patch(`/admin/hubs/${id}`, body),
      toggleHub: (id, body) => c.post(`/admin/hubs/${id}/toggle`, body),
      manageHubPincodes: (id, body) => c.post(`/admin/hubs/${id}/pincodes`, body),
      slots: (q = {}) => c.get('/admin/slots', { query: q }),
      overrideSlot: (id, body) => c.post(`/admin/slots/${id}/override`, body),
      setSlotStatus: (id, body) => c.post(`/admin/slots/${id}/status`, body),
      slotsUtilization: (q = {}) => c.get('/admin/slots/utilization', { query: q }),

      // orders
      orders: (q = {}) => c.get('/admin/orders', { query: q }),
      order: (id) => c.get(`/admin/orders/${id}`),
      exportOrders: (q = {}) => c.download('/admin/orders/export.csv', { query: q }),

      // users, staff, riders
      users: (q = {}) => c.get('/admin/users', { query: q }),
      user: (id) => c.get(`/admin/users/${id}`),
      exportUsers: (q = {}) => c.download('/admin/users/export.csv', { query: q }),
      createStaff: (body) => c.post('/admin/users/staff', body),
      setUserStatus: (id, body) => c.patch(`/admin/users/${id}/status`, body),
      setUserRole: (id, body) => c.patch(`/admin/users/${id}/role`, body),
      riderStats: (q = {}) => c.get('/admin/users/riders/stats', { query: q }),

      // analytics
      analyticsDashboard: (q = {}) => c.get('/admin/analytics/dashboard', { query: q }),
      topProducts: (q = {}) => c.get('/admin/analytics/products', { query: q }),
      categoryPerformance: (q = {}) => c.get('/admin/analytics/categories', { query: q }),
      hubPerformance: (q = {}) => c.get('/admin/analytics/hubs', { query: q }),
      slotPerformance: (q = {}) => c.get('/admin/analytics/slots', { query: q }),
      exportAnalytics: (q = {}) => c.download('/admin/analytics/export.csv', { query: q }),
      rebuildAnalytics: (body = {}) => c.post('/admin/analytics/rebuild', body),

      // notification templates + jobs
      notificationTemplates: (q = {}) => c.get('/admin/notifications/templates', { query: q }),
      createNotificationTemplate: (body) => c.post('/admin/notifications/templates', body),
      updateNotificationTemplate: (id, body) => c.patch(`/admin/notifications/templates/${id}`, body),
      deleteNotificationTemplate: (id) => c.del(`/admin/notifications/templates/${id}`),
      notifications: (q = {}) => c.get('/admin/notifications', { query: q }),
      sendNotification: (body) => c.post('/admin/notifications/send', body),
      processNotifications: (body = {}) => c.post('/admin/notifications/process', body),

      // exports
      exports: (q = {}) => c.get('/admin/exports', { query: q }),
      createExport: (body) => c.post('/admin/exports', body),
      exportDetail: (id) => c.get(`/admin/exports/${id}`),
      runExport: (id) => c.post(`/admin/exports/${id}/run`),
      downloadExport: (id) => c.download(`/admin/exports/${id}/download`),
      runDueExports: (body = {}) => c.post('/admin/exports/run', body),

      // maintenance
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

      // catalog governance
      changeRequests: (q = {}) => c.get('/catalog/admin/change-requests', { query: q }),
      reviewChangeRequest: (id, body) => c.post(`/catalog/admin/change-requests/${id}/review`, body),
      audit: (q = {}) => c.get('/catalog/admin/audit', { query: q }),
      drainEvents: () => c.post('/catalog/admin/events/drain'),
      eventStatus: () => c.get('/catalog/admin/events/status'),
    },

    /** Phase 4/Phase 9 — tenant-scoped listings, stock, change requests and bulk. */
    catalogTenant: {
      proposeMaster: (body) => c.post('/catalog/tenant/masters/propose', body),
      listings: (q = {}) => c.get('/catalog/tenant/listings', { query: q }),
      listing: (id) => c.get(`/catalog/tenant/listings/${id}`),
      createListing: (body) => c.post('/catalog/tenant/listings', body),
      updatePrice: (id, body) => c.patch(`/catalog/tenant/listings/${id}/price`, body),
      updateStatus: (id, body) => c.patch(`/catalog/tenant/listings/${id}/status`, body),
      deactivateListing: (id) => c.post(`/catalog/tenant/listings/${id}/deactivate`),
      stock: (id) => c.get(`/catalog/tenant/listings/${id}/stock`),
      setStock: (id, body) => c.put(`/catalog/tenant/listings/${id}/stock`, body),
      adjustStock: (id, body) => c.patch(`/catalog/tenant/listings/${id}/stock`, body),
      reserveStock: (id, body) => c.post(`/catalog/tenant/listings/${id}/stock/reserve`, body),
      releaseStock: (id, body) => c.post(`/catalog/tenant/listings/${id}/stock/release`, body),
      changeRequests: (q = {}) => c.get('/catalog/tenant/change-requests', { query: q }),
      submitChangeRequest: (body) => c.post('/catalog/tenant/change-requests', body),
      cancelChangeRequest: (id) => c.post(`/catalog/tenant/change-requests/${id}/cancel`),
      reviseChangeRequest: (id, body) => c.post(`/catalog/tenant/change-requests/${id}/revise`, body),
      bulkUpload: (kind, body) => c.post(`/catalog/tenant/bulk/${kind}`, body),
      bulkJobs: (q = {}) => c.get('/catalog/tenant/bulk/jobs', { query: q }),
      bulkJob: (id) => c.get(`/catalog/tenant/bulk/jobs/${id}`),
      bulkTemplate: (kind) => c.download(`/catalog/tenant/bulk/template/${kind}`),
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
        kyc: (q = {}) => c.get('/payouts/admin/kyc', { query: q }),
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

    /**
     * Phase 6.x/P1 — warehouse + logistics ops. One namespace per backend
     * capability so the UI never mixes picking, delivery, slots and payments.
     */
    fulfillment: {
      // order queue
      listAll: (q = {}) => c.get('/fulfillment/orders', { query: q }),
      startPicking: (id) => c.post(`/fulfillment/orders/${id}/pick`),
      markPacked: (id) => c.post(`/fulfillment/orders/${id}/pack`),
      dispatch: (id) => c.post(`/fulfillment/orders/${id}/dispatch`),
      deliver: (id, body) => c.post(`/fulfillment/orders/${id}/deliver`, body),
      deliveryFailed: (id, body = {}) => c.post(`/fulfillment/orders/${id}/delivery-failed`, body),
      retryDelivery: (id) => c.post(`/fulfillment/orders/${id}/retry-delivery`),

      // slots + forecasting
      generateSlots: (body) => c.post('/fulfillment/slots/generate', body),
      slotUtilization: (q = {}) => c.get('/fulfillment/slots/utilization', { query: q }),
      sweepExpiredHolds: (q = {}) => c.post('/fulfillment/slots/sweep', undefined, { query: q }),
      forecastHub: (body) => c.post('/fulfillment/forecast', body),
      forecastUpcoming: (q = {}) => c.get('/fulfillment/forecast/upcoming', { query: q }),
      forecastHistory: (q = {}) => c.get('/fulfillment/forecast/history', { query: q }),
      sweepExpiredAssignments: (q = {}) => c.post('/fulfillment/assignments/sweep', undefined, { query: q }),

      // after-sales / refunds
      returns: (q = {}) => c.get('/fulfillment/returns', { query: q }),
      refunds: (q = {}) => c.get('/fulfillment/refunds', { query: q }),
      adminRefund: (body) => c.post('/fulfillment/refunds', body),

      // payments
      payments: (q = {}) => c.get('/fulfillment/payments', { query: q }),
      payment: (id) => c.get(`/fulfillment/payments/${id}`),
      reconcilePayments: (q = {}) => c.post('/fulfillment/reconcile/payments', undefined, { query: q }),
    },

    /** After-sales state machine used by ops/admin. */
    returns: {
      detail: (id) => c.get(`/returns/${id}`),
      markPickedUp: (id) => c.post(`/returns/${id}/pickup`),
      qcDecision: (id, body) => c.post(`/returns/${id}/qc`, body),
    },

    /** Rider mobile/desktop delivery surface. */
    rider: {
      deliveries: (q = {}) => c.get('/rider/deliveries', { query: q }),
      availability: (body) => c.post('/rider/availability', body),
      accept: (id) => c.post(`/rider/deliveries/${id}/accept`),
      reject: (id, body) => c.post(`/rider/deliveries/${id}/reject`, body),
      arriveHub: (id) => c.post(`/rider/deliveries/${id}/arrive-hub`),
      depart: (id, body = {}) => c.post(`/rider/deliveries/${id}/depart`, body),
      arrive: (id) => c.post(`/rider/deliveries/${id}/arrive`),
      complete: (id, body) => c.post(`/rider/deliveries/${id}/complete`, body),
      fail: (id, body) => c.post(`/rider/deliveries/${id}/fail`, body),
    },

    /** Pricing, coupon, tax and refund policies (store admin). */
    policies: {
      deliveryFees: () => c.get('/policies/delivery-fee'),
      createDeliveryFee: (body) => c.post('/policies/delivery-fee', body),
      updateDeliveryFee: (id, body) => c.patch(`/policies/delivery-fee/${id}`, body),
      taxPolicies: (q = {}) => c.get('/policies/tax', { query: q }),
      upsertTaxPolicy: (body) => c.post('/policies/tax', body),
      coupons: () => c.get('/policies/coupons'),
      createCoupon: (body) => c.post('/policies/coupons', body),
      refund: () => c.get('/policies/refund'),
      updateRefund: (body) => c.patch('/policies/refund', body),
      previewCoupon: (q) => c.get('/policies/coupons/preview', { query: q }),
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
      checkoutQuote: (body) => c.post('/cart/quote', body),
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
      returnDetail: (id) => c.get(`/returns/${id}`),
      wallet: () => c.get('/wallet'),
      walletTransactions: (q = {}) => c.get('/wallet/transactions', { query: q }),
      walletRefunds: (q = {}) => c.get('/wallet/refunds', { query: q }),
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
