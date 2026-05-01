export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const responseCache = new Map<string, { expiresAt: number; data: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();

function getCachedResponse<T>(key: string): T | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setCachedResponse(key: string, data: unknown, ttlMs: number) {
  responseCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function withInFlightDedup<T>(key: string, request: () => Promise<T>): Promise<T> {
  const active = inflightRequests.get(key) as Promise<T> | undefined;
  if (active) return active;
  const pending = request().finally(() => {
    inflightRequests.delete(key);
  });
  inflightRequests.set(key, pending);
  return pending;
}

function invalidatePocketCache() {
  for (const key of Array.from(responseCache.keys())) {
    if (key.startsWith("pockets:")) {
      responseCache.delete(key);
    }
  }
}

/** URL pre EventSource (SSE) — tokeny v query, lebo EventSource nepodporuje vlastné hlavičky. */
export function quicksplitStreamUrl(splitId: string, tokens: { joinToken?: string; adminToken?: string }) {
  const p = new URLSearchParams();
  if (tokens.adminToken) p.set('adminToken', tokens.adminToken);
  else if (tokens.joinToken) p.set('joinToken', tokens.joinToken);
  return `${API_BASE_URL}/quicksplits/${splitId}/stream?${p.toString()}`;
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  try {
    const token = await getAuthToken();
    
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(formatApiErrorMessage(error));
    }

    return response.json();
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('ERR_CONNECTION_REFUSED')) {
      throw new Error('Backend server nie je spustený. Spustite ho pomocou: cd backend && npm run start:dev');
    }
    throw error;
  }
}

async function getAuthToken(): Promise<string> {
  const { auth, FIREBASE_SETUP_ERROR } = await import('@/lib/firebase/config');
  const { onAuthStateChanged } = await import('firebase/auth');
  if (!auth) {
    throw new Error(FIREBASE_SETUP_ERROR);
  }

  if (auth.currentUser) {
    return auth.currentUser.getIdToken();
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        user.getIdToken().then(resolve).catch(reject);
      } else {
        reject(new Error('User not authenticated'));
      }
    });
  });
}

async function getOptionalAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { auth } = await import('@/lib/firebase/config');
    if (!auth) {
      return {};
    }
    const u = auth.currentUser;
    if (!u) return {};
    const token = await u.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export type QuickSplitRequestTokens = {
  joinToken?: string;
  adminToken?: string;
  participantSecret?: string;
};

export type PocketTransactionInput = {
  name: string;
  amount?: number;
  amountCents?: number;
  date?: string;
  payerUid?: string;
  tag?: string;
  note?: string;
  splitAssignedUids?: string[];
  splitMethod?: string;
  paidByUid?: string;
  transactionDate?: string;
};

function formatApiErrorMessage(error: { message?: unknown }): string {
  const m = error?.message;
  if (Array.isArray(m)) {
    return m.map((x) => (typeof x === "string" ? x : String(x))).join(" ");
  }
  if (typeof m === "string" && m.trim()) {
    return m.trim();
  }
  return "Request failed";
}

async function fetchQuicksplit(path: string, options: RequestInit & QuickSplitRequestTokens = {}) {
  const { joinToken, adminToken, participantSecret, ...rest } = options;
  try {
    const authH = await getOptionalAuthHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authH,
      ...(rest.headers as Record<string, string>),
    };
    if (joinToken) headers['X-Join-Token'] = joinToken;
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    if (participantSecret) headers['X-Participant-Secret'] = participantSecret;

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      const msg = formatApiErrorMessage(error);
      throw new Error(msg);
    }

    return response.json();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('Failed to fetch') || msg.includes('ERR_CONNECTION_REFUSED')) {
      throw new Error('Backend server nie je spustený. Spustite ho pomocou: cd backend && npm run start:dev');
    }
    throw error;
  }
}

