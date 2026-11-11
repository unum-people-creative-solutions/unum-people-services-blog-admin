import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { blogApi, cobrancaApi, ErroDaApi, EVENTO_COBRANCA_BLOQUEADA } from './api';
import { useAuthStore } from '@/store/useAuthStore';
import type { ResumoDeCobranca } from '@/types/cobranca';

describe('api.ts - Tenant Headers and listTenants', () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockClear();

    // Reset AuthStore state
    useAuthStore.setState({
      token: 'mock-token',
      activeTenantId: null,
    });
  });

  it('should not include X-Tenant-ID header when activeTenantId is null', async () => {
    await blogApi.listPosts();

    expect(mockFetch).toHaveBeenCalled();
    const fetchArgs = mockFetch.mock.calls[0];
    const headers = fetchArgs[1].headers as Headers;
    
    expect(headers.get('Authorization')).toBe('Bearer mock-token');
    expect(headers.get('X-Tenant-ID')).toBeNull();
  });

  it('should include X-Tenant-ID header when activeTenantId is set', async () => {
    useAuthStore.setState({ activeTenantId: 'tenant-123' });

    await blogApi.listPosts();

    expect(mockFetch).toHaveBeenCalled();
    const fetchArgs = mockFetch.mock.calls[0];
    const headers = fetchArgs[1].headers as Headers;
    
    expect(headers.get('Authorization')).toBe('Bearer mock-token');
    expect(headers.get('X-Tenant-ID')).toBe('tenant-123');
  });

  it('should call GET /me/tenants?service=blog for listTenants', async () => {
    await blogApi.listTenants('blog');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/me/tenants?service=blog'),
      expect.any(Object)
    );
  });

  // blog-video (Verifier): o "" do editor chega ao corpo do PUT, que a API lê
  // como "tirar a capa / o vídeo".
  it('updatePost manda video_url e cover_image_url vazios no corpo do PUT', async () => {
    await blogApi.updatePost('post-1', { title: 'T', video_url: '', cover_image_url: '' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/blog\/posts\/post-1$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ title: 'T', video_url: '', cover_image_url: '' });
  });
});

// cobranca-e-plano-do-cliente, fase 2 (RF2-60, RF2-61; BP-T §15.4 "fetchWithAuth").
describe('api.ts - resumo de cobrança e 403 com motivo', () => {
  // Exemplo do contrato §4.1 do TECH-DESIGN, campo a campo.
  const resumoEmAtraso: ResumoDeCobranca = {
    situacao: 'em_atraso',
    fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/abc' },
    vencida_em: '2026-11-05',
    pagar_ate: '2026-11-14',
    bloqueio_em: '2026-11-15',
    fora_do_ar_em: '2026-12-05',
    cancelamento_em: '2027-01-04',
    ferramentas_bloqueadas: [],
    pode_gerir: true,
  };

  const resposta = (status: number, corpo: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  });

  const mockFetch = vi.fn();
  const ouvinte = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    ouvinte.mockReset();
    window.addEventListener(EVENTO_COBRANCA_BLOQUEADA, ouvinte);
    useAuthStore.setState({ token: 'mock-token', activeTenantId: 'tenant-123' });
  });

  afterEach(() => {
    window.removeEventListener(EVENTO_COBRANCA_BLOQUEADA, ouvinte);
  });

  it('o nome do evento é "unum:cobranca-bloqueada"', () => {
    expect(EVENTO_COBRANCA_BLOQUEADA).toBe('unum:cobranca-bloqueada');
  });

  it('cobrancaApi.resumo faz GET /me/cobranca com X-Tenant-ID da empresa ativa e devolve o resumo', async () => {
    mockFetch.mockResolvedValue(resposta(200, resumoEmAtraso));

    const resumo = await cobrancaApi.resumo();

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/me\/cobranca$/);
    expect(init.method ?? 'GET').toBe('GET');
    const headers = init.headers as Headers;
    expect(headers.get('X-Tenant-ID')).toBe('tenant-123');
    expect(headers.get('Authorization')).toBe('Bearer mock-token');
    expect(resumo).toEqual(resumoEmAtraso);
  });

  it('403 com motivo "cobranca": ErroDaApi carrega motivo e o evento sai antes do erro', async () => {
    mockFetch.mockResolvedValue(
      resposta(403, { error: 'forbidden', permissao: 'blog.post.ver', motivo: 'cobranca' }),
    );
    let eventoAntesDoErro = false;

    const erro = await blogApi.listPosts().catch((e: unknown) => {
      eventoAntesDoErro = ouvinte.mock.calls.length === 1;
      return e;
    });

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).status).toBe(403);
    expect((erro as ErroDaApi).permissao).toBe('blog.post.ver');
    expect((erro as ErroDaApi).motivo).toBe('cobranca');
    expect(eventoAntesDoErro).toBe(true);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('403 sem motivo: ErroDaApi sem motivo e nenhum evento', async () => {
    mockFetch.mockResolvedValue(resposta(403, { error: 'forbidden', permissao: 'blog.post.ver' }));

    const erro = await blogApi.listPosts().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).status).toBe(403);
    expect((erro as ErroDaApi).motivo).toBeUndefined();
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('motivo "cobranca" fora de um 403 não dispara o evento', async () => {
    mockFetch.mockResolvedValue(resposta(500, { error: 'internal_error', motivo: 'cobranca' }));

    const erro = await blogApi.listPosts().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).status).toBe(500);
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('cobrancaApi.resumo com erro lança ErroDaApi (não engole)', async () => {
    mockFetch.mockResolvedValue(resposta(500, { error: 'internal_error' }));

    const erro = await cobrancaApi.resumo().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).status).toBe(500);
    expect((erro as ErroDaApi).message).toBe('internal_error');
  });
});
