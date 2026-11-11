import { useAuthStore, Tenant } from '@/store/useAuthStore';
import { redirectToHostedUI } from '@/lib/pkce';
import type { ResumoDeCobranca } from '@/types/cobranca';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface PapelResumo {
  id: string;
  nome: string;
  sistema: boolean;
  implicito: boolean;
}

export interface AcessoFerramenta {
  id: string;
  nome: string;
  contratada: boolean;
  papel: PapelResumo | null;
  permissoes: string[];
}

export interface MeusAcessos {
  tenant_id: string;
  operador: boolean;
  ferramentas: AcessoFerramenta[];
}

export class ErroDaApi extends Error {
  status: number;
  permissao?: string;
  motivo?: string;

  constructor(message: string, status: number, permissao?: string, motivo?: string) {
    super(message);
    this.name = 'ErroDaApi';
    this.status = status;
    this.permissao = permissao;
    this.motivo = motivo;
  }
}

// 403 com motivo "cobranca" (conta bloqueada por fatura em atraso): a tela de
// bloqueio ouve este evento e se mostra no lugar da ferramenta (RF2-61).
export const EVENTO_COBRANCA_BLOQUEADA = 'unum:cobranca-bloqueada';

export const MENSAGEM_SEM_PERMISSAO = 'Você não tem permissão para fazer isso nesta empresa.';

// 403 com permissão nomeada vira a frase fixa; o resto usa a mensagem do erro.
export function mensagemDeErro(err: unknown, padrao: string): string {
  const bruto = err as { status?: unknown; permissao?: unknown; message?: unknown } | null;
  if (bruto?.status === 403 && typeof bruto.permissao === 'string' && bruto.permissao.length > 0) {
    return MENSAGEM_SEM_PERMISSAO;
  }
  return typeof bruto?.message === 'string' && bruto.message ? bruto.message : padrao;
}

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const activeTenantId = useAuthStore.getState().activeTenantId;
  if (activeTenantId) {
    headers.set('X-Tenant-ID', activeTenantId);
  }

  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().logout();
      // TASK-FE-BLOG-003: não existe mais página /login própria do app.
      void redirectToHostedUI(window.location.pathname);
    }
    const errData = await response.json().catch(() => ({}));
    const permissao = typeof errData.permissao === 'string' ? errData.permissao : undefined;
    const motivo = typeof errData.motivo === 'string' ? errData.motivo : undefined;
    if (response.status === 403 && motivo === 'cobranca') {
      window.dispatchEvent(new CustomEvent(EVENTO_COBRANCA_BLOQUEADA));
    }
    throw new ErroDaApi(errData.error || `HTTP error! status: ${response.status}`, response.status, permissao, motivo);
  }

  return response.json();
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  content_md?: string;
  excerpt: string;
  cover_image_url?: string;
  video_url?: string;
  tags?: string[];
  status: 'DRAFT' | 'PUBLISHED';
  author_id: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

export const blogApi = {
  listTenants: async (service?: string): Promise<Tenant[]> => {
    const query = service ? `?service=${service}` : '';
    return fetchWithAuth(`/me/tenants${query}`);
  },

  listPosts: async (status?: string, limit = 10, lastKey?: string): Promise<{ posts: Post[]; last_key: string }> => {
    let query = `?limit=${limit}`;
    if (status) query += `&status=${status}`;
    if (lastKey) query += `&last_key=${encodeURIComponent(lastKey)}`;
    return fetchWithAuth(`/admin/blog/posts${query}`);
  },

  getPost: async (id: string): Promise<Post> => {
    return fetchWithAuth(`/admin/blog/posts/${id}`);
  },

  createPost: async (post: Partial<Post>): Promise<Post> => {
    return fetchWithAuth('/admin/blog/posts', {
      method: 'POST',
      body: JSON.stringify(post),
    });
  },

  updatePost: async (id: string, post: Partial<Post>): Promise<Post> => {
    return fetchWithAuth(`/admin/blog/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(post),
    });
  },

  deletePost: async (id: string): Promise<{ message: string }> => {
    return fetchWithAuth(`/admin/blog/posts/${id}`, {
      method: 'DELETE',
    });
  },

  publishPost: async (id: string): Promise<{ message: string }> => {
    return fetchWithAuth(`/admin/blog/posts/${id}/publish`, {
      method: 'POST',
    });
  },

  unpublishPost: async (id: string): Promise<{ message: string }> => {
    return fetchWithAuth(`/admin/blog/posts/${id}/unpublish`, {
      method: 'POST',
    });
  },

  getUploadURL: async (filename: string, contentType: string, size: number): Promise<{ url: string, public_url: string }> => {
    const data = await fetchWithAuth('/admin/blog/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename, content_type: contentType, size }),
    });
    return { url: data.upload_url, public_url: data.public_url };
  },
};
export interface PendingTermItem {
  type: string;
  term_id: string;
  term_name: string;
  required_version: number;
  can_accept: boolean;
  document_url: string;
}

export interface TermsStatusResponse {
  pending: PendingTermItem[];
}

export const termsApi = {
  getStatus: (): Promise<TermsStatusResponse> => fetchWithAuth('/me/terms/status'),
};

export const acessosApi = {
  get: (): Promise<MeusAcessos> => fetchWithAuth('/me/acessos'),
};

// GET /me/cobranca da empresa ativa (X-Tenant-ID por fetchWithAuth), RF2-60.
export const cobrancaApi = {
  resumo: (): Promise<ResumoDeCobranca> => fetchWithAuth('/me/cobranca'),
};

