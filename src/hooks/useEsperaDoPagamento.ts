'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResumoDeCobranca } from '@/types/cobranca';

// Espera depois de "Pagar fatura" (cobranca-e-plano-do-cliente RF2-33, BP-T §5).
// Na tela de bloqueio do Blog admin, o pagamento está confirmado quando `blog`
// sai de `ferramentas_bloqueadas` (BP-T §5.4).

export type EstadoDaEspera = 'parado' | 'aguardando' | 'confirmado' | 'parcial' | 'sem_confirmacao';

const INTERVALO_MS = 15_000;
const LIMITE_MS = 10 * 60_000;
const FOCO_MIN_MS = 5_000;
const FALHAS_PARA_AVISO = 3;

interface Espera {
  clicado_em: number;
  vencimento: string;
}

const chaveDaEspera = (tenantId: string) => `cobranca-aguardando:${tenantId}`;

function lerEspera(tenantId: string): Espera | null {
  if (typeof window === 'undefined') return null;
  const bruto = window.sessionStorage.getItem(chaveDaEspera(tenantId));
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as Espera;
  } catch {
    return null;
  }
}

export function useEsperaDoPagamento(
  tenantId: string,
  resumo: ResumoDeCobranca,
  recarregar: () => Promise<void>,
) {
  const [tenantDaEspera, setTenantDaEspera] = useState(tenantId);
  const [espera, setEspera] = useState<Espera | null>(() => lerEspera(tenantId));
  const [estado, setEstado] = useState<EstadoDaEspera>(() => (lerEspera(tenantId) ? 'aguardando' : 'parado'));
  const [falhou, setFalhou] = useState(false);
  const [vencimentoPago, setVencimentoPago] = useState<string | null>(null);
  const [resumoVisto, setResumoVisto] = useState(resumo);

  const falhas = useRef(0);
  const ultimaConsultaDeFoco = useRef(0);
  const recarregarRef = useRef(recarregar);
  useEffect(() => {
    recarregarRef.current = recarregar;
  });

  // Outra empresa: retoma (ou não) a espera guardada para ela.
  if (tenantDaEspera !== tenantId) {
    const guardada = lerEspera(tenantId);
    setTenantDaEspera(tenantId);
    setEspera(guardada);
    setEstado(guardada ? 'aguardando' : 'parado');
    setFalhou(false);
  }

  // Cada resumo novo durante a espera decide o desfecho.
  if (resumo !== resumoVisto) {
    setResumoVisto(resumo);
    if (espera && (estado === 'aguardando' || estado === 'sem_confirmacao')) {
      if (!resumo.ferramentas_bloqueadas.includes('blog')) {
        setEstado('confirmado');
      } else if (resumo.fatura && resumo.fatura.vencimento !== espera.vencimento) {
        setVencimentoPago(espera.vencimento);
        setEstado('parcial');
      }
    }
  }

  // A chave só vive enquanto a espera está correndo.
  useEffect(() => {
    if (estado !== 'aguardando') {
      window.sessionStorage.removeItem(chaveDaEspera(tenantId));
    }
  }, [estado, tenantId]);

  const consultar = useCallback(() => {
    recarregarRef.current()
      .then(() => {
        falhas.current = 0;
        setFalhou(false);
      })
      .catch(() => {
        falhas.current += 1;
        if (falhas.current >= FALHAS_PARA_AVISO) setFalhou(true);
      });
  }, []);

  // Por intervalo, com a aba visível, até 10 min depois do clique.
  useEffect(() => {
    if (estado !== 'aguardando' || !espera) return;
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') consultar();
    }, INTERVALO_MS);
    const limite = window.setTimeout(() => {
      window.clearInterval(intervalo);
      setEstado('sem_confirmacao');
    }, Math.max(0, espera.clicado_em + LIMITE_MS - Date.now()));
    return () => {
      window.clearInterval(intervalo);
      window.clearTimeout(limite);
    };
  }, [estado, espera, consultar]);

  // Ao voltar o foco, no máximo uma vez a cada 5 s (vale também depois dos 10 min).
  useEffect(() => {
    if (estado !== 'aguardando' && estado !== 'sem_confirmacao') return;
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      const agora = Date.now();
      if (agora - ultimaConsultaDeFoco.current < FOCO_MIN_MS) return;
      ultimaConsultaDeFoco.current = agora;
      consultar();
    };
    window.addEventListener('focus', aoVoltar);
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.removeEventListener('focus', aoVoltar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [estado, consultar]);

  const iniciar = useCallback(
    (vencimento: string) => {
      const nova = { clicado_em: Date.now(), vencimento };
      window.sessionStorage.setItem(chaveDaEspera(tenantId), JSON.stringify(nova));
      falhas.current = 0;
      setFalhou(false);
      setEspera(nova);
      setEstado('aguardando');
    },
    [tenantId],
  );

  const fechar = useCallback(() => {
    setEspera(null);
    setEstado('parado');
  }, []);

  // SPEC_DEVIATION: além da interface do FE-P04, devolve `vencimentoPago`.
  // Reason: o texto do parcial (RF2-33) cita o vencimento guardado no clique,
  // que depois de recarregar a página só existe aqui.
  return { estado, falhou, vencimentoPago, iniciar, conferirAgora: consultar, fechar };
}
