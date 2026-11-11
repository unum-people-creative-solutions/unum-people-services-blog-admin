import { afterEach, describe, expect, it } from 'vitest';
import { diaAnterior, ferramentasCitadas, formatarData, formatarReais } from './cobrancaTexto';

const tzOriginal = process.env.TZ;

describe('formatarData (RF2-21)', () => {
  afterEach(() => {
    process.env.TZ = tzOriginal;
  });

  it('"2026-11-05" vira "05/11" com TZ=UTC e com TZ=America/Sao_Paulo (DV-16)', () => {
    process.env.TZ = 'UTC';
    expect(formatarData('2026-11-05')).toBe('05/11');

    process.env.TZ = 'America/Sao_Paulo';
    expect(formatarData('2026-11-05')).toBe('05/11');
  });

  it('virada de ano: "2027-01-04" vira "04/01" nos dois fusos', () => {
    process.env.TZ = 'UTC';
    expect(formatarData('2027-01-04')).toBe('04/01');

    process.env.TZ = 'America/Sao_Paulo';
    expect(formatarData('2027-01-04')).toBe('04/01');
  });
});

describe('diaAnterior (DV-19: "continua no ar até" = fora_do_ar_em − 1 dia)', () => {
  afterEach(() => {
    process.env.TZ = tzOriginal;
  });

  it('2026-12-05 → 2026-12-04 nos dois fusos', () => {
    process.env.TZ = 'UTC';
    expect(diaAnterior('2026-12-05')).toBe('2026-12-04');

    process.env.TZ = 'America/Sao_Paulo';
    expect(diaAnterior('2026-12-05')).toBe('2026-12-04');
  });

  it('volta o mês e o ano quando é o dia 1', () => {
    expect(diaAnterior('2026-12-01')).toBe('2026-11-30');
    expect(diaAnterior('2027-01-01')).toBe('2026-12-31');
    expect(diaAnterior('2027-03-01')).toBe('2027-02-28');
    expect(diaAnterior('2028-03-01')).toBe('2028-02-29');
  });
});

describe('formatarReais (RF2-22)', () => {
  it('39.9 → "R$ 39,90"', () => {
    expect(formatarReais(39.9)).toBe('R$ 39,90');
  });

  it('1198.8 → "R$ 1.198,80"', () => {
    expect(formatarReais(1198.8)).toBe('R$ 1.198,80');
  });
});

describe('ferramentasCitadas (RF2-23)', () => {
  it('só Páginas', () => {
    expect(ferramentasCitadas(['lp'])).toBe('Páginas');
  });

  it('Páginas e CRM', () => {
    expect(ferramentasCitadas(['crm', 'lp'])).toBe('Páginas e CRM');
  });

  it('Páginas e blog', () => {
    expect(ferramentasCitadas(['blog', 'lp'])).toBe('Páginas e blog');
  });

  it('Páginas, CRM e blog', () => {
    expect(ferramentasCitadas(['crm', 'blog', 'lp'])).toBe('Páginas, CRM e blog');
  });
});
