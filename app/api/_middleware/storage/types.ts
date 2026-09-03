import type { StorageProvider } from '../../../../domain/shared/storage';

/**
 * What the server adds to the seam's browser-safe contract
 * (domain/shared/storage.ts). Routes and the seed hold a `StorageProvider`;
 * only create-api.ts looks at `kind`, and only to decide whether this API must
 * serve the signed URLs itself.
 */
export type ServerStorageProvider = StorageProvider & {
  /** `local`: this API serves its own signed URLs. `supabase`: the vendor does. */
  kind: 'local' | 'supabase';
  /** One line for the startup log. Never a credential, never a bucket's contents. */
  describe(): string;
} & Partial<LocalOnly>;

/** The parts only the local implementation has, because only it is asked to serve bytes. */
export type LocalOnly = {
  root: string;
  verifySigned(parts: { key: string; expires: number; token: string }, now?: number): boolean;
  /** The bytes, or null when nothing is stored at that key. */
  read(key: string): Promise<Buffer | null>;
};

/** Narrows a provider to the one that serves its own signed URLs. */
export function isLocalStorage(
  storage: ServerStorageProvider,
): storage is ServerStorageProvider & LocalOnly {
  return storage.kind === 'local' && typeof storage.verifySigned === 'function';
}
