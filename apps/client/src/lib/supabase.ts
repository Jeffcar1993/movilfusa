import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const CHUNK_SIZE = 1800;
const getChunkMetaKey = (key: string) => `${key}__chunks`;
const getChunkKey = (key: string, index: number) => `${key}__chunk_${index}`;

const removeChunkedValue = async (key: string) => {
  const metaKey = getChunkMetaKey(key);
  const chunkCountRaw = await SecureStore.getItemAsync(metaKey);
  const chunkCount = Number.parseInt(chunkCountRaw ?? '', 10);

  if (Number.isFinite(chunkCount) && chunkCount > 0) {
    await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => SecureStore.deleteItemAsync(getChunkKey(key, index))),
    );
  }

  await SecureStore.deleteItemAsync(metaKey);
};

const secureStoreAdapter = {
  getItem: async (key: string) => {
    const metaKey = getChunkMetaKey(key);
    const chunkCountRaw = await SecureStore.getItemAsync(metaKey);
    const chunkCount = Number.parseInt(chunkCountRaw ?? '', 10);

    if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
      return SecureStore.getItemAsync(key);
    }

    const chunks = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => SecureStore.getItemAsync(getChunkKey(key, index))),
    );

    if (chunks.some((chunk) => chunk == null)) {
      return null;
    }

    return chunks.join('');
  },
  setItem: async (key: string, value: string) => {
    await removeChunkedValue(key);
    await SecureStore.deleteItemAsync(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const totalChunks = Math.ceil(value.length / CHUNK_SIZE);
    await Promise.all(
      Array.from({ length: totalChunks }, (_, index) => {
        const start = index * CHUNK_SIZE;
        const end = start + CHUNK_SIZE;
        return SecureStore.setItemAsync(getChunkKey(key, index), value.slice(start, end));
      }),
    );
    await SecureStore.setItemAsync(getChunkMetaKey(key), String(totalChunks));
  },
  removeItem: async (key: string) => {
    await removeChunkedValue(key);
    await SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in client environment.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
