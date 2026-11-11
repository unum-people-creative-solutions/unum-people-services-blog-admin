
## 📚 Documentação Oficial (Arquitetura e TDDs)

**Nota Importante:** A documentação técnica detalhada, as regras de IA (Harness), os Technical Design Documents (TDDs) e o log de estado contínuo deste projeto **não ficam armazenados neste repositório**.

Para obter o contexto arquitetural completo e consultar o *Single Source of Truth* do ecossistema, acesse o repositório centralizado de documentação:
👉 **[unum-people-docs](https://github.com/unum-people-creative-solutions/unum-people-docs.git)**

# unum-people-services-blog-admin

Painel de administração (Next.js App Router) para gestão do blog institucional Unum People — CRUD de posts, publicação/despublicação e mídia.

## 1. Funcionalidades
- **Gestão de Posts:** criação, edição, exclusão, publicação/despublicação (`blogApi`, `src/lib/api.ts`), com upload de mídia via URL assinada. O `PUT` grava o original; `public_url` já é o WebP em `optimized/`. Publicar espera essa URL por até 15 s. A **mídia destacada** é a foto **ou** o vídeo do YouTube: o envio tira a mídia não escolhida (a API limpa o campo vazio), e o vídeo só aceita link do YouTube (`src/lib/youtube.ts`, mesmo critério do configurador).
- **Multi-tenant:** seletor de tenant (`TenantSwitcher`), com acesso condicionado ao serviço `blog` contratado pelo tenant (`ServiceGuard` — bloqueia em `/403` quando o tenant não tem o serviço ou não tem nenhum tenant vinculado; o blog bloqueado por fatura vai para a tela de bloqueio abaixo).
- **Bloqueio por fatura em atraso** (spec `cobranca-e-plano-do-cliente`, fase 2): o `ServiceGuard` lê `GET /me/cobranca` da empresa ativa (`cobrancaApi.resumo()`, `X-Tenant-ID` por `fetchWithAuth`; tipo em `src/types/cobranca.ts`). Com `blog` em `ferramentas_bloqueadas`, mostra a `TelaDeBloqueioCobranca` (`src/components/auth/`) no lugar do app, sem ir a `/403`: "Pagar fatura" (nova aba, só com `pode_gerir`), "Ir para o Portal do cliente" (`NEXT_PUBLIC_CUSTOMERS_URL` + `?tenant_id=`), `TenantSwitcher` acima da caixa e "Sair e voltar para o login". Depois de "Pagar fatura", a tela consulta o resumo sozinha por até 10 min (`src/hooks/useEsperaDoPagamento.ts`) e mostra "Pagamento confirmado" quando o blog sai da lista.
    - **403 com `motivo: "cobranca"`:** `ErroDaApi` traz `motivo`, e `fetchWithAuth` dispara `unum:cobranca-bloqueada` em `window` antes de lançar; o `ServiceGuard` abre a tela e relê o resumo.
    - **Termo pendente:** com a tela de bloqueio aberta, o `AuthGuard` não renderiza o `PendingTermsGate` (`telaDeBloqueioCobranca` no `useAuthStore`, não persistido): a fatura vem antes do termo.
    - **Depois de pagar:** sem o blog no acesso guardado e sem bloqueio no resumo, o `ServiceGuard` relê `GET /me/acessos` da empresa uma vez antes de ir a `/403` (o `enabledServices` do login pode estar velho). Com o blog contratado e `blog.post.ver`, o app abre; resposta que chega depois da troca de empresa é descartada.
    - **Falha ao ler o resumo (UI-4):** o app abre com a faixa "Não conseguimos conferir a situação da conta agora." e "Tentar de novo".
    - **Operador** (`GlobalAdmin`): não consulta o resumo nem vê a tela; o evento de 403 por cobrança é ignorado. A API também o libera.
- **Termos de Uso e Políticas Pendentes:** integrado via `PendingTermsGate`, que consulta `GET /me/terms/status` (via `termsApi.getStatus()`, com propagação automática de `X-Tenant-ID` por `fetchWithAuth`). Se houver alguma pendência acionável de termos ou políticas, o usuário é redirecionado para o Portal do Cliente (`customer.unumpeople.com.br`) para aceitação.

## 2. Autenticação (Cognito Hosted UI / SSO)
Não existe mais tela de login/esqueci-senha própria do app — `AuthGuard` redireciona (`window.location.href`, PKCE) para o domínio Hosted UI (`auth.unumpeople.com.br`, App Client dedicado deste app, provisionado em `Infraestrutura/unum-people-services-infra`). Fluxo:
- Sem sessão válida → `redirectToHostedUI` (`src/lib/pkce.ts`) gera `code_verifier`/`code_challenge` (CSPRNG + SHA-256), persiste o verifier em `sessionStorage` (uso único) e monta a URL de `/oauth2/authorize`.
- `src/app/auth/callback/page.tsx` troca `code`+`code_verifier` por tokens, decodifica os mesmos claims do fluxo antigo (`custom:tenant_id`, `cognito:groups`), lê `GET /me/acessos` para decidir o acesso ao blog (só o operador, grupo `GlobalAdmin`, pula essa leitura; desde a fase 5, `TenantAdmin` e `Admins` não contam, e o `isAdmin` guardado no navegador é recalculado ao recarregar) e redireciona pra `/posts` (acesso concedido) ou `/403` (sem serviço de blog contratado). Conta suspensa por fatura (o blog vem com `contratada: false`) também segue para `/posts`, e o `ServiceGuard` decide entre a tela de bloqueio e `/403`.
- Logout explícito ("Sair", `403`) usa `logoutFromHostedUI()` (endpoint `/oauth2/logout` do Cognito — encerra a sessão SSO de verdade); reautenticação silenciosa (401 da API, `AuthGuard`/`ServiceGuard` sem sessão) usa `redirectToHostedUI` (reaproveita a sessão SSO ainda válida).
- **Variáveis de ambiente necessárias:** `NEXT_PUBLIC_COGNITO_HOSTED_UI_DOMAIN`, `NEXT_PUBLIC_COGNITO_BLOG_CLIENT_ID` (só existem depois do `terraform apply` do repo de infra gerar o domínio/client ID reais).
- **Fora do Google:** o painel inteiro pede para não indexar (`robots` nos metadados de `src/app/layout.tsx`, `noindex, nofollow`) e o `robots.txt` (`src/app/robots.ts`) bloqueia tudo. Quem não está logado é mandado ao Hosted UI (`auth.unumpeople.com.br`), e por esse caminho o Google chegava a indexar a página vazia de login.

## 3. Testes
**Vitest** + **React Testing Library**.
- **Execução:** `npm test`
- **Cobertura crítica:** `AuthGuard`/`ServiceGuard`, `src/lib/pkce.ts`, `auth/callback`, `TelaDeBloqueioCobranca` e `useEsperaDoPagamento`.
