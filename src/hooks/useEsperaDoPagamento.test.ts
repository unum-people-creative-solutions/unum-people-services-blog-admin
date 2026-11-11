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

// R6: a de 05/10 foi paga e ainda há a de 05/11 em aberto.
const bloqueadoComOutraFatura: ResumoDeCobranca = {
  ...bloqueado,
  fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/def' },
};
// Antes do pagamento parcial, DelinquencySince é o 1º vencimento: vencida_em = fatura.vencimento
// (cobranca_service.go), e as datas seguem dele (G8 do Verifier F2).
const bloqueadoAntesDoParcial: ResumoDeCobranca = {
  ...bloqueado,
  fatura: { valor: 39.9, vencimento: '2026-10-05', link: 'https://www.asaas.com/i/abc' },
  vencida_em: '2026-10-05',
  pagar_ate: '2026-10-14',
  bloqueio_em: '2026-10-15',
  fora_do_ar_em: '2026-11-04',
  cancelamento_em: '2026-12-04',
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
    const { result, rerender } = montar(bloqueadoAntesDoParcial);
    act(() => result.current.iniciar('2026-10-05'));

    rerender({
      resumo: {
        situacao: 'em_atraso',
        fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/def' },
        vencida_em: '2026-11-05',
        pagar_ate: '2026-11-14',
        bloqueio_em: '2026-11-15',
        fora_do_ar_em: '2026-12-05',
        cancelamento_em: '2027-01-04',
        ferramentas_bloqueadas: [],
        pode_gerir: true,
      },
    });

    expect(result.current.estado).toBe('confirmado');
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it('continua bloqueado com o mesmo vencimento: segue aguardando', () => {
    const { result, rerender } = montar();
    act(() => result.current.iniciar('2026-11-05'));

    rerender({ resumo: { ...bloqueado } });

    expect(result.current.estado).toBe('aguardando');
  });

  it('parcial (R6): vencimento diferente do guardado volta ao normal com a fatura paga', () => {
    const { result, rerender } = montar(bloqueadoAntesDoParcial);
    act(() => result.current.iniciar('2026-10-05'));

    rerender({ resumo: bloqueadoComOutraFatura });

    expect(result.current.estado).toBe('parcial');
    expect(result.current.vencimentoPago).toBe('2026-10-05');
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
