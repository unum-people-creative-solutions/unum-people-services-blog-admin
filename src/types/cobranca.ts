// Espelho exato do contrato de GET /me/cobranca (TECH-DESIGN cobranca-e-plano-do-cliente §4.1).
// Sem `reativacao`: ela só existe a partir da fase 4.

export type SituacaoDaCobranca =
  | 'em_dia'
  | 'em_atraso'
  | 'bloqueado'
  | 'fora_do_ar'
  | 'pausada'
  | 'cancelada'
  | 'outra';

export type FerramentaBloqueada = 'crm' | 'blog' | 'lp';

export interface FaturaDoResumo {
  valor: number;
  vencimento: string;
  link?: string;
}

export interface ResumoDeCobranca {
  situacao: SituacaoDaCobranca;
  fatura: FaturaDoResumo | null;
  vencida_em?: string;
  pagar_ate?: string;
  bloqueio_em?: string;
  fora_do_ar_em?: string;
  cancelamento_em?: string;
  ferramentas_bloqueadas: FerramentaBloqueada[];
  pode_gerir: boolean;
}
