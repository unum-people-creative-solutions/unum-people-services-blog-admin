'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { redirectToHostedUI } from '@/lib/pkce';
import PendingTermsGate from './PendingTermsGate';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasHydrated, telaDeBloqueioCobranca } = useAuthStore();
  const pathname = usePathname();
  const isProtectedRoute = pathname !== '/403' && pathname !== '/auth/callback';

  useEffect(() => {
    if (isProtectedRoute && hasHydrated) {
      if (!isAuthenticated) {
        void redirectToHostedUI(pathname);
      }
    }
  }, [isAuthenticated, pathname, isProtectedRoute, hasHydrated]);

  if (isProtectedRoute && (!hasHydrated || !isAuthenticated)) {
    return (
      <div
        role="status"
        aria-label="Validando sessao"
        className="flex items-center justify-center min-h-screen bg-slate-900"
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" aria-hidden="true"></div>
      </div>
    );
  }

  return (
    <>
      {children}
      {/* A tela de bloqueio por cobrança vem primeiro: o termo pendente não a cobre (TASK-FIX-B06). */}
      {isProtectedRoute && hasHydrated && isAuthenticated && !telaDeBloqueioCobranca && <PendingTermsGate />}
    </>
  );
}
