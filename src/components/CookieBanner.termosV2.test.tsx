import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import CookieBanner from './CookieBanner';

// termos-crm-v2: o banner diz só o que o navegador guarda. O link vai para a
// política VIGENTE (/privacidade): link de versão quebra quando versões antigas
// saem do ar (v2 deu 404 em 11/2026).
describe('CookieBanner — Política de Privacidade vigente', () => {
  beforeEach(() => window.localStorage.clear());

  it('aponta para a política vigente', () => {
    render(<CookieBanner />);
    expect(screen.getByRole('link', { name: /Política de Privacidade/i })).toHaveAttribute(
      'href',
      'https://unumpeople.com.br/privacidade',
    );
  });

  it('diz o que guarda, sem prometer análise de tráfego nem personalização', () => {
    const { container } = render(<CookieBanner />);
    const texto = container.textContent ?? '';
    expect(texto).toMatch(/Guardamos no navegador só o necessário para manter seu login e lembrar esta escolha/);
    expect(texto).toMatch(/Não usamos cookies de análise de tráfego nem de publicidade/);
    expect(texto).not.toMatch(/analisar o tráfego|personalizar conteúdos/);
  });
});
