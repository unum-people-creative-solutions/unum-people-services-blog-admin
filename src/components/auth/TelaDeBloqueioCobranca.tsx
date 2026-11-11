'use client';

import { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import TenantSwitcher from '@/components/TenantSwitcher';
import { useEsperaDoPagamento } from '@/hooks/useEsperaDoPagamento';
import { diaAnterior, ferramentasCitadas, formatarData, formatarReais } from '@/lib/cobrancaTexto';
import { logoutFromHostedUI } from '@/lib/pkce';
import { useAuthStore } from '@/store/useAuthStore';
import type { ResumoDeCobranca } from '@/types/cobranca';

// Tela de bloqueio por fatura em atraso (cobranca-e-plano-do-cliente RF2-62,
// BP-T §8.1, §8.4 e §8.5). Substitui o conteúdo do Blog admin; não é um diálogo.

interface Props {
  resumo: ResumoDeCobranca;
  tenantId: string;
  recarregar: () => Promise<void>;
}

const EMAIL_ATENDIMENTO = 'atendimento@unumpeople.com.br';
const CLASSE_BOTAO =
  'block w-full bg-accent-600 hover:bg-accent-500 text-slate-950 font-bold py-3 rounded-lg text-center';
const CLASSE_LINK = 'text-sm font-semibold text-accent-400 underline hover:text-accent-500';

const dataCurta = (data?: string) => (data ? formatarData(data) : '');

export default function TelaDeBloqueioCobranca({ resumo, tenantId, recarregar }: Props) {
  const { logout } = useAuthStore();
  const espera = useEsperaDoPagamento(tenantId, resumo, recarregar);
  const titulo = useRef<HTMLHeadingElement>(null);
  const confirmado = espera.estado === 'confirmado';

  useEffect(() => {
    titulo.current?.focus();
  }, [confirmado]);

  const sair = () => {
    logout();
    logoutFromHostedUI();
  };

  const customersUrl = process.env.NEXT_PUBLIC_CUSTOMERS_URL || 'https://customer.unumpeople.com.br';
  const linkDoPortal = `${customersUrl}?tenant_id=${encodeURIComponent(tenantId)}`;
  const ferramentas = ferramentasCitadas(resumo.ferramentas_bloqueadas);
  const foraDoAr = resumo.situacao === 'fora_do_ar';
  const linkDaFatura = !foraDoAr && resumo.pode_gerir ? resumo.fatura?.link : undefined;
  const esperando = espera.estado === 'aguardando' || espera.estado === 'sem_confirmacao';

  let texto: string;
  if (foraDoAr) {
    texto = `Sua página está fora do ar por falta de pagamento. A conta será cancelada em ${dataCurta(resumo.cancelamento_em)}. Para reativar, vá ao Portal do cliente.`;
  } else {
    const noArAte = resumo.fora_do_ar_em ? formatarData(diaAnterior(resumo.fora_do_ar_em)) : '';
    texto = resumo.fatura
      ? `Sua página publicada continua no ar até ${noArAte}. Pague a fatura de ${formatarReais(resumo.fatura.valor)}, vencida em ${formatarData(resumo.fatura.vencimento)}, para voltar a usar ${ferramentas}.`
      : `Sua página publicada continua no ar até ${noArAte}. Pague a fatura vencida em ${dataCurta(resumo.vencida_em)} para voltar a usar ${ferramentas}.`;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4">
      <div className="mb-4 w-full max-w-md">
        <TenantSwitcher />
      </div>

      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
        {confirmado ? (
          <>
            <h1 ref={titulo} tabIndex={-1} className="text-xl font-bold text-white mb-2 outline-none">
              Pagamento confirmado
            </h1>
            <p className="text-sm text-slate-400 mb-6">Seu acesso está liberado.</p>
            <button type="button" onClick={() => window.location.reload()} className={CLASSE_BOTAO}>
              Continuar
            </button>
          </>
        ) : (
          <>
            <h1 ref={titulo} tabIndex={-1} className="text-xl font-bold text-white mb-2 outline-none">
              Acesso bloqueado por fatura em atraso
            </h1>

            {espera.estado === 'parcial' && espera.vencimentoPago && (
              <p className="text-sm font-semibold text-white mb-2">
                Recebemos o pagamento da fatura de {formatarData(espera.vencimentoPago)}. Ainda há outra fatura em
                atraso.
              </p>
            )}

            <p className="text-sm text-slate-400 mb-2">{texto}</p>

            {!foraDoAr && (
              <p className="text-sm text-slate-400 mb-2">
                Já pagou por boleto? A confirmação leva até 3 dias úteis. O acesso volta sozinho quando o pagamento
                for confirmado.
              </p>
            )}

            {!foraDoAr && !resumo.fatura && resumo.pode_gerir && (
              <p className="text-sm text-slate-400 mb-2">
                Não conseguimos abrir o link da fatura. Escreva para{' '}
                <a href={`mailto:${EMAIL_ATENDIMENTO}`} className={CLASSE_LINK}>
                  {EMAIL_ATENDIMENTO}
                </a>{' '}
                que enviamos para você.
              </p>
            )}

            {!resumo.pode_gerir && (
              <p className="text-sm font-semibold text-slate-300 mb-2">Avise o responsável</p>
            )}

            {esperando && (
              <div role="status" className="mt-4 rounded-lg border border-slate-800 p-3 text-left">
                {espera.estado === 'aguardando' ? (
                  <>
                    <p className="text-sm font-bold text-white">Aguardando a confirmação do pagamento</p>
                    <p className="text-sm text-slate-400">
                      Pix e cartão costumam confirmar em poucos minutos. Esta tela atualiza sozinha.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    Ainda não recebemos a confirmação. Pix e cartão confirmam em poucos minutos. Boleto leva até 3
                    dias úteis. O acesso volta sozinho quando o pagamento for confirmado.
                  </p>
                )}
              </div>
            )}

            {espera.falhou && (
              <p role="alert" className="mt-4 text-sm font-semibold text-accent-400">
                Não foi possível conferir o pagamento agora. Tente de novo em instantes.
              </p>
            )}

            {(espera.estado === 'sem_confirmacao' || espera.falhou) && (
              <button
                type="button"
                onClick={espera.conferirAgora}
                className="mt-3 w-full border border-slate-700 text-slate-100 font-bold py-3 rounded-lg hover:bg-slate-800"
              >
                Conferir agora
              </button>
            )}

            <div className="mt-6 flex flex-col items-center gap-4">
              {linkDaFatura && (
                <a
                  href={linkDaFatura}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => espera.iniciar(resumo.fatura!.vencimento)}
                  className={`${CLASSE_BOTAO} inline-flex items-center justify-center gap-2`}
                >
                  Pagar fatura
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              )}
              <a href={linkDoPortal} className={linkDaFatura ? CLASSE_LINK : CLASSE_BOTAO}>
                Ir para o Portal do cliente
              </a>
            </div>
          </>
        )}

        <button type="button" onClick={sair} className={`mt-6 ${CLASSE_LINK}`}>
          Sair e voltar para o login
        </button>
      </div>
    </main>
  );
}
