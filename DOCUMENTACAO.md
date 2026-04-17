# FastProxy — Documentação Completa (2026-04-17)

---

## 📋 Visão Geral

**FastProxy** é um SaaS de venda e gerenciamento de proxies HTTP com:
- Pagamentos via Stripe
- Portal do cliente com dashboard
- Alocação automática de proxies via ProxySeller API
- Sistema de cupons, pontos de fidelidade e histórico de transações
- Painel administrativo

**URLs:**
| Deploy | URL |
|---|---|
| Produção (fastproxyv3) | https://fastproxyv3.vercel.app |
| Produção (fastproxyoriginal) | https://fastproxyoriginal.vercel.app |
| Portal do cliente | `/portal.html` |
| Painel admin | `/admin.html` |

---

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Database | Neon PostgreSQL (serverless) via `@neondatabase/serverless` |
| Pagamentos | Stripe (Checkout + Webhooks) |
| Proxies | ProxySeller API (`proxy-seller.com/personal/api/`) |
| Email | Resend (opcional) |
| Notifications | Telegram Bot (opcional) |
| Frontend | HTML/CSS/JS + Tailwind CSS (CDN) |
| Hosting | Vercel (serverless functions) |
| Auth | JWT (7 dias), bcrypt (10 rounds) |

---

## 🚀 Comandos

```bash
# Instalar dependências
npm install

# Rodar localmente
node server.js            # ou: npm start / npm run dev

# Deploy para produção
vercel --prod

# Configurar variáveis de ambiente
vercel env add NOME_VARIAVEL production

# Health check (após deploy)
curl https://fastproxyoriginal.vercel.app/test
```

Não há testes automatizados. Scripts de teste são utilitários manuais (`test-*.js`).

---

## 🗄️ Banco de Dados

Conexão via `lib/database.js` usando `@neondatabase/serverless`. Tabelas criadas automaticamente (`CREATE TABLE IF NOT EXISTS`) ao iniciar o servidor. Não há sistema de migrations tradicional — novas colunas são adicionadas com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### Tabelas e propósito

| Tabela | Propósito |
|---|---|
| `users` | Usuários (email, senha, role, whatsapp) |
| `subscriptions` | Assinaturas ativas (período, qtd proxies, status) |
| `proxies` | Proxies ativos dos clientes (ip, porta, credenciais) |
| `proxy_replacements` | Histórico de trocas de proxy |
| `proxy_orders` | Pedidos ProxySeller (order_id, status, custo) |
| `proxyseller_proxies` | Proxies individuais do ProxySeller |
| `coupons` | Cupons de desconto |
| `coupon_usage` | Histórico de uso de cupons |
| `discounts` | Descontos gerados automaticamente (expiração) |
| `reward_points` | Pontos de fidelidade por usuário |
| `reward_transactions` | Histórico de pontos |
| `user_transactions` | Histórico completo de compras |
| `user_messages` | Notificações/push para usuários |
| `access_logs` | Logs de acesso (Marco Civil — 6 meses) |
| `attribution_logs` | Logs de atribuição de IP (Marco Civil) |
| `user_consents` | Consentimentos LGPD |
| `terms_acceptance` | Aceite dos termos de uso |
| `tutorials` | Conteúdo de tutoriais |
| `blog_posts` | Posts do blog |

---

## 🔌 APIs

### Base URL: `/api/subscription/`

| Endpoint | Método | Auth | Descrição |
|---|---|---|---|
| `/login` | POST | ❌ | Login (email + senha) |
| `/register` | POST | ❌ | Cadastro simples |
| `/me` | GET | ✅ | Dados do usuário + proxies + assinaturas |
| `/replace-proxy` | POST | ✅ | Trocar proxy (preço: R$1,99-11,99) |
| `/add-proxies` | POST | ✅ | Adicionar mais proxies |
| `/my-discounts` | GET | ✅ | Cupons disponíveis do usuário |
| `/check-expiration` | GET | ✅ | Verificar expiração da assinatura |
| `/history` | GET | ✅ | Histórico de transações |
| `/check-email/:email` | GET | ❌ | Verificar se email existe |
| `/forgot-password` | POST | ❌ | Solicitar redefinição de senha |
| `/reset-password` | POST | ❌ | Redefinir senha com token |
| `/fetch-proxies` | POST | ✅ | Poll ProxySeller API (provisionamento) |
| `/test-telegram` | GET | ❌ | Testar notificações Telegram |
| `/debug/orders` | GET | ✅ | Debug: verificar proxy_orders do usuário |

### Admin:

