import { randomUUID } from 'node:crypto';

/**
 * The seam between this API and whoever holds the sign-ins (docs/SEAMS.md, the
 * shape `app/api/_middleware/storage` set): an abstract contract, a real
 * implementation and a deterministic fallback, chosen from the environment,
 * with a forced-fallback test proving the door works with the real one
 * switched off (`tests/portal/auth-admin.test.ts`).
 *
 * **Three calls, and no more.** Creating a sign-in for somebody the practice
 * has invited, setting a new password on one that exists, and deleting one the
 * door has just created and could not finish putting behind an account. That
 * last is the seam's own clean-up and nothing else: revoking a household's
 * access is `app_user.status = 'suspended'`, which is what `app.resolve_actor`
 * reads on the next request (docs/SPEC/client-portal.md section 12).
 *
 * **Why it is not the storage seam's key.** `SUPABASE_AUTH_ADMIN_KEY` is its
 * own variable with no fallback to the service role key, for the reason
 * `SUPABASE_STORAGE_KEY` has none: a variable whose whole purpose is to say
 * "this credential may create sign-ins" means nothing if another one is used
 * when it is absent. Blank is absent, and the anon key — which the browser
 * holds — is refused by name where it can be proved.
 */

/** What the door and the invite routes ask of whoever holds the sign-ins. */
export type AuthAdminProvider = {
  /** `supabase`: the real one. `fake`: the laptop's and the tests'. */
  kind: 'supabase' | 'fake';
  /** One line for the startup log. Never a credential. */
  describe(): string;
  /**
   * A sign-in for an address that has none. `email_in_use` when the address
   * already has one, which the door answers as a plain refusal rather than as
   * an outage.
   */
  createUser(input: { email: string; password: string }): Promise<{ authId: string }>;
  setPassword(authId: string, password: string): Promise<void>;
  /** Removes a sign-in this API created moments ago and could not finish. */
  deleteUser(authId: string): Promise<void>;
};

/** The address is already somebody's. A refusal, not a failure. */
export class EmailInUseError extends Error {
  /** Structural, so narrowing survives a plain Error beside it. */
  readonly emailInUse = true;

  constructor() {
    super('That email address already has a sign-in.');
    this.name = 'EmailInUseError';
  }
}

export function isEmailInUse(error: unknown): error is EmailInUseError {
  return error instanceof EmailInUseError;
}

/** Whoever holds the sign-ins could not be reached, or refused. */
export class AuthAdminUnavailableError extends Error {
  readonly authAdminUnavailable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthAdminUnavailableError';
  }
}

