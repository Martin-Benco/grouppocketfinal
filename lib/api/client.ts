const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  amountCents: number;
  tag?: string;
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

  quicksplits: {
    create: (body: { totalCents: number; creatorDisplayName?: string }) =>
      fetchQuicksplit('/quicksplits', { method: 'POST', body: JSON.stringify(body) }),

    get: (splitId: string, h: QuickSplitRequestTokens) =>
      fetchQuicksplit(`/quicksplits/${splitId}`, { method: 'GET', ...h }),

    update: (splitId: string, body: { totalCents?: number; payerParticipantId?: string }, h: QuickSplitRequestTokens) =>
      fetchQuicksplit(`/quicksplits/${splitId}`, {
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
  pockets: {
    mine: async () => fetchWithAuth('/pockets/mine'),
    create: async (body: {
      name: string;
      tags?: string[];
      initialTransactions?: PocketTransactionInput[];
      inviteEmails?: string[];
    }) =>
      fetchWithAuth('/pockets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: async (pocketId: string) => fetchWithAuth(`/pockets/${pocketId}`),
    activities: async (pocketId: string) => fetchWithAuth(`/pockets/${pocketId}/activities`),
    update: async (pocketId: string, body: { name?: string; tags?: string[] }) =>
      fetchWithAuth(`/pockets/${pocketId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    addTransaction: async (pocketId: string, body: PocketTransactionInput) =>
      fetchWithAuth(`/pockets/${pocketId}/transactions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    inviteByEmail: async (pocketId: string, email: string) =>
      fetchWithAuth(`/pockets/${pocketId}/invite/email`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    leave: async (pocketId: string) =>
      fetchWithAuth(`/pockets/${pocketId}/leave`, {
        method: 'POST',
      }),
  },
};
