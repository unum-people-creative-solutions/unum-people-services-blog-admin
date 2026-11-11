import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AuthCallbackPage from './page';
import { useRouter, useSearchParams } from 'next/navigation';
import { jwtDecode } from 'jwt-decode';
import { useAuthStore } from '@/store/useAuthStore';
import { acessosApi, blogApi, type MeusAcessos } from '@/lib/api';
import { exchangeCodeForTokens, redirectToHostedUI } from '@/lib/pkce';
import { comoMock } from '@/test/mocks';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn(),
}));

const mockSetAuth = vi.fn();
const mockLogout = vi.fn();
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: Object.assign(
    (selector: (estado: { setAuth: typeof mockSetAuth }) => unknown) => selector({ setAuth: mockSetAuth }),
    { getState: () => ({ logout: mockLogout }) }
  ),
}));

vi.mock('@/lib/api', () => ({
  blogApi: {
    listPosts: vi.fn(),
  },
  acessosApi: {
    get: vi.fn(),
  },
}));

// spec: gestao-de-acesso-f4-aplicacao RF-06 — a sondagem por listPosts dá lugar a /me/acessos.
function acessosDoBlog(contratada: boolean, permissoes: string[]): MeusAcessos {
  return {
    tenant_id: 't1',
    operador: false,
    ferramentas: [
      { id: 'portal', nome: 'Portal do Cliente', contratada: true, papel: { id: 'membro', nome: 'Membro', sistema: true, implicito: false }, permissoes: ['portal.empresa.ver'] },
      { id: 'blog', nome: 'Blog', contratada, papel: { id: 'redator', nome: 'Redator', sistema: true, implicito: false }, permissoes },
    ],
  };
}
const REDATOR = ['blog.post.ver', 'blog.post.criar', 'blog.post.editar_proprio', 'blog.midia.enviar'];

vi.mock('@/lib/pkce', () => ({
  exchangeCodeForTokens: vi.fn(),
  redirectToHostedUI: vi.fn(),
  PKCE_VERIFIER_STORAGE_KEY: 'pkce_code_verifier',
  AUTH_RETURN_TO_STORAGE_KEY: 'auth_return_to',
}));

describe('AuthCallbackPage (TASK-FE-BLOG-002)', () => {
  const mockPush = vi.fn();

  const makeSearchParams = (code: string | null) => ({
    get: (key: string) => (key === 'code' ? code : null),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    comoMock(useRouter).mockReturnValue({ push: mockPush });
    comoMock(jwtDecode).mockReturnValue({
      email: 'editor@example.com',
      'cognito:groups': [],
    });
    comoMock(exchangeCodeForTokens).mockResolvedValue({
      id_token: 'id-token-abc',
      access_token: 'access-token-abc',
      refresh_token: 'refresh-token-abc',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  });

  it('exibe erro e não troca código quando o code_verifier não está em sessionStorage', async () => {
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão de login inválida ou expirada/i)).toBeInTheDocument();
    });
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mockSetAuth).not.toHaveBeenCalled();
  });

  it('consome o code_verifier uma única vez (removido de sessionStorage após a leitura)', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(true, REDATOR));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(exchangeCodeForTokens).toHaveBeenCalled();
    });
    expect(window.sessionStorage.getItem('pkce_code_verifier')).toBeNull();
  });

  it('GlobalAdmin tem bypass — não lê /me/acessos e vai para /posts', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(jwtDecode).mockReturnValue({ email: 'admin@example.com', 'cognito:groups': ['GlobalAdmin'] });

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts');
    });
    expect(acessosApi.get).not.toHaveBeenCalled();
    expect(mockSetAuth).toHaveBeenLastCalledWith(
      { email: 'admin@example.com', groups: ['GlobalAdmin'] },
      'id-token-abc',
      ['blog'],
      'refresh-token-abc'
    );
  });

  it('usuário comum com blog.post.ver no Blog contratado vai para /posts, sem sondar listPosts', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(true, REDATOR));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(acessosApi.get).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/posts');
    });
    expect(blogApi.listPosts).not.toHaveBeenCalled();
  });

  it('sem blog.post.ver no Blog vai para /403', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(true, []));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/403');
    });
  });

  // cobranca-e-plano-do-cliente TASK-FIX-B05 (G1): contratada=false também é a conta
  // Suspensa (PodeUsarAreaLogada). O login segue para o app e o ServiceGuard decide:
  // tela de bloqueio (blog em ferramentas_bloqueadas) ou /403 (blog fora do plano).
  it('Blog com contratada=false (fora do plano ou Suspenso) segue para /posts sem o serviço e o ServiceGuard decide', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(false, REDATOR));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts');
    });
    expect(mockPush).not.toHaveBeenCalledWith('/403');
    expect(mockSetAuth).toHaveBeenLastCalledWith(
      { email: 'editor@example.com', groups: [] },
      'id-token-abc',
      [],
      'refresh-token-abc'
    );
  });

  it('Blog com contratada=false volta para a rota pretendida (returnTo)', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    window.sessionStorage.setItem('auth_return_to', '/posts/123/edit');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(false, []));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts/123/edit');
    });
    expect(mockPush).not.toHaveBeenCalledWith('/403');
  });

  it('leitura dos acessos responde 403 (sem vínculo na empresa) vai para /403', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/403');
    });
  });

  // Comportamento preservado do login SRP antigo: um erro que NÃO seja 403 na
  // sondagem (ex.: instabilidade de rede) libera acesso por padrão em vez de
  // bloquear — preservado tal como estava, não é uma decisão nova desta task.
  it('erro não-403 na sondagem libera acesso (comportamento preservado do fluxo antigo)', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockRejectedValue(new Error('network error'));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts');
    });
  });

  it('redireciona para a rota originalmente pretendida quando o acesso é concedido', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    window.sessionStorage.setItem('auth_return_to', '/posts/123/edit');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(true, REDATOR));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts/123/edit');
    });
  });

  it('falha na troca de código nunca autentica silenciosamente — mostra erro e desloga', async () => {
    window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
    comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
    comoMock(exchangeCodeForTokens).mockRejectedValue(new Error('invalid_grant'));

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/não foi possível concluir o login/i)).toBeInTheDocument();
    });
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it('botão de "tentar novamente" no erro aciona redirectToHostedUI', async () => {
    comoMock(useSearchParams).mockReturnValue(makeSearchParams(null));

    render(<AuthCallbackPage />);

    const retryButton = await screen.findByText(/tentar novamente/i);
    retryButton.click();

    expect(redirectToHostedUI).toHaveBeenCalled();
  });

  // gestao-de-acesso-f5 RF-08: TenantAdmin e Admins não são mais atalho; passam por /me/acessos.
  it('TenantAdmin e Admins passam por /me/acessos, como qualquer usuário', async () => {
    for (const grupos of [['TenantAdmin'], ['Admins'], ['TenantAdmin', 'Admins']]) {
      vi.clearAllMocks();
      window.sessionStorage.setItem('pkce_code_verifier', 'verifier-abc');
      comoMock(useSearchParams).mockReturnValue(makeSearchParams('auth-code-123'));
      comoMock(jwtDecode).mockReturnValue({ email: 'dono@example.com', 'cognito:groups': grupos });
      comoMock(acessosApi.get).mockResolvedValue(acessosDoBlog(true, []));

      const { unmount } = render(<AuthCallbackPage />);
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/403'));
      expect(acessosApi.get).toHaveBeenCalled();
      unmount();
    }
  });
});
