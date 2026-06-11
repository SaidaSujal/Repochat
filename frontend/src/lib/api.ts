import {
  RepositoryResponse,
  ChatResponse,
  ApiError,
  HistoryMessage
} from './types';

export class RepoChatApiError extends Error {
  status: number;
  raw: ApiError;

  constructor(status: number, raw: ApiError, message: string) {
    super(message);
    this.name = 'RepoChatApiError';
    this.status = status;
    this.raw = raw;
  }
}

export function mapApiError(status: number, data: ApiError): string {
  if (status === 404) {
    return typeof data.detail === 'string' 
      ? data.detail 
      : 'The requested repository could not be found. Please ingest it first.';
  }
  if (status === 410) {
    return typeof data.detail === 'string'
      ? data.detail
      : 'The repository cache has expired. Please re-ingest the repository.';
  }
  if (status === 429) {
    const rawMsg = typeof data.detail === 'string' 
      ? data.detail 
      : (data.error || '');
    const lower = rawMsg.toLowerCase();
    if (lower.includes('quota') || lower.includes('limit') || lower.includes('exhausted') || lower.includes('rate')) {
      return 'The public Gemini API key quota has been temporarily exhausted due to high traffic. Please retry in a few moments, or run RepoChat locally to use your own API key.';
    }
    return 'Too many requests. You have exceeded the hourly question limit (60 questions/hour). Please try again later or run RepoChat locally.';
  }
  if (status === 422) {
    if (Array.isArray(data.detail)) {
      return data.detail.map((err) => `${err.loc.join('.')}: ${err.msg}`).join(', ');
    }
    return typeof data.detail === 'string' ? data.detail : 'Invalid request parameters.';
  }
  if (status === 500) {
    const rawMsg = typeof data.detail === 'string' ? data.detail : '';
    const lower = rawMsg.toLowerCase();
    if (lower.includes('quota') || lower.includes('limit') || lower.includes('exhausted') || lower.includes('rate')) {
      return 'The public Gemini API key quota has been temporarily exhausted due to high traffic. Please retry in a few moments, or run RepoChat locally to use your own API key.';
    }
    return 'An unexpected server error occurred on the backend. Please check your inputs or try again later.';
  }
  return typeof data.detail === 'string' 
    ? data.detail 
    : (data.error || 'An unexpected error occurred. Please check your connection.');
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

if (!API_BASE && typeof window !== 'undefined') {
  console.error('[RepoChat Startup Error] NEXT_PUBLIC_API_URL environment variable is missing! API requests will fail.');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_BASE) {
    throw new Error('NEXT_PUBLIC_API_URL environment variable is required but is not defined.');
  }
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let errData: ApiError = {};
    try {
      errData = await response.json();
    } catch (e) {
      errData = { detail: response.statusText };
    }
    const userMsg = mapApiError(response.status, errData);
    throw new RepoChatApiError(response.status, errData, userMsg);
  }

  return response.json() as Promise<T>;
}

export const api = {
  async checkHealth(signal?: AbortSignal): Promise<{ status: string }> {
    return request<{ status: string }>('/api/health', {
      method: 'GET',
      signal,
    });
  },

  async ingestRepository(githubUrl: string, signal?: AbortSignal): Promise<RepositoryResponse> {
    return request<RepositoryResponse>('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ github_url: githubUrl }),
      signal,
    });
  },

  async getRepositoryMetadata(repoId: number, signal?: AbortSignal): Promise<RepositoryResponse> {
    return request<RepositoryResponse>(`/api/repositories/${repoId}`, {
      method: 'GET',
      signal,
    });
  },

  async getRepositorySummary(repoId: number, signal?: AbortSignal): Promise<{ summary: string }> {
    return request<{ summary: string }>(`/api/repositories/${repoId}/summary`, {
      method: 'GET',
      signal,
    });
  },

  async getRepositoryArchitecture(repoId: number, signal?: AbortSignal): Promise<{ architecture_overview: string }> {
    return request<{ architecture_overview: string }>(`/api/repositories/${repoId}/architecture`, {
      method: 'GET',
      signal,
    });
  },

  async chatAboutRepository(repoId: number, query: string, history?: HistoryMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    return request<ChatResponse>(`/api/repositories/${repoId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ query, history }),
      signal,
    });
  },
};
export default api;
