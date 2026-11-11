import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TelaDeBloqueioCobranca from './TelaDeBloqueioCobranca';
import { useAuthStore } from '@/store/useAuthStore';
import { logoutFromHostedUI } from '@/lib/pkce';
import type { ResumoDeCobranca } from '@/types/cobranca';

// RF2-62 (conteúdo do RF2-42, BP-T §8.1/§8.4/§8.5) e a espera do RF2-33 com o
// sinal "blog saiu de ferramentas_bloqueadas".

vi.mock('@/lib/pkce', () => ({
  logoutFromHostedUI: vi.fn(),
  redirectToHostedUI: vi.fn(),
}));

const TENANT = '3f2b8c1e-9d4a-4e7b-a6c5-1b2d3e4f5a6b';
const PORTAL = `https://customer.unumpeople.com.br?tenant_id=${TENANT}`;
const TITULO = 'Acesso bloqueado por fatura em atraso';
const BOLETO =
  'Já pagou por boleto? A confirmação leva até 3 dias úteis. O acesso volta sozinho quando o pagamento for confirmado.';

// Conta de teste (BP-E §9): R$ 39,90, DelinquencySince 2026-11-05, site+crm+blog.
const datas = {
  vencida_em: '2026-11-05',
  pagar_ate: '2026-11-14',
  bloqueio_em: '2026-11-15',
  fora_do_ar_em: '2026-12-05',
  cancelamento_em: '2027-01-04',
};

const suspensoGere: ResumoDeCobranca = {
  situacao: 'bloqueado',
  fatura: { valor: 39.9, vencimento: '2026-11-05', link: 'https://www.asaas.com/i/abc' },
  ...datas,
  ferramentas_bloqueadas: ['crm', 'blog', 'lp'],
  pode_gerir: true,
};

const suspensoNaoGere: ResumoDeCobranca = {
  ...suspensoGere,
  fatura: { valor: 39.9, vencimento: '2026-11-05' },
  pode_gerir: false,
};

const pausado: ResumoDeCobranca = {
  situacao: 'fora_do_ar',
  fatura: null,
  ...datas,
  ferramentas_bloqueadas: ['crm', 'blog', 'lp'],
  pode_gerir: true,
};

const emDia: ResumoDeCobranca = {
  situacao: 'em_dia',
  fatura: null,
  ferramentas_bloqueadas: [],
  pode_gerir: true,
};

const originalLocation = window.location;
const reload = vi.fn();

function montar(resumo: ResumoDeCobranca, recarregar = vi.fn().mockResolvedValue(undefined)) {
  const r = render(<TelaDeBloqueioCobranca resumo={resumo} tenantId={TENANT} recarregar={recarregar} />);
  return { ...r, recarregar };
}