export function isAuthAdminUnavailable(error: unknown): error is AuthAdminUnavailableError {
  return error instanceof AuthAdminUnavailableError;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export type SupabaseAuthAdminOptions = {
  /** The project's URL, https://<ref>.supabase.co. */
  url: string;
  /** SUPABASE_AUTH_ADMIN_KEY, and never the anon key. */
  serviceKey: string;
  /** Tests inject a fetch; the server uses the runtime's own. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * The real one: Supabase Auth's admin endpoint, three calls of it.
 *
 * Nothing here reaches the network until a call is made, so a project that is
 * down cannot stop the API from starting — the same discipline the storage
 * seam keeps. A call then fails as `AuthAdminUnavailableError`, which the door
 * answers as 503.
 */
export function supabaseAuthAdmin(options: SupabaseAuthAdminOptions): AuthAdminProvider {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const credential = {
    apikey: options.serviceKey,
    authorization: `Bearer ${options.serviceKey}`,
  };

  async function call(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<Response> {
    try {
      return await doFetch(`${base}/auth/v1/admin/${path}`, {
        ...init,
        // The credential first and the call's own headers on top, in that
        // order: spreading the other way throws the content type away.
        headers: { ...credential, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new AuthAdminUnavailableError('The sign-in service could not be reached.', {
        cause: error,
      });
    }
  }

  /** A refusal. The body is never echoed: it can carry the address. */
  function refused(response: Response, what: string): AuthAdminUnavailableError {
    return new AuthAdminUnavailableError(
      `The sign-in service refused to ${what} (status ${response.status}).`,
    );
  }

  /**
   * Whether a refusal is "that address is taken". Supabase answers 422 with
   * `email_exists` (and, on older projects, 400 with a message saying so), and
   * the two are the same fact. The body is read only to answer this question
   * and never logged.
   */
  async function saysEmailInUse(response: Response): Promise<boolean> {
    if (response.status !== 422 && response.status !== 400) return false;
    try {
      const body = (await response.clone().json()) as {
        error_code?: unknown;
        code?: unknown;
        msg?: unknown;
      };
      if (body.error_code === 'email_exists' || body.code === 'email_exists') return true;
      return (
        typeof body.msg === 'string' && /already been registered|already exists/i.test(body.msg)
      );
    } catch {
      return false;
    }
  }

  return {
    kind: 'supabase',

    describe(): string {
      return `Supabase Auth admin at ${base}`;
    },

    async createUser({ email, password }): Promise<{ authId: string }> {
      const response = await call('users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Confirmed on creation: the practice has already verified who this
        // household is, and there is no address to send a confirmation to
        // that the practice did not itself write down.
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (!response.ok) {
        if (await saysEmailInUse(response)) throw new EmailInUseError();
        throw refused(response, 'create that sign-in');
      }
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      if (typeof body.id !== 'string' || body.id.length === 0) {
        throw new AuthAdminUnavailableError('The sign-in service answered without an id.');
      }
      return { authId: body.id };
    },

    async setPassword(authId: string, password: string): Promise<void> {
      const response = await call(`users/${encodeURIComponent(authId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw refused(response, 'set that password');
    },

    async deleteUser(authId: string): Promise<void> {
      const response = await call(`users/${encodeURIComponent(authId)}`, { method: 'DELETE' });
      // Already gone is the state that was wanted.
      if (!response.ok && response.status !== 404) {
        throw refused(response, 'remove that sign-in');
      }
    },
  };
}

/**
 * The fallback: sign-ins in this process's memory. It is what a laptop runs
 * and what every test runs, and the development door mints its own token for
 * whatever auth id this mints (`app/api/dev-session.ts`), so the whole
 * invitation path works with no project at all.
 *
 * It is not a password store and does not pretend to be one: the password is
 * never kept, because nothing here ever verifies one. What it holds is the
 * set of addresses that have a sign-in, which is the only fact the door reads
 * back — "is this address taken".
 */
export function fakeAuthAdmin(): AuthAdminProvider {
  const byEmail = new Map<string, string>();
  const byAuthId = new Map<string, string>();

  return {
    kind: 'fake',

    describe(): string {
      return 'The in-memory sign-in fallback (no project; a laptop and the tests)';
    },

    async createUser({ email }): Promise<{ authId: string }> {
      const key = email.trim().toLowerCase();
      if (byEmail.has(key)) throw new EmailInUseError();
      const authId = randomUUID();
      byEmail.set(key, authId);
      byAuthId.set(authId, key);
      return { authId };
    },

    async setPassword(): Promise<void> {
      // Nothing to set: no password is kept, because none is ever checked.
    },

    async deleteUser(authId: string): Promise<void> {
      const email = byAuthId.get(authId);
      if (email !== undefined) {
        byEmail.delete(email);
        byAuthId.delete(authId);
      }
    },
  };
}

/**
 * Refuses the anon key by name where the key says what it is. A Supabase key
 * of the JWT kind names its role in its own payload; the newer formats
 * (`sb_secret_...`, `sb_publishable_...`) are not JWTs and claim nothing, so
 * nothing is guessed from them. The key itself never reaches the message.
 */
function refuseAnonKey(key: string): void {
  const payload = key.split('.')[1];
  if (key.split('.').length !== 3 || payload === undefined) return;
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown })
      .role;
  } catch {
    return;
  }
  if (role === 'anon') {
    throw new Error(
      'SUPABASE_AUTH_ADMIN_KEY carries the anon role, which the browser holds: it never creates a sign-in.',
    );
  }
}

/**
 * Which implementation this deployment runs.
 *
 * On a laptop and in the tests the fallback is the answer, unasked. Anywhere
 * else the key decides: with `SUPABASE_AUTH_ADMIN_KEY` set the real one is
 * built, and without it the fallback is still returned — the API starts, every
 * other route works, and the door alone answers 503 `auth_admin_unavailable`
 * (docs/SPEC/client-portal.md section 8). That is deliberate: a practice that
 * has not configured sign-ins yet should still have a day sheet, and the one
 * thing that cannot work should be the one thing that says so.
 */
export function authAdminFromEnv(env: NodeJS.ProcessEnv): AuthAdminProvider {
  const laptop = env.APP_ENV === 'development' || env.APP_ENV === 'test';
  if (laptop) return fakeAuthAdmin();

  // Blank is absent: an empty or whitespace-only value in a secret store is a
  // variable somebody meant to fill in.
  const serviceKey = env.SUPABASE_AUTH_ADMIN_KEY?.trim() || undefined;
  const url = env.SUPABASE_URL?.trim() || undefined;
  if (!serviceKey || !url) return fakeAuthAdmin();
  refuseAnonKey(serviceKey);
  return supabaseAuthAdmin({ url, serviceKey });
}
