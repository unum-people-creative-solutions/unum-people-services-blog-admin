'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useTenants } from '@/hooks/useTenants';
import { cobrancaApi, EVENTO_COBRANCA_BLOQUEADA } from '@/lib/api';
import type { ResumoDeCobranca } from '@/types/cobranca';
import TelaDeBloqueioCobranca from './TelaDeBloqueioCobranca';

// Leitura de GET /me/cobranca de uma empresa (cobranca-e-plano-do-cliente RF2-63).
interface Leitura {
  tenantId: string;
  resumo: ResumoDeCobranca | null;
  erro: boolean;
}

const carregando = (
  <div
    role="status"
    aria-label="Verificando servicos contratados"
    className="flex items-center justify-center min-h-screen bg-slate-900"
  >
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" aria-hidden="true"></div>
  </div>
);

export default function ServiceGuard({ children }: { children: React.ReactNode }) {
  const { hasBlogService, hasHydrated, isAuthenticated, activeTenantId, isAdmin } = useAuthStore();
  const { tenants, tenantsLoaded } = useTenants();
  const router = useRouter();
  const pathname = usePathname();
  const isProtectedRoute = pathname !== '/403' && pathname !== '/auth/callback';
  // DV-14 (revista em 11/11/2026): o operador (GlobalAdmin no token) não vê a tela de bloqueio.
  const podeConsultarCobranca =
    isProtectedRoute && hasHydrated && isAuthenticated && !isAdmin && tenantsLoaded && tenants.length > 0 && !!activeTenantId;

  const [leitura, setLeitura] = useState<Leitura | null>(null);
  // Empresa em que a tela de bloqueio apareceu: fica até recarregar a página ou trocar de empresa.
  const [bloqueadoEm, setBloqueadoEm] = useState<string | null>(null);
  const requisicao = useRef(0);

  // Lê o resumo da empresa; a resposta de uma leitura anterior (outra empresa) é descartada.
  const lerResumo = useCallback((tenantId: string): Promise<void> => {
    const numero = ++requisicao.current;
    return cobrancaApi.resumo().then(
      (resumo) => {
        if (numero !== requisicao.current) return;
        setLeitura({ tenantId, resumo, erro: false });
        if (resumo.ferramentas_bloqueadas.includes('blog')) setBloqueadoEm(tenantId);
      },
      (erro: unknown) => {
        if (numero === requisicao.current) {
          setLeitura((anterior) => ({
            tenantId,
            resumo: anterior?.tenantId === tenantId ? anterior.resumo : null,
            erro: true,
          }));
        }
        throw erro;
      },
    );
  }, []);

  const recarregar = useCallback(async () => {
    const tenantId = useAuthStore.getState().activeTenantId;
    if (tenantId) await lerResumo(tenantId);
  }, [lerResumo]);

  // A falha da leitura fica em `leitura.erro` e aparece na tela (UI-4).
  const reler = useCallback(() => {
    recarregar().catch(() => undefined);
  }, [recarregar]);

  useEffect(() => {
    if (!podeConsultarCobranca || !activeTenantId) return;
    lerResumo(activeTenantId).catch(() => undefined);
  }, [podeConsultarCobranca, activeTenantId, lerResumo]);

  // Segunda barreira: 403 com motivo "cobranca" em qualquer chamada (fetchWithAuth).
  useEffect(() => {
    const aoBloquear = () => {
      // DV-14: o 403 com motivo "cobranca" não vira bloqueio para o operador.
      if (useAuthStore.getState().isAdmin) return;
      const tenantId = useAuthStore.getState().activeTenantId;
      if (tenantId) setBloqueadoEm(tenantId);
      reler();
    };
    window.addEventListener(EVENTO_COBRANCA_BLOQUEADA, aoBloquear);
    return () => window.removeEventListener(EVENTO_COBRANCA_BLOQUEADA, aoBloquear);
  }, [reler]);

  const leituraAtual = leitura && leitura.tenantId === activeTenantId ? leitura : null;
  const telaDeBloqueio = isProtectedRoute && !!activeTenantId && bloqueadoEm === activeTenantId;

  // Avisa o AuthGuard para não pôr o termo pendente por cima da tela (TASK-FIX-B06).
  const setTelaDeBloqueioCobranca = useAuthStore((estado) => estado.setTelaDeBloqueioCobranca);
  useEffect(() => {
    setTelaDeBloqueioCobranca(telaDeBloqueio);
  }, [telaDeBloqueio, setTelaDeBloqueioCobranca]);
  useEffect(() => () => setTelaDeBloqueioCobranca(false), [setTelaDeBloqueioCobranca]);

  useEffect(() => {
    if (isProtectedRoute && hasHydrated && isAuthenticated) {
      if (tenantsLoaded && tenants.length === 0) {
        router.push('/403');
      } else if (!hasBlogService() && !telaDeBloqueio) {
        // Sem o blog no acesso: antes de ir a /403, confere se é bloqueio por fatura (RF2-63).
        if (tenantsLoaded && (!activeTenantId || leituraAtual !== null)) {
          router.push('/403');
        }
      }
    }
  }, [hasBlogService, isAuthenticated, router, isProtectedRoute, hasHydrated, tenantsLoaded, tenants, telaDeBloqueio, activeTenantId, leituraAtual]);

  const avisoDeLeitura = (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-200"
    >
      <span>Não conseguimos conferir a situação da conta agora.</span>
      <button type="button" onClick={reler} className="font-semibold text-accent-400 underline hover:text-accent-500">
        Tentar de novo
      </button>
    </div>
  );

  if (telaDeBloqueio && activeTenantId) {
    if (leituraAtual?.resumo) {
      return (
        <TelaDeBloqueioCobranca resumo={leituraAtual.resumo} tenantId={activeTenantId} recarregar={recarregar} />
      );
    }
    return leituraAtual?.erro ? avisoDeLeitura : carregando;
  }

  const showLoading = isProtectedRoute && isAuthenticated && (
    !hasHydrated ||
    !tenantsLoaded ||
    !hasBlogService() ||
    tenants.length === 0
  );

  if (showLoading) {
    return carregando;
  }

  return (
    <>
      {isProtectedRoute && leituraAtual?.erro && avisoDeLeitura}
      {children}
    </>
  );
}
