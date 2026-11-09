import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CookieBanner from './CookieBanner';

describe('CookieBanner Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('deve exibir o banner se não houver consentimento prévio', () => {
    render(<CookieBanner />);
    expect(screen.getByText('Nós valorizamos sua privacidade')).toBeInTheDocument();
  });

  it('deve exibir o link de política de privacidade com as propriedades corretas', () => {
    render(<CookieBanner />);
    const link = screen.getByRole('link', { name: /Política de Privacidade/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('https://unumpeople.com.br/privacidade');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('não deve exibir o banner se o consentimento já existir', () => {
    window.localStorage.setItem('cookie-consent', 'all');
    render(<CookieBanner />);
    expect(screen.queryByText('Nós valorizamos sua privacidade')).not.toBeInTheDocument();
  });

  it('deve salvar "all" ao clicar em Aceitar Tudo', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);
    
    const button = screen.getByRole('button', { name: /Aceitar Tudo/i });
    await user.click(button);

    expect(window.localStorage.getItem('cookie-consent')).toBe('all');
    expect(screen.queryByText('Nós valorizamos sua privacidade')).not.toBeInTheDocument();
  });

  it('deve salvar "essential" ao clicar em Somente Essenciais', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);
    
    const button = screen.getByRole('button', { name: /Somente Essenciais/i });
    await user.click(button);

    expect(window.localStorage.getItem('cookie-consent')).toBe('essential');
    expect(screen.queryByText('Nós valorizamos sua privacidade')).not.toBeInTheDocument();
  });

  it('deve fechar o banner ao clicar no X sem salvar no localStorage', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);
    
    // O botão X não tem label, vamos usar o seletor por tag ou ícone se possível, 
    // mas o melhor é buscar pelo elemento que contém o ícone X
    const closeButton = screen.getAllByRole('button').find(btn => btn.querySelector('svg'));
    if (!closeButton) throw new Error('Botão de fechar não encontrado');
    
    await user.click(closeButton);

    expect(window.localStorage.getItem('cookie-consent')).toBeNull();
    expect(screen.queryByText('Nós valorizamos sua privacidade')).not.toBeInTheDocument();
  });
});
