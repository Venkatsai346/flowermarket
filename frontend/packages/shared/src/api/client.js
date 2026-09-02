/**
 * ApiClient — the single fetch wrapper for the Flower Market API.
 *
 * - wraps the `{ success, data, meta, message, code }` envelope
 * - attaches `Authorization: Bearer <access>` from getAccessToken()
 * - on 401: single-flight refresh via POST /auth/refresh (rotating token), retries
 *   the original request once; only clears the session when refresh itself fails
 * - throws ApiError { status, code, details } for non-2xx / !success responses
 *
 * Framework-agnostic (plain ESM) — used by the web console and the mobile app.
 */
export class ApiError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = null, response = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.response = response;
  }
}

function buildQuery(q) {
  if (!q) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => s.append(k, x));
    else s.append(k, v);
  }
  const t = s.toString();
  return t ? `?${t}` : '';
}

export function createApiClient({
  baseURL = '',
  getAccessToken = () => null,
  getRefreshToken = () => null,
  saveTokens = () => {},
  clearSession = () => {},
  onUnauthorized = () => {},
  extraHeaders = () => ({}),
  fetchImpl = fetch,
} = {}) {
  let refreshing = null;

  const doRefresh = async () => {
    const rt = getRefreshToken();
    if (!rt) throw new ApiError('No refresh token', { status: 401, code: 'NO_REFRESH_TOKEN' });
    const res = await fetchImpl(`${baseURL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || !json?.success) {
      throw new ApiError(json?.message || 'Refresh failed', {
        status: res.status,
        code: json?.code || 'REFRESH_FAILED',
      });
    }
    saveTokens(json.data.tokens);
    return json.data.tokens.accessToken;
  };

  const request = async (path, { method = 'GET', query, body, headers = {}, signal, retry = true } = {}) => {
    const url = `${baseURL}${path}${buildQuery(query)}`;
    const h = { ...extraHeaders(), ...headers };
    const token = getAccessToken();
    if (token) h.authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetchImpl(url, { method, headers: h, body: payload, signal });
    } catch (err) {
      throw new ApiError(err.message || 'Network error', { status: 0, code: 'NETWORK_ERROR' });
    }

    let json = null;
    try { json = await res.json(); } catch { json = null; }

    if (res.status === 401 && retry) {
      try {
        if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
        await refreshing;
        return request(path, { method, query, body, headers, signal, retry: false });
      } catch (refreshErr) {
        clearSession();
        onUnauthorized(refreshErr);
        throw new ApiError(refreshErr.message || 'Session expired', {
          status: 401,
          code: refreshErr.code || 'UNAUTHORIZED',
        });
      }
    }

    if (!res.ok || !json?.success) {
      throw new ApiError(json?.message || `Request failed (${res.status})`, {
        status: res.status,
        code: json?.code || 'REQUEST_FAILED',
        details: json?.details || null,
        response: json,
      });
    }

    return { data: json.data ?? null, meta: json.meta ?? null, message: json.message, status: res.status };
  };

  return {
    request,
    get: (path, o = {}) => request(path, { ...o, method: 'GET' }),
    post: (path, body, o = {}) => request(path, { ...o, method: 'POST', body }),
    patch: (path, body, o = {}) => request(path, { ...o, method: 'PATCH', body }),
    put: (path, body, o = {}) => request(path, { ...o, method: 'PUT', body }),
    del: (path, o = {}) => request(path, { ...o, method: 'DELETE' }),
  };
}

export default createApiClient;