| Endpoint | Método | Auth | Descrição |
|---|---|---|---|
| `/admin/login` | POST | ❌ | Login admin |
| `/admin/proxies` | GET/POST/DELETE/PUT | ✅ Admin | CRUD proxies |
| `/admin/users` | GET | ✅ Admin | Listar usuários |
| `/admin/setup` | POST | ✅/❌ | Criar primeiro admin |

### Stripe: `/api/stripe/`

| Endpoint | Método | Descrição |
|---|---|---|
| `/create-checkout` | POST | Criar sessão Checkout |
| `/verify/:sessionId` | GET | Verificar pagamento |
| `/process-payment/:sessionId` | POST | Processar pagamento (cria user, subscription, proxies) |
| `/create-swap-checkout` | POST | Checkout para troca de proxy |
| `/webhook` | POST | Webhook Stripe |

### Cupons: `/api/coupons/`

| Endpoint | Método | Auth | Descrição |
|---|---|---|---|
| `/validate` | POST | ✅ | Validar cupom + calcular desconto |
| `/apply` | POST | ✅ | Aplicar cupom ao pedido |
| `/admin/list` | GET | ✅ Admin | Listar cupons |
| `/admin/create` | POST | ✅ Admin | Criar cupom |
| `/admin/quick-create` | POST | ✅ Admin | Criar cupom rápido (auto-generate code) |
| `/admin/usage` | GET | ✅ Admin | Histórico de uso |

### Extras:
- `/api/rewards/balance` — Saldo de pontos
- `/api/accesslogs/` — Logs de acesso
- `/api/test/` — Endpoints de debug
- `/test` — Health check público
- `/debug/env` — Verificar variáveis de ambiente

---

## 💰 Preços e Tipos de Proxy

| Tipo | Preço/mês | Entrega | Mín. Qtd |
|---|---|---|---|
| **IPv6** | R$ 29,90 | Estoque | 1 |
| **IPv4** | R$ 39,90 | ⏱️ API (5-10 min) | 1 |
| **ISP** | R$ 49,90 | ⏱️ API (5-10 min) | 1 |
| **Mobile 4G/5G** | **Em breve** | — | — |

### Descontos por período:
| Período | Desconto |
|---|---|
| 1 mês | 0% |
| 6 meses | 25% |
| 12 meses | 35% |

### Troca de proxy (preço progressivo):
| Dias de uso | Preço |
|---|---|
| 1-3 dias | R$ 1,99 |
| 4-7 dias | R$ 5,99 |
| 8+ dias | R$ 11,99 |

Também é possível trocar usando **100 pontos de fidelidade** (grátis).

---

## 🔑 Fluxo de Pagamento

### Fluxo completo:

1. Usuário escolhe tipo, período, quantidade na landing page
2. Stripe checkout → pagamento
3. `/api/stripe/process-payment`:
   a. Verifica pagamento no Stripe
   b. Cria/find user pelo email
   c. Cria subscription
   d. **IPv6**: aloca do estoque (tabela `proxies`)
   e. **IPv4/ISP**: cria ordem via ProxySeller API → cria auth → salva em `proxy_orders`
   f. Gera JWT e retorna dados
   g. Envia email de boas-vindas (Resend)
   h. Notifica via Telegram

### Regra: Proxy = Acesso
```
SE user.tem_proxies_ativos → ACESSO LIBERADO (independente do status da assinatura)
SE NÃO → MOSTRAR "ASSINAR UM PLANO"
```

---

## 🌐 ProxySeller API

**URL:** `https://proxy-seller.com/personal/api/v1/{API_KEY}/`

### Chave atual: `a38df52a4a9d3d93b8305720080b00ab`

### Endpoints usados:
| Endpoint | Método | Uso |
|---|---|---|
| `reference/list/{type}` | GET | Buscar países, períodos, targets |
| `order/calc` | POST | Calcular preço (requer `customTargetName`) |
| `order/make` | POST | Fazer pedido |
| `proxy/list/{type}` | GET | Listar proxies (por orderId) |
| `auth/add` | POST | Criar credenciais de acesso |
| `auth/list` | GET | Listar credenciais |
| `auth/change` | POST | Ativar/desativar credencial |

### ⚠️ Erros comuns:
- `Set [customTargetName]` — faltou o parâmetro obrigatório `customTargetName`
- `Set existed [periodId]` — usar string `"1m"`, não número `30`

### Provisionamento:
- API leva **5-10 minutos** para provisionar proxies
- Portal faz **auto-polling** a cada 60s via `/api/subscription/fetch-proxies`
- Proxies pendentes mostram "⏳ Provisionando" no painel

