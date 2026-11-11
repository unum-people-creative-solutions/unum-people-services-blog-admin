import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

import AuthGuard from './AuthGuard'
import ServiceGuard from './ServiceGuard'
import { useAuthStore } from '@/store/useAuthStore'
import { redirectToHostedUI } from '@/lib/pkce'
import { useTenants } from '@/hooks/useTenants'
import { cobrancaApi } from '@/lib/api'
import { comoMock } from '@/test/mocks'
import type { ResumoDeCobranca } from '@/types/cobranca'

let pathname = '/posts'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/useTenants', () => ({
  useTenants: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  cobrancaApi: { resumo: vi.fn() },
}))

vi.mock('@/lib/pkce', () => ({
  redirectToHostedUI: vi.fn(),
}))

vi.mock('./PendingTermsGate', () => ({
  default: () => <div data-testid="pending-terms-gate" />,
}))

describe('AuthGuard', () => {
  beforeEach(() => {
    pathname = '/posts'
    vi.clearAllMocks()
    useAuthStore.setState({
      user: null,
      token: null,
      refreshToken: null,
      enabledServices: [],
      isAuthenticated: false,
      isAdmin: false,
      hasHydrated: false,
    })
  })

  it('keeps protected routes in an accessible loading state until auth storage hydrates', () => {
    render(
      <AuthGuard>
        <main>Dashboard protegido</main>
      </AuthGuard>
    )

    expect(screen.getByRole('status', { name: /validando sessao/i })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard protegido')).not.toBeInTheDocument()
    expect(redirectToHostedUI).not.toHaveBeenCalled()
  })

  it('redirects protected routes to the Hosted UI (Cognito) after hydration when not authenticated', async () => {
    useAuthStore.setState({ hasHydrated: true })

    render(
      <AuthGuard>
        <main>Dashboard protegido</main>
      </AuthGuard>
    )

    await waitFor(() => expect(redirectToHostedUI).toHaveBeenCalledWith('/posts'))
  })

  it('renders children if authenticated', async () => {
    useAuthStore.setState({ hasHydrated: true, isAuthenticated: true })

    render(
      <AuthGuard>
        <main>Dashboard protegido</main>
      </AuthGuard>
    )

    expect(screen.getByText('Dashboard protegido')).toBeInTheDocument()
    expect(redirectToHostedUI).not.toHaveBeenCalled()
  })

  describe('PendingTermsGate Integration', () => {
    it('exibe o PendingTermsGate em rotas protegidas quando autenticado', async () => {
      useAuthStore.setState({ hasHydrated: true, isAuthenticated: true })

      render(
        <AuthGuard>
          <main>Dashboard protegido</main>
        </AuthGuard>
      )

      expect(screen.getByTestId('pending-terms-gate')).toBeInTheDocument()
    })

    it('não exibe o PendingTermsGate em rotas públicas', async () => {
      pathname = '/403'
      useAuthStore.setState({ hasHydrated: true, isAuthenticated: false })

      render(
        <AuthGuard>
          <main>Dashboard protegido</main>
        </AuthGuard>
      )

      expect(screen.getByText('Dashboard protegido')).toBeInTheDocument()
      expect(screen.queryByTestId('pending-terms-gate')).not.toBeInTheDocument()
    })
  })

  // cobranca-e-plano-do-cliente TASK-FIX-B06 (G2): a tela de bloqueio tem prioridade
  // sobre o termo pendente, como no CRM (RF2-53, UI-3: nada cobre a tela).
  describe('tela de bloqueio por cobrança e termo pendente', () => {
    const TENANT = '3f2b8c1e-9d4a-4e7b-a6c5-1b2d3e4f5a6b'
    const TITULO = 'Acesso bloqueado por fatura em atraso'
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
    const emDia: ResumoDeCobranca = {
      situacao: 'em_dia',
      fatura: null,
      ferramentas_bloqueadas: [],
      pode_gerir: true,
    }

    beforeEach(() => {
      sessionStorage.clear()
      useAuthStore.setState({
        user: { email: 'dono@padariaze.com.br', groups: [] },
        token: 'token',
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
    })

    function montar() {
      return render(
        <AuthGuard>
          <ServiceGuard>
            <main>Dashboard protegido</main>
          </ServiceGuard>
        </AuthGuard>
      )
    }

    it('com o blog bloqueado, mostra a tela e não renderiza o PendingTermsGate por cima', async () => {
      comoMock(cobrancaApi.resumo).mockResolvedValue(suspenso)

      montar()

      expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument()
      expect(screen.queryByTestId('pending-terms-gate')).not.toBeInTheDocument()
      expect(screen.queryByText('Dashboard protegido')).not.toBeInTheDocument()
    })

    it('em dia, o PendingTermsGate continua aparecendo', async () => {
      comoMock(cobrancaApi.resumo).mockResolvedValue(emDia)

      montar()

      await waitFor(() => expect(cobrancaApi.resumo).toHaveBeenCalledTimes(1))
      expect(await screen.findByText('Dashboard protegido')).toBeInTheDocument()
      expect(screen.getByTestId('pending-terms-gate')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument()
    })
  })
})
