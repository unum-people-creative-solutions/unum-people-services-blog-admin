import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEsperaDoPagamento } from './useEsperaDoPagamento';
import type { ResumoDeCobranca } from '@/types/cobranca';

// RF2-33 / BP-T §5 (espera depois de "Pagar fatura"), sinal da tela de bloqueio
// do Blog admin: `blog` saiu de `ferramentas_bloqueadas` (BP-T §5.4).

const TENANT = '3f2b8c1e-9d4a-4e7b-a6c5-1b2d3e4f5a6b';
const CHAVE = `cobranca-aguardando:${TENANT}`;
const AGORA = new Date('2026-11-16T13:00:00Z').getTime();

// Conta de teste (DelinquencySince 2026-11-05), Suspenso, contrato §4.1.
const bloqueado: ResumoDeCobranca = {
  situacao: 'bloqueado',
  fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/abc' },
  vencida_em: '2026-11-05',
  pagar_ate: '2026-11-14',
  bloqueio_em: '2026-11-15',
  fora_do_ar_em: '2026-12-05',
  cancelamento_em: '2027-01-04',
  ferramentas_bloqueadas: ['crm', 'blog', 'lp'],
  pode_gerir: true,
};

const emDia: ResumoDeCobranca = {
  situacao: 'em_dia',
  fatura: null,
  ferramentas_bloqueadas: [],
  pode_gerir: true,
};

// R6 com o par real de faturas mensais (TECH-DESIGN, proposta A): 31/01 e 28/02, as duas
// vencidas no D+29 (01/03). Antes do pagamento parcial, DelinquencySince é o vencimento mais
// antigo: vencida_em = fatura.vencimento = 31/01 e as datas seguem dele (+0/9/10/30/60).
const R6_AGORA = new Date('2026-03-01T13:00:00Z').getTime();
const bloqueadoComDuasVencidas: ResumoDeCobranca = {
  situacao: 'bloqueado',
  fatura: { valor: 39.9, vencimento: '2026-01-31', link: 'https://www.asaas.com/i/jan' },
  vencida_em: '2026-01-31',
  pagar_ate: '2026-02-09',
  bloqueio_em: '2026-02-10',
  fora_do_ar_em: '2026-03-02',
  cancelamento_em: '2026-04-01',
  ferramentas_bloqueadas: ['crm', 'blog', 'lp'],
  pode_gerir: true,
};
// Paga a de 31/01: o RF1-20 move DelinquencySince para 28/02 (dias = 1) e a conta volta a
// INADIMPLENTE: em_atraso, sem ferramentas bloqueadas.
const emAtrasoComA2802: ResumoDeCobranca = {
  situacao: 'em_atraso',
  fatura: { valor: 39.9, vencimento: '2026-02-28', link: 'https://www.asaas.com/i/fev' },
  vencida_em: '2026-02-28',
  pagar_ate: '2026-03-09',
  bloqueio_em: '2026-03-10',
  fora_do_ar_em: '2026-03-30',
  cancelamento_em: '2026-04-29',
  ferramentas_bloqueadas: [],
  pode_gerir: true,
};

let visibilidade: DocumentVisibilityState = 'visible';

