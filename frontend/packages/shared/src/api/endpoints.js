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
