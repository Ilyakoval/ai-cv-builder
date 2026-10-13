import type {
  ApiErrorDto,
  CvDetailDto,
  CvDocument,
  CvSummaryDto,
  UserDto,
} from '@cvb/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiErrorDto['details'],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorDto | null;
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  signup: (email: string, password: string) => request<UserDto>('/auth/signup', json('POST', { email, password })),
  login: (email: string, password: string) => request<UserDto>('/auth/login', json('POST', { email, password })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<UserDto>('/auth/me'),

  listCvs: () => request<CvSummaryDto[]>('/cvs'),
  getCv: (id: string) => request<CvDetailDto>(`/cvs/${id}`),
  createCv: (form: FormData) => request<CvDetailDto>('/cvs', { method: 'POST', body: form }),
  saveDocument: (id: string, version: number, document: CvDocument) =>
    request<CvDetailDto>(`/cvs/${id}/document`, json('PUT', { version, document })),
  renameCv: (id: string, title: string) => request<CvDetailDto>(`/cvs/${id}`, json('PATCH', { title })),
  deleteCv: (id: string) => request<void>(`/cvs/${id}`, { method: 'DELETE' }),
  regenerate: (id: string) => request<CvDetailDto>(`/cvs/${id}/regenerate`, { method: 'POST' }),
  answer: (id: string, questionId: string, answer: string) =>
    request<CvDetailDto>(`/cvs/${id}/questions/${questionId}/answer`, json('POST', { answer })),
  dismiss: (id: string, questionId: string) =>
    request<CvDetailDto>(`/cvs/${id}/questions/${questionId}/dismiss`, { method: 'POST' }),
  pdfUrl: (id: string) => `/api/cvs/${id}/pdf`,
};