function mudarVisibilidade(v: DocumentVisibilityState) {
  visibilidade = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useEsperaDoPagamento (Blog admin)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    sessionStorage.clear();
    visibilidade = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilidade,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function montar(resumoInicial: ResumoDeCobranca = bloqueado, recarregar = vi.fn().mockResolvedValue(undefined)) {
    const hook = renderHook(
      ({ resumo }: { resumo: ResumoDeCobranca }) => useEsperaDoPagamento(TENANT, resumo, recarregar),
      { initialProps: { resumo: resumoInicial } },
    );
    return { ...hook, recarregar };
  }

  it('começa parado e sem consultar', async () => {
    const { result, recarregar } = montar();

    expect(result.current.estado).toBe('parado');
    await avancar(60_000);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it('iniciar grava a chave por empresa com o horário do clique e o vencimento, e passa a aguardar', () => {
    const { result } = montar();

    act(() => result.current.iniciar('2026-11-05'));

    expect(result.current.estado).toBe('aguardando');
    expect(JSON.parse(sessionStorage.getItem(CHAVE) ?? 'null')).toEqual({
      clicado_em: AGORA,
      vencimento: '2026-11-05',
    });
  });

  it('consulta a cada 15 s com a aba visível, não antes', async () => {
    const { result, recarregar } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    await avancar(14_999);
    expect(recarregar).toHaveBeenCalledTimes(0);
    await avancar(1);
    expect(recarregar).toHaveBeenCalledTimes(1);
    await avancar(15_000);
    expect(recarregar).toHaveBeenCalledTimes(2);
  });

  it('com a aba escondida não consulta por intervalo; consulta ao voltar', async () => {
    const { result, recarregar } = montar();
    act(() => result.current.iniciar('2026-11-05'));
    act(() => mudarVisibilidade('hidden'));

    await avancar(45_000);
    expect(recarregar).toHaveBeenCalledTimes(0);

    act(() => mudarVisibilidade('visible'));
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('ao voltar o foco consulta na hora, no máximo uma vez a cada 5 s', async () => {
    const { result, recarregar } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    act(() => window.dispatchEvent(new Event('focus')));
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(1);

    await avancar(4_000);
    act(() => mudarVisibilidade('visible'));
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(1);

    await avancar(1_000);
    act(() => window.dispatchEvent(new Event('focus')));
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(2);
  });

  it('para aos 10 min: sem confirmação, apaga a chave e não consulta mais por intervalo; o foco continua valendo', async () => {
    const { result, recarregar } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    await avancar(10 * 60_000 - 1);
    expect(result.current.estado).toBe('aguardando');
    expect(recarregar).toHaveBeenCalledTimes(39);
    await avancar(1);
    expect(result.current.estado).toBe('sem_confirmacao');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();

    // "até 40 consultas por intervalo" (BP-T §5.2)
    const consultas = recarregar.mock.calls.length;
    expect(consultas).toBeLessThanOrEqual(40);
    await avancar(60_000);
    expect(recarregar).toHaveBeenCalledTimes(consultas);

    act(() => window.dispatchEvent(new Event('focus')));
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(consultas + 1);
  });

  it('conferirAgora faz uma consulta', async () => {
    const { result, recarregar } = montar();
    act(() => result.current.iniciar('2026-11-05'));
    await avancar(10 * 60_000);
    const antes = recarregar.mock.calls.length;

    await act(async () => {
      result.current.conferirAgora();
    });

    expect(recarregar).toHaveBeenCalledTimes(antes + 1);
  });

  it('confirmado quando blog sai de ferramentas_bloqueadas; a chave é apagada', async () => {
    const { result, rerender } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    rerender({ resumo: emDia });

    expect(result.current.estado).toBe('confirmado');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  // TASK-FIX-B08 (G4): R6 com o Suspenso voltando a Inadimplente. O sinal é o blog
  // sair de ferramentas_bloqueadas (BP-T §5.4), não a situação ficar em dia.
  it('confirmado quando o blog sai de ferramentas_bloqueadas com a conta ainda em atraso (outra fatura em aberto)', () => {
    vi.setSystemTime(R6_AGORA);
    const { result, rerender } = montar(bloqueadoComDuasVencidas);
    act(() => result.current.iniciar('2026-01-31'));

    rerender({ resumo: emAtrasoComA2802 });

    expect(result.current.estado).toBe('confirmado');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it('continua bloqueado com o mesmo vencimento: segue aguardando', () => {
    const { result, rerender } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    rerender({ resumo: { ...bloqueado } });

    expect(result.current.estado).toBe('aguardando');
  });

  // R6 real (31/01 paga, 28/02 ainda em atraso): a conta volta a em_atraso e o blog sai da
  // lista, então o desfecho na tela do Blog é o confirmado do BP-T §5.4, sem a linha do parcial.
  // O par antigo (05/10 e 05/11, conta ainda bloqueada) não acontece com fatura mensal.
  it('R6 real: pagar a de 31/01 com a de 28/02 em atraso dá confirmado, sem a linha do parcial', () => {
    vi.setSystemTime(R6_AGORA);
    const { result, rerender } = montar(bloqueadoComDuasVencidas);
    act(() => result.current.iniciar('2026-01-31'));

    rerender({ resumo: emAtrasoComA2802 });

    expect(result.current.estado).toBe('confirmado');
    expect(result.current.vencimentoPago).toBeNull();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  // TASK-FIX-B12c (RF2-33b): o ramo "parcial" fica como defesa e não é removido.
  // DEFESA, INALCANÇÁVEL COM CICLO MENSAL: a API não devolve "blog ainda bloqueado com outro
  // vencimento" depois de pagar a fatura mais antiga (o par real dá em_atraso sem ferramentas
  // bloqueadas, teste acima). O resumo "depois" é sintético, feito só para acionar o ramo.
  it('defesa (RF2-33b, inalcançável com ciclo mensal): blog ainda bloqueado com a fatura de 28/02 → "parcial" com o vencimento pago 31/01', () => {
    vi.setSystemTime(R6_AGORA);
    const { result, rerender } = montar(bloqueadoComDuasVencidas);
    act(() => result.current.iniciar('2026-01-31'));

    const sinteticoAindaBloqueadoComOutraFatura: ResumoDeCobranca = {
      ...bloqueadoComDuasVencidas,
      fatura: { valor: 39.9, vencimento: '2026-02-28', link: 'https://www.asaas.com/i/fev' },
    };
    rerender({ resumo: sinteticoAindaBloqueadoComOutraFatura });

    expect(result.current.estado).toBe('parcial');
    expect(result.current.vencimentoPago).toBe('2026-01-31');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it('três consultas seguidas com falha marcam falhou; uma consulta boa limpa', async () => {
    const recarregar = vi.fn().mockRejectedValue(new Error('rede'));
    const { result } = montar(bloqueado, recarregar);
    act(() => result.current.iniciar('2026-11-05'));

    await avancar(30_000);
    expect(result.current.falhou).toBe(false);
    await avancar(15_000);
    expect(result.current.falhou).toBe(true);
    expect(result.current.estado).toBe('aguardando');

    recarregar.mockResolvedValue(undefined);
    await avancar(15_000);
    expect(result.current.falhou).toBe(false);
  });

  it('recarregar a página com a chave guardada retoma a espera até completar 10 min do clique', async () => {
    sessionStorage.setItem(CHAVE, JSON.stringify({ clicado_em: AGORA - 60_000, vencimento: '2026-11-05' }));

    const { result } = montar();

    expect(result.current.estado).toBe('aguardando');
    await avancar(9 * 60_000 - 1);
    expect(result.current.estado).toBe('aguardando');
    await avancar(1);
    expect(result.current.estado).toBe('sem_confirmacao');
  });

  it('RF2-33a: recarregar com a espera iniciada há 10 min ou mais → "sem_confirmacao" já na montagem, chave apagada e sem consultas por intervalo', async () => {
    sessionStorage.setItem(CHAVE, JSON.stringify({ clicado_em: AGORA - 10 * 60_000, vencimento: '2026-11-05' }));
    const recarregar = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useEsperaDoPagamento(TENANT, bloqueado, recarregar), { wrapper: StrictMode });

    expect(result.current.estado).toBe('sem_confirmacao');
    await avancar(60_000);
    expect(result.current.estado).toBe('sem_confirmacao');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
    expect(recarregar).not.toHaveBeenCalled();

    // "Conferir agora" continua: uma consulta.
    act(() => result.current.conferirAgora());
    await avancar(0);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('a chave de outra empresa não retoma a espera', () => {
    sessionStorage.setItem('cobranca-aguardando:outra-empresa', JSON.stringify({ clicado_em: AGORA, vencimento: '2026-11-05' }));

    const { result } = montar();

    expect(result.current.estado).toBe('parado');
  });

  it('fechar volta a parado', () => {
    const { result, rerender } = montar();
    act(() => result.current.iniciar('2026-11-05'));
    rerender({ resumo: emDia });

    act(() => result.current.fechar());

    expect(result.current.estado).toBe('parado');
  });
});
