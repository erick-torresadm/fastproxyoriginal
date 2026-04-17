# FastProxy — Documentação Técnica Completa

> Versão: 2.0 | Atualizado: Abril 2026 | Domínio: https://fastproxy.com.br

---

## Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Variáveis de Ambiente](#3-variáveis-de-ambiente)
4. [Banco de Dados — Tabelas e Esquema](#4-banco-de-dados--tabelas-e-esquema)
5. [Rotas da API](#5-rotas-da-api)
6. [Lógica de Negócio — Fluxos Principais](#6-lógica-de-negócio--fluxos-principais)
7. [Sistema de Cupons](#7-sistema-de-cupons)
8. [Integração ProxySeller](#8-integração-proxyseller)
9. [Integração Stripe](#9-integração-stripe)
10. [Sistema de E-mail (Resend)](#10-sistema-de-e-mail-resend)
11. [Autenticação e Segurança](#11-autenticação-e-segurança)
12. [Conformidade Legal](#12-conformidade-legal)
13. [Páginas do Frontend](#13-páginas-do-frontend)
14. [Planos Disponíveis](#14-planos-disponíveis)
15. [Sistema de Recompensas](#15-sistema-de-recompensas)
16. [Painel Administrativo](#16-painel-administrativo)
17. [Deploy e Infraestrutura](#17-deploy-e-infraestrutura)
18. [Diagnóstico e Troubleshooting](#18-diagnóstico-e-troubleshooting)

---

## 1. Visão Geral da Arquitetura

```
                    ┌─────────────────────────────┐
                    │      fastproxy.com.br        │
                    │   (Vercel — Edge + CDN)      │
                    └────────────┬────────────────-┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        Static Files       /api/* routes       Webhooks
        (public/**)        (server.js)         (Stripe)
              │                  │                  │
        Vercel CDN         Express.js          /api/stripe/webhook
                           (serverless)
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        NeonDB              ProxySeller         Resend
        (PostgreSQL)         API v1             (Email)
```

**Modelo de cobrança:** Pagamentos únicos por período (não assinatura automática Stripe).
Cada renovação mensal é um novo pedido manual pelo cliente — isso permite controle total do ciclo e aplicação de cupons exclusivos para primeira assinatura.

---

## 2. Stack Tecnológico

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Banco de dados | NeonDB (PostgreSQL serverless) |
| Pagamentos | Stripe Checkout Sessions |
| Fornecedor de proxies | ProxySeller API v1 |
| E-mail transacional | Resend |
| Deploy | Vercel (serverless functions) |
| Autenticação | JWT (jsonwebtoken) |
| Hash de senha | bcryptjs |
| Frontend | HTML + Tailwind CSS (CDN) |

---

## 3. Variáveis de Ambiente

Configure no painel Vercel → Settings → Environment Variables.

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | ✅ | Connection string do NeonDB (postgres://...) |
| `STRIPE_SECRET_KEY` | ✅ | Chave secreta do Stripe (sk_live_... ou sk_test_...) |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | Chave pública do Stripe (pk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Segredo do webhook Stripe (whsec_...) |
| `STRIPE_TEST_MODE` | ⬜ | `"true"` para usar chaves de teste |
| `PROXYSELLER_API_KEY` | ✅ | API Key do painel ProxySeller |
| `RESEND_API_KEY` | ✅ | API Key da Resend (re_...) |
| `JWT_SECRET` | ⬜ | Segredo para assinar JWTs (padrão: fastproxy_secret_key_2024) |
| `JWT_EXPIRE` | ⬜ | Expiração do token (padrão: 7d) |
| `APP_URL` | ✅ | URL base: `https://fastproxy.com.br` (com https://, sem barra final) |
| `TELEGRAM_BOT_TOKEN` | ⬜ | Token do bot Telegram para notificações |
| `TELEGRAM_CHAT_ID` | ⬜ | Chat ID para envio das notificações |
| `PROXY_IP` | ⬜ | IP base dos proxies próprios (sistema legado) |
| `PROXY_PORT_START` | ⬜ | Porta inicial do range |
| `PROXY_PORT_END` | ⬜ | Porta final do range |

> **Importante:** Após alterar variáveis no Vercel, é necessário fazer um novo deploy (push no git ou "Redeploy" manual no painel).

---

## 4. Banco de Dados — Tabelas e Esquema

Todas as tabelas são criadas automaticamente via `lib/database.js` na inicialização do servidor. Colunas adicionadas posteriormente usam `ADD COLUMN IF NOT EXISTS` para compatibilidade.

### `users`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID único |
| `email` | VARCHAR(255) UNIQUE | E-mail (usado no login) |
| `password` | VARCHAR(255) | Hash bcrypt |
| `name` | VARCHAR(255) | Nome completo |
| `whatsapp` | VARCHAR(50) | WhatsApp |
| `role` | VARCHAR(20) | `user` ou `admin` (padrão: `user`) |
| `created_at` | TIMESTAMP | Data de cadastro |
| `updated_at` | TIMESTAMP | Última atualização |

### `proxy_orders`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID do pedido |
| `user_id` | INTEGER → users | Dono do pedido |
| `stripe_session_id` | VARCHAR(255) | Session ID do Stripe |
| `stripe_payment_intent` | VARCHAR(255) | PaymentIntent do Stripe |
| `proxyseller_order_id` | VARCHAR(100) | ID do pedido na ProxySeller |
| `proxyseller_order_number` | VARCHAR(100) | Número do pedido na ProxySeller |
| `proxy_type` | VARCHAR(20) | `ipv6`, `ipv4`, `isp`, `mobile` |
| `country` | VARCHAR(50) | País dos proxies (padrão: Brazil) |
| `country_id` | INTEGER | ID do país na ProxySeller |
| `quantity` | INTEGER | Quantidade comprada |
| `period` | VARCHAR(20) | `1m`, `6m`, `12m` |
| `period_days` | INTEGER | Dias totais do período |
| `cost_usd` | DECIMAL(10,2) | Custo em USD (ProxySeller) |
| `cost_brl` | DECIMAL(10,2) | Custo em BRL (cost_usd × taxa câmbio) |
| `price_sold_brl` | DECIMAL(10,2) | Preço vendido ao cliente |
| `status` | VARCHAR(30) | `pending`, `paid`, `active`, `expired`, `cancelled` |
| `payment_status` | VARCHAR(20) | `pending`, `paid`, `failed` |
| `expira_em` | TIMESTAMP | Data de expiração dos proxies |
| `buyer_name` | VARCHAR(255) | Nome completo do comprador |
| `buyer_document` | VARCHAR(50) | CPF ou CNPJ |
| `buyer_whatsapp` | VARCHAR(50) | WhatsApp do comprador |
| `buyer_address` | VARCHAR(255) | Endereço (cidade - UF) |
| `buyer_email` | VARCHAR(255) | E-mail do comprador |
| `terms_accepted` | BOOLEAN | Aceitou os termos de uso? |
| `terms_accepted_at` | TIMESTAMP | Quando aceitou |
| `created_at` | TIMESTAMP | Data do pedido |

### `proxyseller_proxies`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID interno |
| `proxy_order_id` | INTEGER → proxy_orders | Pedido pai |
| `user_id` | INTEGER → users | Usuário dono |
| `proxyseller_proxy_id` | VARCHAR(100) | ID na ProxySeller API |
| `proxyseller_auth_id` | VARCHAR(100) | Auth ID na ProxySeller |
| `ip` | VARCHAR(100) | Endereço IP do proxy |
| `port` | INTEGER | Porta |
| `protocol` | VARCHAR(20) | `HTTP` ou `SOCKS5` |
| `username` | VARCHAR(100) | Usuário de autenticação |
| `password` | VARCHAR(100) | Senha de autenticação |
| `is_assigned` | BOOLEAN | Proxy atribuído ao usuário? |
| `is_active` | BOOLEAN | Proxy ativo? |
| `is_blocked` | BOOLEAN | Proxy bloqueado/banido? |
| `blocked_reason` | VARCHAR(255) | Motivo do bloqueio |
| `blocked_at` | TIMESTAMP | Quando foi bloqueado |
| `assigned_at` | TIMESTAMP | Quando foi atribuído |
| `expires_at` | TIMESTAMP | Data de expiração |

### `coupons`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID do cupom |
| `code` | VARCHAR(50) UNIQUE | Código (sempre armazenado em maiúsculo) |
| `discount_percent` | DECIMAL(5,2) | Porcentagem de desconto (ou null) |
| `discount_amount` | DECIMAL(10,2) | Valor fixo em R$ de desconto (ou null) |
| `min_order_value` | DECIMAL(10,2) | Valor mínimo do pedido para uso |
| `max_uses` | INTEGER | Limite total de usos (null = ilimitado) |
| `max_uses_per_user` | INTEGER | Usos por usuário (padrão: 1) |
| `used_count` | INTEGER | Quantas vezes foi usado no total |
| `valid_from` | TIMESTAMP | Data de início da validade |
| `valid_until` | TIMESTAMP | Data de expiração |
| `scope` | VARCHAR(20) | `all` ou `first_only` (padrão: `all`) |
| `is_active` | BOOLEAN | Cupom ativo? |
| `proxy_types` | VARCHAR(255) | Tipos de proxy permitidos (null = todos) |
| `created_by` | INTEGER → users | Admin que criou |
| `created_at` | TIMESTAMP | Data de criação |

### `coupon_usage`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID |
| `coupon_id` | INTEGER → coupons | Cupom usado |
| `user_id` | INTEGER → users | Usuário que usou |
| `order_id` | INTEGER → proxy_orders | Pedido onde foi aplicado |
| `discount_applied` | DECIMAL(10,2) | Valor descontado em R$ |
| `used_at` | TIMESTAMP | Data do uso |

### `access_logs` (Marco Civil)
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL PK | ID |
| `user_id` | INTEGER → users | Usuário |
| `proxy_id` | INTEGER → proxyseller_proxies | Proxy usado |
| `client_ip` | VARCHAR(100) | IP real do cliente |
| `target_host` | VARCHAR(500) | Host de destino acessado |
| `target_port` | INTEGER | Porta de destino |
| `request_method` | VARCHAR(20) | GET, POST, CONNECT, etc. |
| `bytes_sent` | BIGINT | Bytes enviados |
| `bytes_received` | BIGINT | Bytes recebidos |
| `connected_at` | TIMESTAMP | Início da conexão |
| `disconnected_at` | TIMESTAMP | Fim da conexão |
| `session_id` | VARCHAR(100) | Identificador da sessão |
| `user_agent` | TEXT | User-agent do cliente |

### `attribution_logs` (Marco Civil)
Registra quem tinha qual IP de proxy em qual período. Retenção: 1 ano.

### `user_consents` / `terms_acceptance`
Registra aceites de termos com versão, IP e timestamp (LGPD).

### `reward_points` / `reward_transactions`
Sistema de pontos de fidelidade por compras.

### `subscriptions`, `proxies`, `proxy_replacements`
Sistema legado de proxies próprios (não ProxySeller).

### `tutorials`, `blog_posts`
Conteúdo gerenciado pelo admin (tutoriais e blog).

### `user_transactions`, `user_messages`
Histórico de transações e notificações internas do usuário.

---

## 5. Rotas da API

### Base URL: `https://fastproxy.com.br`

---

### Diagnóstico

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/health` | ❌ | Status simples do servidor |
| GET | `/api/status` | ❌ | Diagnóstico completo (DB, Stripe, rotas carregadas) |
| GET | `/debug/env` | ❌ | Variáveis de ambiente configuradas |

---

### `/api/auth/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/register` | ❌ | Cria conta de usuário |
| POST | `/api/auth/login` | ❌ | Login, retorna JWT |
| GET | `/api/auth/me` | ✅ JWT | Dados do usuário logado |

**Body login/register:**
```json
{ "email": "usuario@email.com", "password": "senha123", "name": "João Silva" }
```

**Resposta login:**
```json
{ "success": true, "token": "eyJ...", "user": { "id": 1, "email": "...", "role": "user" } }
```

---

### `/api/stripe/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/stripe/create-checkout` | ❌ | Checkout público (index.html — sem login) |
| GET | `/api/stripe/verify/:sessionId` | ❌ | Verifica status de pagamento |
| POST | `/api/stripe/webhook` | ❌ (Stripe signature) | Recebe eventos do Stripe |

**Body `create-checkout`:**
```json
{
  "email": "cliente@email.com",
  "whatsapp": "11999999999",
  "type": "ipv6",
  "period": "1m",
  "proxyCount": 10,
  "couponCode": "DESCONTO25"
}
```

**Tipos válidos:** `ipv6`, `ipv4`, `isp`
*(mobile temporariamente desabilitado — retorna erro 400)*

**Períodos válidos:** `1m`, `6m`, `12m`

**Resposta sucesso:**
```json
{
  "success": true,
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_...",
  "total": 299.00,
  "couponApplied": "DESCONTO25",
  "couponDiscount": 74.75
}
```

---

### `/api/checkout/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/checkout/create-checkout-session` | ✅ JWT | Checkout autenticado (planos.html) |
| GET | `/api/checkout/order/:orderId` | ✅ JWT | Detalhes de um pedido específico |
| POST | `/api/checkout/confirm-payment` | ✅ JWT | Confirma pagamento (fallback manual) |

**Body `create-checkout-session`:**
```json
{
  "type": "ipv6",
  "period": "1m",
  "quantity": 10,
  "couponCode": "DESCONTO25",
  "buyerName": "João Silva",
  "buyerDocument": "000.000.000-00",
  "buyerWhatsapp": "11999999999",
  "buyerAddress": "São Paulo - SP",
  "termsAccepted": true,
  "country": "br",
  "countryName": "Brasil"
}
```

---

### `/api/subscription/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/subscription/admin/login` | ❌ | Login do administrador |
| GET | `/api/subscription/admin/proxies` | ✅ Admin | Lista todos os proxies do sistema |
| GET | `/api/subscription/admin/users` | ✅ Admin | Lista todos os usuários |
| GET | `/api/subscription/admin/stats` | ✅ Admin | Estatísticas gerais |
| GET | `/api/subscription/admin/coupons` | ✅ Admin | Lista cupons |
| POST | `/api/subscription/admin/coupons/create` | ✅ Admin | Cria cupom |
| PUT | `/api/subscription/admin/coupons/:id` | ✅ Admin | Atualiza cupom |
| DELETE | `/api/subscription/admin/coupons/:id` | ✅ Admin | Remove cupom |
| GET | `/api/subscription/admin/coupons/usage` | ✅ Admin | Histórico de usos de cupons |
| GET | `/api/subscription/me` | ✅ JWT | Dados do plano atual do usuário |
| POST | `/api/subscription/cancel` | ✅ JWT | Cancela assinatura |
| POST | `/api/subscription/request-reset` | ❌ | Solicita redefinição de senha |
| POST | `/api/subscription/reset-password` | ❌ | Aplica nova senha (via token) |
| GET | `/api/subscription/tutorials` | ❌ | Lista tutoriais publicados |
| GET | `/api/subscription/blog` | ❌ | Lista posts do blog publicados |
| GET | `/api/subscription/admin/tutorials` | ✅ Admin | CRUD tutoriais |
| GET | `/api/subscription/admin/blog` | ✅ Admin | CRUD posts do blog |

**Body `admin/coupons/create`:**
```json
{
  "code": "PROMO30",
  "discount_percent": 30,
  "scope": "first_only",
  "valid_days": 30,
  "max_uses": 100,
  "max_uses_per_user": 1
}
```

---

### `/api/coupons/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/coupons/validate-public` | ❌ | Valida cupom antes do checkout (qualquer visitante) |
| POST | `/api/coupons/validate` | ✅ JWT | Valida cupom (usuário logado) |
| POST | `/api/coupons/apply` | ✅ JWT | Aplica cupom a um pedido existente |
| GET | `/api/coupons/admin/list` | ✅ Admin | Lista cupons |
| POST | `/api/coupons/admin/create` | ✅ Admin | Cria cupom |
| PUT | `/api/coupons/admin/:id` | ✅ Admin | Atualiza cupom |
| DELETE | `/api/coupons/admin/:id` | ✅ Admin | Remove cupom |
| GET | `/api/coupons/admin/usage` | ✅ Admin | Histórico completo de usos |

**Body `validate-public`:**
```json
{
  "code": "DESCONTO25",
  "orderValue": 299.00,
  "email": "cliente@email.com"
}
```
O campo `email` é opcional mas recomendado. Quando fornecido, o sistema verifica o escopo `first_only` consultando se o e-mail possui pedidos pagos.

**Resposta sucesso:**
```json
{
  "success": true,
  "coupon": {
    "code": "DESCONTO25",
    "scope": "first_only",
    "discount_percent": 25,
    "discount_amount": null,
    "discount": 74.75
  },
  "message": "25% de desconto aplicado (primeira compra)!"
}
```

---

### `/api/proxyseller/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/proxyseller/my-proxies` | ✅ JWT | Proxies ativos do usuário |
| GET | `/api/proxyseller/order/:orderId` | ✅ JWT | Proxies de um pedido específico |
| POST | `/api/proxyseller/renew/:orderId` | ✅ JWT | Renova um pedido expirado |
| GET | `/api/proxyseller/pricing` | ❌ | Tabela de preços pública |
| GET | `/api/proxyseller/admin/orders` | ✅ Admin | Todos os pedidos (painel admin) |

---

### `/api/rewards/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/rewards/my-points` | ✅ JWT | Saldo de pontos do usuário |
| GET | `/api/rewards/history` | ✅ JWT | Histórico de ganho/resgate |
| POST | `/api/rewards/redeem` | ✅ JWT | Resgata pontos como cupom de desconto |

---

### `/api/accesslogs/*`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/accesslogs` | ✅ Admin | Lista logs com filtros |
| GET | `/api/accesslogs/stats` | ✅ Admin | Estatísticas de acesso |
| GET | `/api/accesslogs/export` | ✅ Admin | Export CSV para compliance |

Parâmetros de filtro: `?userId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

---

## 6. Lógica de Negócio — Fluxos Principais

### Fluxo de Compra — Novo Cliente (index.html, sem login)

```
1. Cliente acessa fastproxy.com.br
2. Seleciona tipo: ipv6 / ipv4 / isp
3. Seleciona período: 1m / 6m / 12m
4. Define quantidade de proxies
5. Abre modal de checkout:
   a. Informa e-mail e WhatsApp
   b. Opcionalmente aplica cupom de desconto
      → Frontend chama POST /api/coupons/validate-public
      → Exibe desconto em tempo real
6. Clica "Continuar para Pagamento"
   → POST /api/stripe/create-checkout
   → Servidor valida cupom server-side (nunca confia no cliente)
   → Cria Stripe Checkout Session
7. Redirecionado para Stripe Checkout (Cartão de Crédito)
8. Após pagamento, Stripe dispara webhook:
   → POST /api/stripe/webhook (checkout.session.completed)
   → Cria usuário (senha temporária gerada e enviada por e-mail)
   → Cria proxy_order com payment_status = 'paid'
   → Chama ProxySeller API para criar e entregar proxies
   → Registra attribution_logs (Marco Civil)
   → Envia e-mail de boas-vindas com credenciais
9. Cliente acessa /login.html para entrar na conta criada
```

### Fluxo de Compra — Cliente Logado (planos.html)

```
1. Cliente logado acessa planos.html
2. Seleciona plano
3. Aceita Termos de Uso
4. Preenche dados (nome, CPF, WhatsApp, endereço)
5. Opcionalmente aplica cupom
6. POST /api/checkout/create-checkout-session
   → JWT autenticado
   → Valida cupom por user_id (escopo first_only verifica pedidos existentes)
   → Cria pedido 'pending' no banco
   → Cria Stripe Checkout Session
7. Pagamento → webhook → entrega automática de proxies
```

### Renovação Mensal (Recorrência Manual)

O sistema usa pagamentos únicos, não Stripe Subscriptions automáticas. A renovação é sempre um novo pedido:

```
1. Cliente acessa portal.html
2. Vê proxies próximos de expirar
3. Clica "Renovar" → abre modal de checkout
4. Cada renovação cria um NOVO proxy_order
5. Cupom first_only → usuário já tem pedido pago → desconto NEGADO
6. Cupom all → desconto aplicado normalmente em toda renovação
```

**Por isso cupons `first_only` funcionam corretamente como "promoção de primeira assinatura":** na segunda mensalidade, o cliente já tem `payment_status = 'paid'` em algum pedido anterior, e o sistema automaticamente rejeita o cupom.

### Cancelamento

```
1. Cliente acessa cancelar.html ou portal.html
2. POST /api/subscription/cancel (JWT)
3. → Cancela no Stripe (se houver subscription_id)
4. → Desativa proxies na ProxySeller (ao fim do período)
5. → Atualiza status do pedido no banco
6. → Envia e-mail de confirmação com data final de acesso
```

---

## 7. Sistema de Cupons

### Parâmetros Completos

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `code` | string | ✅ | Código do cupom (armazenado em maiúsculo) |
| `discount_percent` | number | ✅ ou amount | % de desconto (ex: 25 = 25% off) |
| `discount_amount` | number | ✅ ou percent | Desconto fixo em R$ |
| `scope` | string | ⬜ | `all` (padrão) ou `first_only` |
| `valid_days` | number | ⬜ | Validade em dias a partir de hoje |
| `max_uses` | number | ⬜ | Total de usos (null = ilimitado) |
| `max_uses_per_user` | number | ⬜ | Por usuário (padrão: 1) |
| `min_order_value` | number | ⬜ | Valor mínimo do pedido em R$ |

### Escopos

| Scope | Comportamento |
|-------|---------------|
| `all` | Válido para qualquer compra, qualquer cliente, quantas vezes o `max_uses_per_user` permitir |
| `first_only` | Válido apenas para a **primeira assinatura** do cliente. Verificação: sem pedidos com `payment_status = 'paid'` no banco. Ideal para captação (anúncios, indicações, promoções de lançamento). |

### Algoritmo de Validação (em ordem)

```
1. Código existe e is_active = true?
2. Ainda dentro de valid_until (não expirado)?
3. valid_from passou (já disponível)?
4. used_count < max_uses (não esgotado)?
5. orderValue >= min_order_value?
6. Se scope = 'first_only':
   → Sem login: busca por email em proxy_orders JOIN users
   → Com login: busca por user_id em proxy_orders
   → Se encontrar pedido pago → rejeitar
7. Se max_uses_per_user definido e user_id disponível:
   → Contar usos em coupon_usage para este user_id
   → Se atingiu o limite → rejeitar
8. Calcular discount:
   → Se discount_percent: discount = orderValue * (percent / 100)
   → Se discount_amount: discount = min(amount, orderValue)
```

### Segurança Anti-Fraude

O cliente **nunca envia o valor do desconto** — apenas o código. O servidor sempre recalcula o desconto com base no banco. Mesmo que o cliente manipule a requisição com um valor de desconto forjado, o servidor o ignora e calcula do zero.

---

## 8. Integração ProxySeller

**API Base:** `https://proxy-seller.com/personal/api/v1`
**Autenticação:** `?key={PROXYSELLER_API_KEY}` em todas as requisições

### Tipos de Proxy

| Tipo | Nome | Descrição | Qtd Mínima | countryId (Brasil) |
|------|------|-----------|------------|-------------------|
| `ipv6` | IPv6 | Datacenter IPv6 | 10 | 20554 |
| `ipv4` | IPv4 | Datacenter IPv4 | 1 | 1279 |
| `isp` | ISP | Provedor dedicado | 1 | 5236 |
| `mobile` | Mobile 4G/5G | Rede móvel *(Em Breve)* | 1 | — |

### Endpoints ProxySeller Utilizados

| Endpoint | Descrição |
|----------|-----------|
| `POST /order/make` | Cria pedido de proxies |
| `GET /order/info/{id}` | Verifica status do pedido |
| `GET /proxy/list?orderId={id}` | Lista proxies do pedido |
| `POST /order/prolong` | Renova (prorroga) um pedido |
| `GET /country/list` | Lista países disponíveis |

### Fluxo de Entrega Automática

```
1. POST /order/make → retorna proxyseller_order_id
2. Polling GET /order/info/{id} até status = 'active' (máx 30s)
3. GET /proxy/list?orderId={id} → array de proxies
4. Para cada proxy:
   → Salva em proxyseller_proxies
   → Registra em attribution_logs
5. Retorna array com formato:
   { ip, port, username, password, protocol, expires_at }
```

### Períodos

| Período FastProxy | Valor na API | Dias |
|-------------------|-------------|------|
| `1m` | `1m` | 30 |
| `6m` | `6m` | 180 |
| `12m` | `12m` | 365 |

### Taxa de Câmbio

Configurada em `lib/proxyseller.js`:
```js
const DOLLAR_RATE = 5.5; // USD → BRL
```

---

## 9. Integração Stripe

### Modo de Operação

O sistema usa **Stripe Checkout Sessions** com pagamentos únicos (não assinatura automática).

### Preços de Venda por Proxy/Mês

| Tipo | Preço |
|------|-------|
| IPv6 | R$ 29,90 |
| IPv4 | R$ 39,90 |
| ISP | R$ 49,90 |
| Mobile 4G/5G | R$ 79,90 *(Em Breve)* |

### Descontos por Período (automáticos, sem cupom)

| Período | Desconto | Exemplo IPv6 × 10 proxies |
|---------|---------|--------------------------|
| 1 mês | 0% | R$ 299,00 |
| 6 meses | 10% | R$ 1.615,20 |
| 12 meses | 20% | R$ 2.872,00 |

### Cálculo de Preço

```js
Stripe.calculatePrice(type, period, quantity, couponDiscount)
// → { unitAmount (centavos), total (centavos), ... }
```

### Webhook

**URL:** `https://fastproxy.com.br/api/stripe/webhook`
**Segredo:** variável `STRIPE_WEBHOOK_SECRET`

| Evento | Ação |
|--------|------|
| `checkout.session.completed` | Cria usuário, entrega proxies, envia e-mail |
| `payment_intent.payment_failed` | Marca pedido como `failed` |

### Configuração no Stripe Dashboard

1. Developers → Webhooks → Add endpoint
2. URL: `https://fastproxy.com.br/api/stripe/webhook`
3. Events: selecionar `checkout.session.completed` e `payment_intent.payment_failed`
4. Copiar o Signing Secret → variável `STRIPE_WEBHOOK_SECRET`

---

## 10. Sistema de E-mail (Resend)

**From:** `FastProxy <contato@fastproxy.com.br>`
**Domínio verificado:** `fastproxy.com.br`

| Função | Quando dispara | Conteúdo |
|--------|---------------|----------|
| `sendWelcomeEmail(email, name, proxies)` | Após primeiro pagamento (via webhook) | Boas-vindas + lista de credenciais dos proxies |
| `sendProxyCredentials(email, name, proxies, reason)` | Após renovação ou troca de proxy | Novas credenciais |
| `sendCancellationEmail(email, name, subscriptionDetails)` | Após cancelamento | Confirmação + data final de acesso |
| `sendPasswordResetEmail(email, name, resetToken)` | Ao solicitar reset de senha | Link com token (válido 1h) |
| `sendRenewalReminder(email, name, daysLeft, discountCode)` | (automação futura) | Aviso de expiração + cupom 50% OFF |

Todos os templates referenciam `APP_URL` para os links. Se `APP_URL` não estiver configurado, o fallback é `https://fastproxy.com.br`.

---

## 11. Autenticação e Segurança

### JWT

- **Segredo:** `process.env.JWT_SECRET`
- **Expiração:** `process.env.JWT_EXPIRE` (padrão: `7d`)
- **Header esperado:** `Authorization: Bearer <token>`
- **Payload:** `{ id, email, role, iat, exp }`

### Roles

| Role | Acesso |
|------|--------|
| `user` | Portal do cliente, proxies próprios, cancelar assinatura |
| `admin` | Tudo acima + painel admin, todos os usuários/proxies/cupons |

### Criar conta Admin

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@fastproxy.com.br';
```

Ou via painel admin: aba "Usuários" → editar → mudar role.

### Middleware de Autenticação

```js
// Qualquer usuário logado
authenticate(req, res, next)

// Apenas admins (verifica role = 'admin')
isAdmin(req, res, next)
```

Ambos exportados de `routes/subscription.js`.

### Proteções em Produção

| Proteção | Implementação |
|----------|--------------|
| Headers de segurança | `helmet` (CSP, HSTS, etc.) |
| CORS restritivo | Whitelist de origens em `server.js` |
| Rate limiting login | 5 tentativas / 15 minutos (in-memory) |
| Hash de senhas | `bcryptjs` (salt automático) |
| Assinatura webhook | Verificação HMAC via `STRIPE_WEBHOOK_SECRET` |
| Anti-fraude cupons | Desconto recalculado server-side, nunca confia no cliente |
| Validação de input | Verificações de tipo/range em todos os endpoints |

### CORS — Origens Permitidas

```js
[
  process.env.APP_URL,            // https://fastproxy.com.br
  'https://fastproxy.com.br',
  'https://www.fastproxy.com.br',
  'https://fastproxyoriginal.vercel.app',
  'https://fastproxyv3.vercel.app',
  'http://localhost:3000',
]
```

---

## 12. Conformidade Legal

### Marco Civil da Internet (Lei 12.965/2014)

O Marco Civil exige que provedores de internet mantenham logs de conexão por **6 meses** e logs de acesso a aplicações por **6 meses**, disponíveis para ordens judiciais.

| Tabela | Retenção | Conteúdo |
|--------|----------|----------|
| `access_logs` | 6 meses | IP do cliente, host acessado, timestamps, bytes |
| `attribution_logs` | 1 ano | Quem tinha qual IP de proxy em qual momento |

**Export para compliance:** `GET /api/accesslogs/export` (Admin) → CSV com todos os campos necessários.

### LGPD (Lei 13.709/2018)

- Coleta apenas dados necessários para o serviço
- Senhas em hash irreversível (bcrypt)
- `user_consents`: registra aceite de termos com versão, IP e timestamp
- `terms_acceptance`: aceite dos Termos de Serviço versionado

---

## 13. Páginas do Frontend

| Arquivo | URL | Descrição |
|---------|-----|-----------|
| `index.html` | `/` | Landing page — apresentação dos planos + checkout público (sem login) |
| `planos.html` | `/planos.html` | Página de planos detalhados para usuários autenticados |
| `portal.html` | `/portal.html` | Portal do cliente: proxies, faturas, suporte, configurações |
| `login.html` | `/login.html` | Login e registro de conta |
| `admin.html` | `/admin.html` | Painel administrativo completo |
| `cancelar.html` | `/cancelar.html` | Cancelamento de assinatura |
| `success.html` | `/success.html` | Página de sucesso após pagamento |
| `success-swap.html` | `/success-swap.html` | Sucesso após troca de proxy |

---

## 14. Planos Disponíveis

### IPv6 — R$ 29,90/proxy/mês
- **Mínimo:** 10 proxies
- **Ideal para:** scraping em escala, automações, bots
- **Entrega:** automática via ProxySeller API
- **Protocolo:** HTTP / SOCKS5
- **Localização:** Brasil

### IPv4 — R$ 39,90/proxy/mês
- **Mínimo:** 1 proxy
- **Ideal para:** plataformas que não aceitam IPv6, compatibilidade máxima
- **Entrega:** automática via ProxySeller API
- **Protocolo:** HTTP / SOCKS5
- **Localização:** Brasil

### ISP — R$ 49,90/proxy/mês
- **Mínimo:** 1 proxy
- **Ideal para:** plataformas sensíveis, alta confiabilidade
- **Entrega:** automática via ProxySeller API
- **Características:** IP de provedor de internet real (datacenter + residencial)
- **Localização:** Brasil

### Mobile 4G/5G — R$ 79,90/proxy/mês *(Em Breve)*
- **Status:** Desabilitado no frontend e backend
- **Frontend:** Card exibido com badge "EM BREVE", opacidade reduzida, sem possibilidade de clicar para comprar
- **Backend:** `routes/checkout.js` e `routes/stripe.js` retornam erro 400 para `type: 'mobile'`
- **Reativar:** Remover os guards em ambas as rotas + reverter o card em `index.html`

---

## 15. Sistema de Recompensas

Clientes acumulam pontos a cada compra e podem resgatá-los como cupons de desconto.

### Tabelas

- `reward_points`: saldo atual por usuário (total, disponível, lifetime)
- `reward_transactions`: histórico de earn/redeem com referência ao pedido

### Fluxo

```
Compra realizada
→ POST /api/rewards/earn (interno, chamado após pagamento confirmado)
→ Crédita pontos proporcionais ao valor pago
→ Usuário vê pontos no portal.html

Resgate
→ POST /api/rewards/redeem { points: 100 }
→ Gera cupom automático (ex: REWARD_ABC123)
→ Debita pontos
→ Cupom disponível para uso imediato
```

---

## 16. Painel Administrativo

**URL:** `https://fastproxy.com.br/admin.html`

### Login

```
Email: [e-mail de conta com role = 'admin']
Senha: [senha da conta]
```

### Abas

| Aba | Rota utilizada | Funcionalidade |
|-----|---------------|----------------|
| **Adicionar** | `/api/subscription/admin/*` | Criar usuário manualmente + atribuir proxies |
| **Estoque** | `/api/subscription/admin/proxies` | Ver todos os proxies do sistema, status, expiração |
| **Usuários** | `/api/subscription/admin/users` | Lista de clientes, filtros, ver pedidos, editar |
| **Cupons** | `/api/subscription/admin/coupons/*` | Criar/ativar/desativar cupons com escopo e validade |
| **Logs** | `/api/accesslogs/*` | Logs de acesso (Marco Civil), busca por usuário e data, export CSV |
| **Tutoriais** | `/api/subscription/admin/tutorials` | CRUD de tutoriais para o portal do cliente |
| **Blog** | `/api/subscription/admin/blog` | CRUD de posts do blog |

### Criar Cupom via Admin

1. Acessar aba **Cupons**
2. Preencher:
   - **Código:** ex. `PROMO30` (automático maiúsculo)
   - **Abrangência:** Todas as compras / Primeira compra
   - **Desconto:** % ou R$ fixo
   - **Validade:** dias de validade (opcional)
   - **Máximo de usos:** (opcional, vazio = ilimitado)

---

## 17. Deploy e Infraestrutura

### Vercel — `vercel.json`

```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" },
    { "src": "public/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "server.js" },
    { "src": "/test", "dest": "server.js" },
    { "src": "/debug/(.*)", "dest": "server.js" },
    { "src": "/(.*)", "dest": "public/$1" }
  ],
  "env": { "NODE_ENV": "production" }
}
```

- Arquivos `public/**` → CDN da Vercel (acesso instantâneo)
- Qualquer rota `/api/*` → serverless function (`server.js`)

### Processo de Deploy

```bash
# Commit e push — deploy automático no Vercel
git add -A
git commit -m "feat: descrição das mudanças"
git push origin main

# Verificar após ~1 minuto:
curl https://fastproxy.com.br/api/status
```

### Repositório

`https://github.com/erick-torresadm/fastproxyoriginal` — branch `main`

### Domínios

| Domínio | Tipo |
|---------|------|
| `https://fastproxy.com.br` | Principal (produção) |
| `https://www.fastproxy.com.br` | Alias |
| `https://fastproxyoriginal.vercel.app` | Vercel URL (mantido como alias) |

---

## 18. Diagnóstico e Troubleshooting

### Endpoints de Diagnóstico

```bash
# Status geral
curl https://fastproxy.com.br/api/status

# Saúde
curl https://fastproxy.com.br/api/health

# Variáveis de ambiente (nunca expor em produção para o público)
curl https://fastproxy.com.br/debug/env
```

### Problemas Comuns

#### 404 em `/api/subscription/admin/login`

1. Acesse `https://fastproxy.com.br/api/status`
2. Verifique `loadedRoutes.subscription`
3. Se `false`: abra os logs no Vercel → Functions → `server.js` → View Logs
4. Causa comum: `DATABASE_URL` não configurado → `neon(undefined)` causa erro silencioso
5. Solução: configure a variável + faça redeploy

#### CORS Bloqueado

- Servidor loga `"CORS blocked origin: X | Allowed: [...]"` nos logs da função
- Adicionar o domínio ao array `allowed` em `server.js` → linha ~36

#### Webhook Stripe não disparando

1. Verificar se `STRIPE_WEBHOOK_SECRET` está configurado (`/api/status`)
2. Confirmar URL no Stripe Dashboard: `https://fastproxy.com.br/api/stripe/webhook`
3. Evento necessário: `checkout.session.completed`
4. Checar logs da função para erros de assinatura

#### Cupom `first_only` rejeitando cliente novo

Verificar se existe algum registro com `payment_status = 'paid'` para o e-mail/user_id:
```sql
SELECT * FROM proxy_orders
WHERE user_id = X AND payment_status = 'paid';
```

#### ProxySeller não entregando proxies

1. Verificar `PROXYSELLER_API_KEY` no `/api/status`
2. Verificar saldo disponível na conta ProxySeller
3. Checar logs da função para erros 401/403 da API
4. Verificar se o `country_id` está correto para o tipo de proxy

### Logs em Produção

```
Vercel Dashboard → [projeto] → Functions → server.js → View Logs
```

Os logs incluem:
- `=== LOADING SERVER ===` — startup com status de cada variável
- `✅ Subscription routes registered` — confirmação de routes carregadas
- `❌ Error loading X routes: [stack]` — erro de loading com stack completo
- `CORS blocked origin: X` — tentativa de acesso de origem não permitida
- `[404] METHOD /path - route not found` — rota não encontrada

---

## Apêndice — Estrutura de Arquivos

```
fastproxyv3/
├── server.js               # Entry point — Express + registro de todas as rotas
├── vercel.json             # Configuração de build e rotas do Vercel
├── package.json            # Dependências
├── DOCUMENTACAO.md         # Este arquivo
│
├── lib/
│   ├── database.js         # NeonDB connection + auto-migrations de tabelas
│   ├── email.js            # Resend SDK — funções e templates de e-mail
│   ├── stripe.js           # Stripe SDK + calculatePrice + createCheckoutSession
│   ├── proxyseller.js      # ProxySeller API client — pedidos, proxies, renovação
│   └── notifier.js         # Notificações Telegram (opcional)
│
├── routes/
│   ├── auth.js             # /api/auth — login, registro, me
│   ├── subscription.js     # /api/subscription — portal do cliente + admin completo
│   ├── stripe.js           # /api/stripe — checkout público (sem login)
│   ├── checkout.js         # /api/checkout — checkout autenticado (planos.html)
│   ├── coupons.js          # /api/coupons — validate-public, validate, CRUD admin
│   ├── proxyseller.js      # /api/proxyseller — proxies do usuário
│   ├── rewards.js          # /api/rewards — sistema de pontos de fidelidade
│   ├── accesslogs.js       # /api/accesslogs — Marco Civil compliance
│   ├── coupons.js          # /api/coupons
│   └── test-prices.js      # /api/test-prices — debug de preços
│
└── public/
    ├── index.html          # Landing page + checkout público
    ├── planos.html         # Planos detalhados (autenticado)
    ├── portal.html         # Portal do cliente
    ├── admin.html          # Painel administrativo
    ├── login.html          # Login / Registro
    ├── cancelar.html       # Cancelamento de assinatura
    ├── success.html        # Página de sucesso pós-pagamento
    └── success-swap.html   # Sucesso após troca de proxy
```