describe('TelaDeBloqueioCobranca (Blog admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useAuthStore.setState({
      user: { email: 'dono@padariaze.com.br', groups: [] },
      token: 'token',
      isAuthenticated: true,
      availableTenants: [{ id: TENANT, name: 'Padaria Zé' }],
      activeTenantId: TENANT,
      activeTenantName: 'Padaria Zé',
    });
    // @ts-expect-error -- o jsdom não deixa trocar location sem apagá-la antes
    delete window.location;
    (window as unknown as { location: Location }).location = {
      ...originalLocation,
      href: 'http://localhost/posts',
      reload,
    } as Location;
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as unknown as { location: Location }).location = originalLocation;
  });

  it('Suspenso, gere: título com foco, texto com a véspera de fora_do_ar_em, boleto, pagar em nova aba e Portal', () => {
    montar(suspensoGere);

    const titulo = screen.getByRole('heading', { level: 1, name: TITULO });
    expect(titulo).toHaveFocus();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Sua página publicada continua no ar até 04/12. Pague a fatura de R$ 39,90, vencida em 05/11, para voltar a usar Páginas, CRM e blog.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(BOLETO)).toBeInTheDocument();

    const pagar = screen.getByRole('link', { name: /Pagar fatura/ });
    expect(pagar).toHaveAttribute('href', 'https://www.asaas.com/i/abc');
    expect(pagar).toHaveAttribute('target', '_blank');
    expect(pagar).toHaveAttribute('rel', 'noopener noreferrer');
    expect(pagar).toHaveAccessibleName(/abre em nova aba/);

    const portal = screen.getByRole('link', { name: 'Ir para o Portal do cliente' });
    expect(portal).toHaveAttribute('href', PORTAL);
    expect(portal).not.toHaveAttribute('target');
    expect(screen.queryByText('Avise o responsável')).not.toBeInTheDocument();
  });

  it('Suspenso, não gere: "Avise o responsável", sem pagar, com o Portal', () => {
    montar(suspensoNaoGere);

    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.getByText('Avise o responsável')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pagar fatura/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o Portal do cliente' })).toHaveAttribute('href', PORTAL);
  });

  it('Pausado: fora do ar, cancelamento, só o Portal (sem pagar e sem a linha do boleto)', () => {
    montar(pausado);

    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toHaveFocus();
    expect(
      screen.getByText(
        'Sua página está fora do ar por falta de pagamento. A conta será cancelada em 04/01. Para reativar, vá ao Portal do cliente.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pagar fatura/ })).not.toBeInTheDocument();
    expect(screen.queryByText(BOLETO)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o Portal do cliente' })).toHaveAttribute('href', PORTAL);
  });

  it('Suspenso sem fatura registrada: texto sem valor e a linha do e-mail com mailto', () => {
    montar({ ...suspensoGere, fatura: null });

    expect(
      screen.getByText(
        'Sua página publicada continua no ar até 04/12. Pague a fatura vencida em 05/11 para voltar a usar Páginas, CRM e blog.',
      ),
    ).toBeInTheDocument();
    const linha = screen.getByText(/Não conseguimos abrir o link da fatura\./);
    expect(linha).toHaveTextContent(
      'Não conseguimos abrir o link da fatura. Escreva para atendimento@unumpeople.com.br que enviamos para você.',
    );
    expect(screen.getByRole('link', { name: 'atendimento@unumpeople.com.br' })).toHaveAttribute(
      'href',
      'mailto:atendimento@unumpeople.com.br',
    );
    expect(screen.queryByRole('link', { name: /Pagar fatura/ })).not.toBeInTheDocument();
  });

  it('sem fatura e sem gerir: "Avise o responsável" no lugar da linha do e-mail', () => {
    montar({ ...suspensoNaoGere, fatura: null });

    expect(screen.getByText('Avise o responsável')).toBeInTheDocument();
    expect(screen.queryByText(/Não conseguimos abrir o link da fatura/)).not.toBeInTheDocument();
  });

  it('cita só as ferramentas bloqueadas do plano (D-3)', () => {
    montar({ ...suspensoGere, ferramentas_bloqueadas: ['blog', 'lp'] });

    expect(
      screen.getByText(
        'Sua página publicada continua no ar até 04/12. Pague a fatura de R$ 39,90, vencida em 05/11, para voltar a usar Páginas e blog.',
      ),
    ).toBeInTheDocument();
  });

  it('"Sair e voltar para o login" encerra a sessão e vai ao login', () => {
    montar(suspensoGere);

    fireEvent.click(screen.getByRole('button', { name: 'Sair e voltar para o login' }));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(logoutFromHostedUI).toHaveBeenCalledTimes(1);
  });

  it('com mais de uma empresa, o TenantSwitcher aparece acima da caixa; com uma, não', () => {
    const { unmount } = montar(suspensoGere);
    expect(screen.queryByRole('tablist', { name: 'Selecionar Tenant' })).not.toBeInTheDocument();
    unmount();

    useAuthStore.setState({
      availableTenants: [
        { id: TENANT, name: 'Padaria Zé' },
        { id: 'outra', name: 'Doceria Zé' },
      ],
    });
    montar(suspensoGere);

    expect(screen.getByRole('tablist', { name: 'Selecionar Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Doceria Zé' })).toBeInTheDocument();
  });

  it('Pagar fatura: mostra a espera e o pagar continua visível', () => {
    montar(suspensoGere);

    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    expect(screen.getByText('Aguardando a confirmação do pagamento')).toBeInTheDocument();
    expect(
      screen.getByText('Pix e cartão costumam confirmar em poucos minutos. Esta tela atualiza sozinha.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pagar fatura/ })).toBeInTheDocument();
    expect(sessionStorage.getItem(`cobranca-aguardando:${TENANT}`)).not.toBeNull();
  });

  it('liberação: blog sai da lista → "Pagamento confirmado" com foco, "Seu acesso está liberado." e "Continuar" recarrega', () => {
    const { rerender, recarregar } = montar(suspensoGere);
    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    rerender(<TelaDeBloqueioCobranca resumo={emDia} tenantId={TENANT} recarregar={recarregar} />);

    expect(screen.getByRole('heading', { name: 'Pagamento confirmado' })).toHaveFocus();
    expect(screen.getByText('Seu acesso está liberado.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // R6 com o par real de faturas mensais (TECH-DESIGN, proposta A): 31/01 e 28/02, as duas
  // vencidas no D+29 (01/03). Paga a de 31/01, o RF1-20 move DelinquencySince para 28/02 (dias = 1):
  // em_atraso, sem ferramentas bloqueadas. Na tela do Blog o desfecho é o confirmado (BP-T §5.4),
  // sem a linha do parcial. O par antigo (05/10 e 05/11, ainda bloqueada) não acontece.
  it('R6 real: paga a de 31/01 com a de 28/02 em atraso → "Pagamento confirmado", sem a linha do parcial', () => {
    const anterior: ResumoDeCobranca = {
      ...suspensoGere,
      fatura: { valor: 39.9, vencimento: '2026-01-31', link: 'https://www.asaas.com/i/jan' },
      vencida_em: '2026-01-31',
      pagar_ate: '2026-02-09',
      bloqueio_em: '2026-02-10',
      fora_do_ar_em: '2026-03-02',
      cancelamento_em: '2026-04-01',
    };
    const depois: ResumoDeCobranca = {
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
    const { rerender, recarregar } = montar(anterior);
    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    rerender(<TelaDeBloqueioCobranca resumo={depois} tenantId={TENANT} recarregar={recarregar} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Pagamento confirmado' })).toHaveFocus();
    expect(screen.getByText('Seu acesso está liberado.')).toBeInTheDocument();
    expect(screen.queryByText(/Recebemos o pagamento da fatura de 31\/01/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: TITULO })).not.toBeInTheDocument();
  });

  // TASK-FIX-B12c (RF2-33b): o ramo "parcial" fica como defesa e não é removido.
  // DEFESA, INALCANÇÁVEL COM CICLO MENSAL: a API não devolve "blog ainda bloqueado com outro
  // vencimento" depois de pagar a fatura mais antiga (o par real dá o confirmado, teste acima).
  // O resumo "depois" é sintético, feito só para acionar o ramo.
  it('defesa (RF2-33b, inalcançável com ciclo mensal): blog ainda bloqueado com a fatura de 28/02 → "Recebemos o pagamento da fatura de 31/01. Ainda há outra fatura em atraso."', () => {
    const anterior: ResumoDeCobranca = {
      ...suspensoGere,
      fatura: { valor: 39.9, vencimento: '2026-01-31', link: 'https://www.asaas.com/i/jan' },
      vencida_em: '2026-01-31',
      pagar_ate: '2026-02-09',
      bloqueio_em: '2026-02-10',
      fora_do_ar_em: '2026-03-02',
      cancelamento_em: '2026-04-01',
    };
    const sinteticoAindaBloqueadoComOutraFatura: ResumoDeCobranca = {
      ...anterior,
      fatura: { valor: 39.9, vencimento: '2026-02-28', link: 'https://www.asaas.com/i/fev' },
    };
    const { rerender, recarregar } = montar(anterior);
    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    rerender(
      <TelaDeBloqueioCobranca resumo={sinteticoAindaBloqueadoComOutraFatura} tenantId={TENANT} recarregar={recarregar} />,
    );

    expect(
      screen.getByText('Recebemos o pagamento da fatura de 31/01. Ainda há outra fatura em atraso.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pagamento confirmado' })).not.toBeInTheDocument();
  });

  it('10 min sem confirmar: mensagem, "Conferir agora" consulta uma vez e o pagar continua', async () => {
    vi.useFakeTimers();
    const { recarregar } = montar(suspensoGere);
    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(
      screen.getByText(
        'Ainda não recebemos a confirmação. Pix e cartão confirmam em poucos minutos. Boleto leva até 3 dias úteis. O acesso volta sozinho quando o pagamento for confirmado.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pagar fatura/ })).toBeInTheDocument();
    const antes = recarregar.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Conferir agora' }));
    });
    expect(recarregar).toHaveBeenCalledTimes(antes + 1);
  });

  it('RF2-33a: recarregar com a espera de 10 min ou mais → "Ainda não recebemos…" na região viva desde a montagem, "Conferir agora" e "Pagar fatura", sem consultas por intervalo', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(
      `cobranca-aguardando:${TENANT}`,
      JSON.stringify({ clicado_em: Date.now() - 10 * 60_000, vencimento: '2026-11-05' }),
    );
    const { recarregar } = montar(suspensoGere);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Ainda não recebemos a confirmação. Pix e cartão confirmam em poucos minutos. Boleto leva até 3 dias úteis. O acesso volta sozinho quando o pagamento for confirmado.',
    );
    expect(screen.queryByText('Aguardando a confirmação do pagamento')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pagar fatura/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferir agora' })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(recarregar).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`cobranca-aguardando:${TENANT}`)).toBeNull();
  });

  it('três consultas seguidas com falha: alerta com "Conferir agora"', async () => {
    vi.useFakeTimers();
    montar(suspensoGere, vi.fn().mockRejectedValue(new Error('rede')));
    fireEvent.click(screen.getByRole('link', { name: /Pagar fatura/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível conferir o pagamento agora. Tente de novo em instantes.',
    );
    expect(screen.getByRole('button', { name: 'Conferir agora' })).toBeInTheDocument();
  });
});