export const api = {
  users: {
    searchByEmail: async (query: string) => {
      const qs = new URLSearchParams({ q: query }).toString();
      return fetchWithAuth(`/users/search/by-email?${qs}`);
    },
    get: async (userId: string) => {
      return fetchWithAuth(`/users/${userId}`);
    },
    update: async (userId: string, data: {
      phoneNumber?: string | null;
      residence?: string | null;
      fullName?: string | null;
      iban?: string | null;
    }) => {
      return fetchWithAuth(`/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    updateProfileImage: async (userId: string, imageUrl: string) => {
      return fetchWithAuth(`/users/${userId}/profile-image`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl }),
      });
    },
  },
  pockets: {
    create: async (body: {
      name: string;
      tags?: string[];
      initialTransactions?: PocketTransactionInput[];
      inviteEmails?: string[];
      invitedUserUids?: string[];
    }) => {
      const result = await fetchWithAuth('/pockets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      invalidatePocketCache();
      return result;
    },
    mine: async () => {
      const cacheKey = "pockets:mine";
      const cached = getCachedResponse<unknown>(cacheKey);
      if (cached) return cached;
      return withInFlightDedup(cacheKey, async () => {
        const data = await fetchWithAuth('/pockets/mine');
        setCachedResponse(cacheKey, data, 12_000);
        return data;
      });
    },
    get: async (pocketId: string) => {
      const cacheKey = `pockets:get:${pocketId}`;
      const cached = getCachedResponse<unknown>(cacheKey);
      if (cached) return cached;
      return withInFlightDedup(cacheKey, async () => {
        const data = await fetchWithAuth(`/pockets/${pocketId}`);
        setCachedResponse(cacheKey, data, 12_000);
        return data;
      });
    },
    getFresh: async (pocketId: string) => fetchWithAuth(`/pockets/${pocketId}`),
    activities: async (pocketId: string) => fetchWithAuth(`/pockets/${pocketId}/activities`),
    update: async (pocketId: string, body: { name?: string; tags?: string[] }) =>
      fetchWithAuth(`/pockets/${pocketId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    addTransaction: async (
      pocketId: string,
      body: PocketTransactionInput,
    ) => {
      const result = await fetchWithAuth(`/pockets/${pocketId}/transactions`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      invalidatePocketCache();
      return result;
    },
    updateTransaction: async (
      pocketId: string,
      transactionId: string,
      body: PocketTransactionInput,
    ) => {
      const result = await fetchWithAuth(`/pockets/${pocketId}/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      invalidatePocketCache();
      return result;
    },
    deleteTransaction: async (pocketId: string, transactionId: string) => {
      const result = await fetchWithAuth(`/pockets/${pocketId}/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'DELETE',
      });
      invalidatePocketCache();
      return result;
    },
    removeMember: async (pocketId: string, memberUid: string) => {
      const result = await fetchWithAuth(`/pockets/${pocketId}/members/${encodeURIComponent(memberUid)}`, {
        method: 'DELETE',
      });
      invalidatePocketCache();
      return result;
    },
    inviteByEmail: async (pocketId: string, email: string) =>
      fetchWithAuth(`/pockets/${pocketId}/invite/email`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    inviteByUid: async (pocketId: string, userUid: string) =>
      fetchWithAuth(`/pockets/${pocketId}/invite/user/${encodeURIComponent(userUid)}`, {
        method: 'POST',
      }),
    leave: async (pocketId: string) =>
      fetchWithAuth(`/pockets/${pocketId}/leave`, {
        method: 'POST',
      }),
    respondToInvite: async (pocketId: string, status: 'accepted' | 'rejected') => {
      const result = await fetchWithAuth(`/pockets/${pocketId}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      invalidatePocketCache();
      return result;
    },
  },

  quicksplits: {
    create: (body: {
      totalCents: number;
      targetParticipantCount?: number;
      creatorDisplayName?: string;
    }) => fetchQuicksplit('/quicksplits', { method: 'POST', body: JSON.stringify(body) }),

    get: (splitId: string, h: QuickSplitRequestTokens) =>
      fetchQuicksplit(`/quicksplits/${splitId}`, { method: 'GET', ...h }),

    update: (
      splitId: string,
      body: {
        totalCents?: number;
        targetParticipantCount?: number;
        payerParticipantId?: string;
        flowStep?: 'waiting' | 'splitting' | 'settlement' | 'closed';
        splitMode?: 'equal' | 'custom_amounts' | 'items';
        equalExcludedParticipantIds?: string[];
        splitItems?: Array<{
          id?: string;
          name: string;
          amountCents: number;
          consumerParticipantIds: string[];
        }>;
        distributeRemainderEqually?: boolean;
        remainderAssignments?: Array<{
          participantId: string;
          adjustmentCents: number;
        }>;
        customClaims?: Array<{
          participantId: string;
          claimedAmountCents: number;
        }>;
      },
      h: QuickSplitRequestTokens,
    ) =>
      fetchQuicksplit(`/quicksplits/${splitId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        ...h,
      }),

    updateParticipantClaim: (
      splitId: string,
      participantId: string,
      body: { claimedAmountCents: number },
      h: QuickSplitRequestTokens,
    ) =>
      fetchQuicksplit(`/quicksplits/${splitId}/participants/${participantId}/claim`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        ...h,
      }),

    join: (splitId: string, body: { displayName: string }, joinToken: string) =>
      fetchQuicksplit(`/quicksplits/${splitId}/join`, {
        method: 'POST',
        body: JSON.stringify(body),
        joinToken,
      }),

    updateParticipantPayment: (
      splitId: string,
      participantId: string,
      body: { iban?: string | null },
      h: QuickSplitRequestTokens,
    ) =>
      fetchQuicksplit(`/quicksplits/${splitId}/participants/${participantId}/payment`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        ...h,
      }),

    mine: async () => fetchWithAuth('/quicksplits/mine'),

    activities: (
      splitId: string,
      params: QuickSplitRequestTokens & { afterId?: string; limit?: number },
    ) => {
      const { afterId, limit, ...tokens } = params;
      const q = new URLSearchParams();
      if (afterId) q.set('afterId', afterId);
      if (limit) q.set('limit', String(limit));
      const qs = q.toString();
      return fetchQuicksplit(
        `/quicksplits/${splitId}/activities${qs ? `?${qs}` : ''}`,
        { method: 'GET', ...tokens },
      );
    },

    markParticipantPaid: (
      splitId: string,
      participantId: string,
      paid: boolean,
      h: QuickSplitRequestTokens,
    ) =>
      fetchQuicksplit(`/quicksplits/${splitId}/participants/${participantId}/paid`, {
        method: 'PATCH',
        body: JSON.stringify({ paid }),
        ...h,
      }),
  },
};