### ❌ Sem API de refund:
- ProxySeller **não oferece** endpoint de reembolso
- Reembolsos devem ser feitos manualmente pelo suporte

---

## 🔔 Notificações (Telegram)

### Configuração:
1. Criar bot via @BotFather → copiar token
2. Configurar no Vercel:
```bash
vercel env add TELEGRAM_BOT_TOKEN production
vercel env add TELEGRAM_CHAT_ID production
```

### Quando envia notificação:
- ✅ Nova compra: email, tipo, qtd, valor, hora
- ❌ Cancelamento: email, plano, motivo

### Testar:
```
https://fastproxyoriginal.vercel.app/api/subscription/test-telegram
```

---

## 🔐 Variáveis de Ambiente

| Variável | Obrigatório | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Neon PostgreSQL |
| `APP_URL` | ✅ | URL do site (ex: https://fastproxyoriginal.vercel.app) |
| `STRIPE_SECRET_KEY` | ✅ | Chave secreta Stripe |
| `JWT_SECRET` | ✅ | Secret para JWT |
| `JWT_EXPIRE` | ❌ | Expiração JWT (default: 7d) |
| `STRIPE_PUBLISHABLE_KEY` | ❌ | Chave pública Stripe |
| `STRIPE_TEST_MODE` | ❌ | `true` = teste |
| `STRIPE_WEBHOOK_SECRET` | ❌ | Webhook prod |
| `STRIPE_WEBHOOK_SECRET_TEST` | ❌ | Webhook teste |
| `RESEND_API_KEY` | ❌ | Emails (Resend) |
| `PROXYSELLER_API_KEY` | ❌* | API ProxySeller |
| `PROXY_IP` | ❌ | IP base estoque IPv6 |
| `PROXY_PORT_START`/`END` | ❌ | Range de portas |
| `TELEGRAM_BOT_TOKEN` | ❌ | Notificações |
| `TELEGRAM_CHAT_ID` | ❌ | Chat ID Telegram |

---

## 📦 Estrutura de Arquivos

```
├── server.js                 # Entry point — registra rotas + static files
├── vercel.json               # Config Vercel
├── package.json              # Dependências
├── lib/
│   ├── database.js           # Conexão Neon + init tables
│   ├── email.js              # Resend — welcome, reset, cancel, swap
│   ├── proxyseller.js        # Wrapper API ProxySeller
│   ├── stripe.js             # Stripe client + pricing + checkout
│   └── notifier.js           # Telegram notifications
├── routes/
│   ├── subscription.js       # Auth, login, register, proxy CRUD, admin
│   ├── stripe.js             # Checkout, process-payment, swap
│   ├── checkout.js           # Alternative checkout + webhook
│   ├── coupons.js            # Cupons (validate, apply, admin)
│   ├── rewards.js            # Pontos de fidelidade
│   ├── accesslogs.js         # Logs de uso de proxy
│   ├── test.js               # Debug endpoints
│   └── test-prices.js        # Teste de preços
├── middleware/
│   └── auth.js               # JWT middleware (legacy)
├── models/                   # Mongoose models (NÃO usados — DB é Postgres)
└── public/
    ├── index.html            # Landing page com checkout
    ├── portal.html           # Dashboard do cliente
    ├── admin.html            # Painel admin
    ├── success.html          # Pós-pagamento
    ├── cancel.html           # Pagamento cancelado
    ├── planos.html           # Página de planos
    └── blog.html / tutoriais.html / etc
```

---

## 🔧 Manutenção

### Criar cupom rápido:
Admin → POST `/api/coupons/admin/quick-create`:
```json
{
  "discount_amount": 24.90,
  "proxy_type": "ipv6",
  "max_uses": 10,
  "valid_days": 30
}
```
→ Gera código automático tipo `FASTIPV6R5ABC123`

### Criar cupom manualmente:
Rodar script `migrate-coupon.js` ou direto no DB.

### Verificar status de proxy orders:
GET `/api/subscription/debug/orders` (autenticado)

### Forçar fetch de proxies ProxySeller:
POST `/api/subscription/fetch-proxies` (autenticado)

### Ver credenciais de teste
- **Admin:** ericktorresadm@hotmail.com / @Fastproxy10
- **Usuário verificado no momento** → ver DB para credenciais atuais

### Deploy:
```bash
git add <arquivos>
git commit -m "descrição"
git push  # Vercel auto-deploy
```

---

*Documento atualizado em: 2026-04-17*
