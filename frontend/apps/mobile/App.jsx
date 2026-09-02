import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createApiClient,
  createEndpoints,
  createAuthStore,
  createJSONStorage,
} from '@flower-market/shared';
import { API_BASE_URL } from './src/config.js';

/**
 * Phase 6 mobile scaffold — proves the shared core on React Native.
 * Same API client + auth store as the web console; only the storage adapter
 * and base URL differ (swap the memory shim for AsyncStorage in a real build).
 */
const memoryStorage = (() => {
  let s = {};
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
  };
})();

export const useAuthStore = createAuthStore(createJSONStorage(() => memoryStorage));

const client = createApiClient({
  baseURL: API_BASE_URL,
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  saveTokens: (tokens) => useAuthStore.getState().setTokens(tokens),
  clearSession: () => useAuthStore.getState().clear(),
});
const api = createEndpoints(client);

export default function App() {
  const [email, setEmail] = useState('admin@flowermarket.in');
  const [password, setPassword] = useState('Admin@12345');
  const [busy, setBusy] = useState(false);
  const session = useAuthStore();

  const login = async () => {
    setBusy(true);
    try {
      const r = await api.auth.login({ email, password });
      useAuthStore.getState().setSession(r.data);
    } catch (err) {
      Alert.alert('Sign in failed', err?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const logout = () => useAuthStore.getState().clear();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <View style={styles.card}>
        <Text style={styles.brand}>🌷 Flower Market</Text>
        <Text style={styles.subtitle}>Console — mobile scaffold</Text>

        {session.user ? (
          <View style={styles.session}>
            <Text style={styles.ok}>Signed in</Text>
            <Text style={styles.name}>
              {session.user.profile?.firstName} {session.user.profile?.lastName}
            </Text>
            <Text style={styles.meta}>role: {session.user.role}</Text>
            <Text style={styles.meta}>tenant: {session.user.tenantId}</Text>
            <Text style={styles.meta}>api: {API_BASE_URL}</Text>
            <Pressable style={styles.btn} onPress={logout}>
              <Text style={styles.btnText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Pressable style={[styles.btn, busy && styles.btnBusy]} onPress={login} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in</Text>}
            </Pressable>
            <Text style={styles.hint}>
              The shared API client, auth store and money/date utils power this screen — the
              same code the web console uses.
            </Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  brand: { fontSize: 22, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 2, marginBottom: 20 },
  form: { gap: 12 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: '#fff' },
  btn: { backgroundColor: '#e11d48', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnBusy: { opacity: 0.7 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12, lineHeight: 16 },
  session: { alignItems: 'center', gap: 4 },
  ok: { color: '#059669', fontWeight: '700', fontSize: 15 },
  name: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginTop: 6 },
  meta: { fontSize: 12, color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
