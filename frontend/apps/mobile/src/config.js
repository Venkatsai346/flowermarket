/**
 * Mobile API config.
 * In Expo dev, set EXPO_PUBLIC_API_URL to the reachable API origin, e.g.
 *   EXPO_PUBLIC_API_URL=https://<preview-host>/api/v1 npm run mobile
 * The shared client is identical to the web console's — only the base URL differs.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
