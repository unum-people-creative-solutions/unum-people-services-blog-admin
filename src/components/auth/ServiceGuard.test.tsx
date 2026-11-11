import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import React from 'react'

import ServiceGuard from './ServiceGuard'
import { useAuthStore } from '@/store/useAuthStore'
import { useTenants } from '@/hooks/useTenants'
import { blogApi, cobrancaApi, ErroDaApi, EVENTO_COBRANCA_BLOQUEADA } from '@/lib/api'
import { comoMock } from '@/test/mocks'
import type { ResumoDeCobranca } from '@/types/cobranca'

const pushMock = vi.fn()
let pathname = '/posts'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock('@/hooks/useTenants', () => ({
  useTenants: vi.fn(),
}))

// Resumo de cobrança (GET /me/cobranca): em dia por padrão, contrato §4.1.
const { resumoEmDia } = vi.hoisted(() => {
  const resumoEmDia: ResumoDeCobranca = {
    situacao: 'em_dia',
    fatura: null,
    ferramentas_bloqueadas: [],
    pode_gerir: true,
  }
  return { resumoEmDia }
})

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  cobrancaApi: { resumo: vi.fn(() => Promise.resolve(resumoEmDia)) },
}))

describe('ServiceGuard', () => {
  beforeEach(() => {
    pathname = '/posts'
    pushMock.mockClear()
    vi.clearAllMocks()

    useAuthStore.setState({
      user: { email: 'admin@unum.com', groups: [] },
      token: 'token',
      refreshToken: null,
      enabledServices: ['blog'],
      isAuthenticated: true,
      isAdmin: false,
      hasHydrated: true,
      availableTenants: [{ id: 'tenant-1', name: 'Tenant One' }],
      activeTenantId: 'tenant-1',
      activeTenantName: 'Tenant One',
      tenantsLoaded: true,
    })

    vi.mocked(useTenants).mockReturnValue({
      tenants: [{ id: 'tenant-1', name: 'Tenant One' }],
      isLoading: false,
      tenantsLoaded: true,
    })
  })

  it('keeps routes in a loading state until hydration', () => {
    useAuthStore.setState({ hasHydrated: false })

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(screen.getByRole('status', { name: /verificando servicos contratados/i })).toBeInTheDocument()
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('keeps routes in a loading state while tenants are loading', () => {
    vi.mocked(useTenants).mockReturnValue({
      tenants: [],
      isLoading: true,
      tenantsLoaded: false,
    })

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(screen.getByRole('status', { name: /verificando servicos contratados/i })).toBeInTheDocument()
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
  })

  it('redirects to /403 if tenant list is empty after load', async () => {
    vi.mocked(useTenants).mockReturnValue({
      tenants: [],
      isLoading: false,
      tenantsLoaded: true,
    })

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/403'))
  })

  it('allows access and renders children if tenant list is loaded and not empty', async () => {
    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(screen.getByText('Blog Admin Area')).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
});

// cobranca-e-plano-do-cliente, fase 2 (RF2-61, RF2-63; BP-T §15.4 e UI-4 alterada).
describe('ServiceGuard - bloqueio por fatura em atraso', () => {
  const TENANT = '3f2b8c1e-9d4a-4e7b-a6c5-1b2d3e4f5a6b'
  const TITULO = 'Acesso bloqueado por fatura em atraso'

  // Conta de teste (BP-E §9), Suspenso, contrato §4.1.
  const suspenso: ResumoDeCobranca = {
    situacao: 'bloqueado',
    fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/abc' },
    vencida_em: '2026-11-05',
    pagar_ate: '2026-11-14',
    bloqueio_em: '2026-11-15',
    fora_do_ar_em: '2026-12-05',
    cancelamento_em: '2027-01-04',
    ferramentas_bloqueadas: ['crm', 'blog', 'lp'],
    pode_gerir: true,
  }

  beforeEach(() => {
    pathname = '/posts'
    vi.clearAllMocks()
    sessionStorage.clear()
    useAuthStore.setState({
      user: { email: 'dono@padariaze.com.br', groups: [] },
      token: 'token',
      refreshToken: null,
      enabledServices: ['blog'],
      isAuthenticated: true,
      isAdmin: false,
      hasHydrated: true,
      availableTenants: [{ id: TENANT, name: 'Padaria Zé' }],
      activeTenantId: TENANT,
      activeTenantName: 'Padaria Zé',
      tenantsLoaded: true,
    })
    vi.mocked(useTenants).mockReturnValue({
      tenants: [{ id: TENANT, name: 'Padaria Zé' }],
      isLoading: false,
      tenantsLoaded: true,
    })
    comoMock(cobrancaApi.resumo).mockResolvedValue(resumoEmDia)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('em dia: mostra o app e nenhuma tela de bloqueio', async () => {
    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    await waitFor(() => expect(cobrancaApi.resumo).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Blog Admin Area')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Bloqueio: blog em ferramentas_bloqueadas mostra a tela no lugar do app e não vai a /403', async () => {
    comoMock(cobrancaApi.resumo).mockResolvedValue(suspenso)

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toHaveFocus()
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('Bloqueio também quando /me/acessos já não dá o blog (Suspenso: contratada=false): tela, não /403', async () => {
    useAuthStore.setState({ enabledServices: [] })
    comoMock(cobrancaApi.resumo).mockResolvedValue(suspenso)

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument()
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('/403: sem o serviço no plano continua indo para /403', async () => {
    useAuthStore.setState({ enabledServices: [] })

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/403'))
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
  })

  it('fetchWithAuth: 403 com motivo "cobranca" numa chamada do app mostra a tela (relendo o resumo)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden', permissao: 'blog.post.ver', motivo: 'cobranca' }),
      })
    )
    comoMock(cobrancaApi.resumo).mockResolvedValueOnce(resumoEmDia).mockResolvedValueOnce(suspenso)
    const erros: unknown[] = []

    function ListaDePosts() {
      const [pediu, setPediu] = React.useState(false)
      return (
        <main>
          Blog Admin Area
          <button
            onClick={() => {
              setPediu(true)
              blogApi.listPosts().catch((e: unknown) => erros.push(e))
            }}
          >
            Carregar posts
          </button>
          {pediu && <span>pedido</span>}
        </main>
      )
    }

    render(
      <ServiceGuard>
        <ListaDePosts />
      </ServiceGuard>
    )
    await waitFor(() => expect(cobrancaApi.resumo).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Carregar posts' }))

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument()
    expect(cobrancaApi.resumo).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect((erros[0] as ErroDaApi).motivo).toBe('cobranca')
    expect(pushMock).not.toHaveBeenCalled()
  })

  // TASK-FIX-B07 (G3): BP-T §3, o 403 de cobrança mostra a tela mesmo que o resumo relido diga outra coisa.
  it('evento de 403 com motivo "cobranca" mostra a tela mesmo com o resumo relido em dia', async () => {
    comoMock(cobrancaApi.resumo).mockResolvedValue(resumoEmDia)

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )
    expect(await screen.findByText('Blog Admin Area')).toBeInTheDocument()
    await waitFor(() => expect(cobrancaApi.resumo).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_COBRANCA_BLOQUEADA))
    })

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument()
    expect(cobrancaApi.resumo).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Blog Admin Area')).not.toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  // DV-14 (revista em 11/11/2026): o operador (grupo GlobalAdmin no token) não vê a tela
  // de bloqueio e o 403 com motivo "cobranca" não vira bloqueio para ele.
  describe('operador (GlobalAdmin)', () => {
    beforeEach(() => {
      useAuthStore.setState({
        user: { email: 'operador@unumpeople.com.br', groups: ['GlobalAdmin'] },
        isAdmin: true,
        enabledServices: ['blog'],
      })
      comoMock(cobrancaApi.resumo).mockResolvedValue(suspenso)
    })

    it('empresa com o blog bloqueado: mostra o app, sem a tela de bloqueio e sem /403', async () => {
      render(
        <ServiceGuard>
          <main>Blog Admin Area</main>
        </ServiceGuard>
      )

      expect(await screen.findByText('Blog Admin Area')).toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.getByText('Blog Admin Area')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('403 com motivo "cobranca" não troca o app pela tela de bloqueio', async () => {
      comoMock(cobrancaApi.resumo).mockResolvedValue(resumoEmDia)
      render(
        <ServiceGuard>
          <main>Blog Admin Area</main>
        </ServiceGuard>
      )
      expect(await screen.findByText('Blog Admin Area')).toBeInTheDocument()

      act(() => {
        window.dispatchEvent(new CustomEvent(EVENTO_COBRANCA_BLOQUEADA))
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(screen.getByText('Blog Admin Area')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  it('UI-4: leitura do resumo com erro mostra o app com o aviso, e "Tentar de novo" relê', async () => {
    comoMock(cobrancaApi.resumo)
      .mockRejectedValueOnce(new ErroDaApi('internal_error', 500))
      .mockResolvedValueOnce(suspenso)

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Não conseguimos conferir a situação da conta agora.')
    expect(screen.getByText('Blog Admin Area')).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument()
    expect(cobrancaApi.resumo).toHaveBeenCalledTimes(2)
  })

  it('troca de empresa relê o resumo e, com a outra liberada, mostra o app', async () => {
    useAuthStore.setState({
      availableTenants: [
        { id: TENANT, name: 'Padaria Zé' },
        { id: 'outra-empresa', name: 'Doceria Zé' },
      ],
    })
    vi.mocked(useTenants).mockReturnValue({
      tenants: [
        { id: TENANT, name: 'Padaria Zé' },
        { id: 'outra-empresa', name: 'Doceria Zé' },
      ],
      isLoading: false,
      tenantsLoaded: true,
    })
    comoMock(cobrancaApi.resumo).mockResolvedValueOnce(suspenso).mockResolvedValueOnce(resumoEmDia)

    render(
      <ServiceGuard>
        <main>Blog Admin Area</main>
      </ServiceGuard>
    )
    await screen.findByRole('heading', { level: 1, name: TITULO })

    fireEvent.click(screen.getByRole('tab', { name: 'Doceria Zé' }))

    await waitFor(() => expect(cobrancaApi.resumo).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Blog Admin Area')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
    expect(useAuthStore.getState().activeTenantId).toBe('outra-empresa')
  })
})
