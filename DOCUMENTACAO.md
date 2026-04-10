# FastProxy - Documentação Técnica Completa

> Última atualização: 10/04/2026

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Stack Tecnológica](#stack-tecnológica)
3. [Estrutura de Pastas](#estrutura-de-pastas)
4. [Banco de Dados](#banco-de-dados)
5. [APIs](#apis)
6. [Frontend](#frontend)
7. [Deploy](#deploy)
8. [Variáveis de Ambiente](#variáveis-de-ambiente)
9. [Segurança](#segurança)
10. [Manutenção](#manutenção)

---

## 🏠 Visão Geral

**FastProxy** é um sistema de venda e gerenciamento de proxies HTTP IPv6 com:
- Pagamentos via Stripe
- Cadastro/login de clientes
- Gerenciamento de assinaturas
- Alocação automática de proxies
- Troca de proxies por preço escalonado
- Sistema de cupons de desconto

### URLs dos Sites

| Ambiente | URL |
|----------|-----|
| **Produção** (fastproxyv3) | https://fastproxyv3.vercel.app |
| **Produção** (fastproxyoriginal) | https://fastproxyoriginal.vercel.app |

---

## 💻 Stack Tecnológica

### Frontend
- **HTML5/CSS3/JavaScript**
- **Tailwind CSS** (via CDN)
- **Google Fonts** (Inter)

### Backend
- **Node.js** + **Express.js**
- **Vercel** (Serverless Functions)

### Banco de Dados
- **Neon Postgres** (Serverless PostgreSQL)
  - Conexão via `DATABASE_URL`
  - Sem limites de conexões (serverless)

### Pagamentos
- **Stripe** (Checkout e Webhooks)

---

## 📁 Estrutura de Pastas

```
fastproxyv3/
├── public/                    # Arquivos estáticos
│   ├── index.html            # Página principal (landing)
│   ├── portal.html           # Painel do cliente
│   ├── admin.html            # Painel admin
│   ├── success.html          # Página pós-pagamento
│   ├── cancel.html           # Página pagamento cancelado
│   └── img/                  # Imagens (logos)
│
├── routes/                    # Rotas da API
│   ├── auth.js               # Autenticação (legacy)
│   ├── stripe.js             # Pagamentos Stripe
│   ├── subscription.js        # Sistema de assinaturas (PRINCIPAL)
│   └── test.js               # APIs de teste
│
├── lib/                       # Bibliotecas
│   ├── database.js           # Conexão com Neon Postgres
│   └── stripe.js             # Configuração Stripe
│
├── server.js                  # Arquivo principal do servidor
├── vercel.json                # Configuração Vercel
├── package.json               # Dependências Node.js
├── .env                       # Variáveis locais (NÃO COMMITAR)
└── DOCUMENTACAO.md            # Este arquivo
```

---

## 🗄️ Banco de Dados

### Como Trocar o Banco de Dados

O banco está configurado no arquivo `lib/database.js`:

```javascript
const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);
```

**Para trocar o banco:**

1. **Neon Postgres** → pegar nova `DATABASE_URL` no dashboard
2. **Supabase** → usar `postgresql://...` deles
3. **Outro Postgres** → ajustar connection string

**Atualizar no Vercel:**
```bash
vercel env add DATABASE_URL production
# Cole a nova connection string
```

### Tabelas do Banco

#### 1. `users` - Usuários
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | SERIAL | ID único |
| email | VARCHAR(255) | Email único |
| password | VARCHAR(255) | Senha hasheada (bcrypt) |
| name | VARCHAR(255) | Nome |
| whatsapp | VARCHAR(50) | Telefone |
| role | VARCHAR(20) | 'user' ou 'admin' |
| created_at | TIMESTAMP | Data criação |
| updated_at | TIMESTAMP | Data atualização |

#### 2. `subscriptions` - Assinaturas
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | SERIAL | ID único |
| user_id | INTEGER | FK para users |
| stripe_session_id | VARCHAR(255) | ID sessão Stripe |
| stripe_customer_id | VARCHAR(255) | ID cliente Stripe |
| period | VARCHAR(20) | 'monthly' ou 'annual' |
| proxy_count | INTEGER | Quantidade de proxies |
| price_paid | DECIMAL(10,2) | Preço pago |
| status | VARCHAR(20) | 'active', 'expired', 'cancelled' |
| start_date | TIMESTAMP | Início assinatura |
| end_date | TIMESTAMP | Vencimento |
| auto_renew | BOOLEAN | Renovação automática |
| created_at | TIMESTAMP | Data criação |

#### 3. `proxies` - Proxies Alocados
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | SERIAL | ID único |
| user_id | INTEGER | FK para users |
| subscription_id | INTEGER | FK para subscriptions |
| ip | VARCHAR(45) | IP do proxy (ex: 177.54.146.90) |
| port | INTEGER | Porta (ex: 11331) |
| username | VARCHAR(50) | Usuário (ex: fp12345) |
| password | VARCHAR(100) | Senha do proxy |
| is_active | BOOLEAN | Se está ativo |
| created_at | TIMESTAMP | Data criação |
| updated_at | TIMESTAMP | Última atualização |

#### 4. `proxy_replacements` - Histórico de Trocas
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | SERIAL | ID único |
| proxy_id | INTEGER | FK para proxies |
| old_ip | VARCHAR(45) | IP antigo |
| old_port | INTEGER | Porta antiga |
| new_ip | VARCHAR(45) | IP novo |
| new_port | INTEGER | Porta nova |
| price_charged | DECIMAL(10,2) | Preço cobrado |
| reason | VARCHAR(255) | Motivo da troca |
| created_at | TIMESTAMP | Data da troca |

#### 5. `discounts` - Cupons de Desconto
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | SERIAL | ID único |
| user_id | INTEGER | FK para users |
| type | VARCHAR(50) | Tipo ('renewal_50', etc) |
| discount_percent | DECIMAL(5,2) | Percentual (ex: 50.00) |
| valid_until | TIMESTAMP | Validade |
| used | BOOLEAN | Se foi usado |
| created_at | TIMESTAMP | Data criação |

---

## 🔌 APIs

### Endpoints Principais (`/api/subscription/`)

#### 1. Verificar se email existe
```
GET /api/subscription/check-email/:email
```
**Resposta:**
```json
{ "exists": true, "email": "teste@email.com" }
```

#### 2. Registrar após pagamento
```
POST /api/subscription/register-after-payment
```
**Body:**
```json
{
  "email": "cliente@email.com",
  "password": "senha123",
  "name": "João",
  "whatsapp": "11999999999",
  "proxyCount": 3,
  "period": "monthly",
  "stripeSessionId": "cs_xxx"
}
```
**Resposta:**
```json
{
  "success": true,
  "isNewUser": true,
  "token": "jwt_token",
  "user": { "id": 1, "email": "...", "name": "..." },
  "subscription": { "id": 1, "period": "monthly", "proxyCount": 3, ... },
  "proxies": [
    { "id": 1, "ip": "177.54.146.90", "port": 11331, "username": "fp12345", "password": "abc123", "line": "fp12345:abc123@177.54.146.90:11331" }
  ]
}
```

#### 3. Login
```
POST /api/subscription/login
```
**Body:**
```json
{ "email": "cliente@email.com", "password": "senha123" }
```

#### 4. Dados do usuário (autenticado)
```
GET /api/subscription/me
```
**Headers:** `Authorization: Bearer <token>`

#### 5. Preço da troca de proxy
```
GET /api/subscription/replacement-price/:subscriptionId
```
**Resposta:**
```json
{ "success": true, "daysSinceStart": 5, "price": 5.99, "message": "Troca disponível por R$ 5,99" }
```

**Lógica de Preços:**
- 0-3 dias: R$ 1,99
- 4-7 dias: R$ 5,99
- 8+ dias: R$ 11,99

#### 6. Trocar proxy
```
POST /api/subscription/replace-proxy
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{ "proxyId": 1, "reason": "nao funciona" }
```

#### 7. Adicionar proxies
```
POST /api/subscription/add-proxies
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{ "additionalCount": 2 }
```

#### 8. Verificar expiração
```
GET /api/subscription/check-expiration
```

---

### Endpoints Stripe (`/api/stripe/`)

#### 1. Criar checkout
```
POST /api/stripe/create-checkout
```
**Body:**
```json
{
  "proxyCount": 3,
  "email": "cliente@email.com",
  "whatsapp": "11999999999",
  "period": "monthly"
}
```

#### 2. Verificar pagamento
```
GET /api/stripe/verify/:sessionId
```

#### 3. Webhook (Stripe notifica pagamento)
```
POST /api/stripe/webhook
```

---

## 🎨 Frontend

### Arquivos Principais

#### index.html - Landing Page
- Design dark/light mode
- Seção hero com CTA
- Planos de preços
- Modal de checkout Stripe

#### portal.html - Painel do Cliente
- Login/Cadastro
- Lista de proxies
- Trocar proxy
- Adicionar proxies
- Informações da assinatura

#### admin.html - Painel Admin (TODO: implementar)
- Lista de usuários
- Gerenciar assinaturas
- Ver proxies alocados
- Histórico de trocas

#### success.html - Pós-Pagamento
- Verifica pagamento no Stripe
- Mostra login se email existe
- Mostra cadastro se email não existe
- Exibe proxies após autenticação

### Variáveis JavaScript Locais

```javascript
// Armazenadas no localStorage do navegador
localStorage.getItem('fastproxy_token')      // JWT token
localStorage.getItem('fastproxy_user')       // Dados do usuário
localStorage.getItem('fastproxy_subscription') // Assinatura
localStorage.getItem('fastproxy_proxies')    // Lista de proxies
```

---

## 🚀 Deploy

### Vercel (Produção)

```bash
# 1. Fazer login
vercel login

# 2. Deploy para produção
vercel --prod

# 3. Listar projetos
vercel list

# 4. Ver variáveis de ambiente
vercel env ls

# 5. Adicionar variável
vercel env add NOME_DA_VAR production
```

### Variáveis de Ambiente Necessárias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | Connection string Neon Postgres | `postgresql://...` |
| `STRIPE_SECRET_KEY` | Chave secreta Stripe | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | Chave pública Stripe | `pk_live_...` |
| `JWT_SECRET` | Secret para JWT (opcional) | `minha_secret_key` |

### Trocando de Banco

1. Acesse Neon Dashboard: https://neon.tech
2. Crie novo projeto ou use existente
3. Copie a `DATABASE_URL`
4. No terminal:
   ```bash
   vercel env add DATABASE_URL production
   ```
5. Cole a nova URL
6. Deploy novamente:
   ```bash
   vercel --prod
   ```

---

## 🔐 Segurança

### Implementado

1. **Senhas hasheadas** - bcrypt com salt de 10 rounds
2. **JWT Tokens** - expiração de 7 dias
3. **Validação de inputs** - verificação de email, senha mínima
4. **CORS** - configurado para produção
5. **SQL Injection** - queries parametrizadas (Neon)

### Vulnerabilidades Testadas

| Teste | Status | Observação |
|-------|--------|-----------|
| SQL Injection | ✅ Protegido | Queries com template literals |
| XSS | ✅ Protegido | HTML escaping nos outputs |
| Brute Force | ⚠️ Implementar | Rate limiting recomendado |
| CSRF | ✅ Protegido | Tokens JWT |
| Password Strength | ✅ Implementado | Mínimo 6 caracteres |

### Recomendações Futuras

1. **Rate Limiting** - limitar requests por IP
2. **2FA** - autenticação em dois fatores
3. **Email verification** - confirmar email
4. **Password reset** - recuperação de senha
5. **Logging** - registrar tentativas de login

---

## 🔧 Manutenção

### Logs do Servidor

```javascript
// Vercel não mostra logs em tempo real
// Ver logs no dashboard: Vercel Dashboard > Deployments > Logs
```

### Resetar Banco Localmente

```bash
# Limpar tabelas via psql ou API
POST /api/test/test-cleanup
```

### Reiniciar Deploy

```bash
vercel --prod
```

### Verificar Status

```
https://fastproxyv3.vercel.app/test
```

Resposta esperada:
```json
{
  "message": "FastProxy API running",
  "stripeMode": "TEST", // ou PRODUCTION
  "database": "Neon Postgres ✅"
}
```

### Criar Admin Inicial

Se não tiver acesso ao admin, use a API:

```bash
curl -X POST https://fastproxyv3.vercel.app/api/subscription/admin/create \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@seusite.com","password":"sua_senha","name":"Admin"}'
```

---

## 📊 Limites e Custos

### Neon Postgres (Free Tier)
- **Projetos:** 1 gratuito
- **Branches:** 1 gratuito
- **Armazenamento:** 3 GB
- **Usuários simultâneos:** 1
- **Request Units:** 100/hora (para Neon Serverless)

### Vercel (Hobby)
- **Banda de rede:** 100GB/mês
- **Funções serverless:** 100 horas/mês
- **Build time:** 6.000 minutos/mês
- **Domínios customizados:** 1

### Stripe
- **Test Mode:** Gratuito
- **Live Mode:** 2.99% + R$ 0,80 por transação

---

## 📧 Envio de Emails

### Recomendação: Resend

**Resend** é o SMTP gratuito mais fácil de usar:
- **Gratuito:** 100 emails/dia
- **Fácil configuração:** Sem necessidade de servidor SMTP
- **API moderna:** Basta chamar a API

### Configuração Resend

1. Acesse https://resend.com
2. Crie uma conta gratuita
3. Crie uma API Key
4. Adicione no Vercel:
   ```bash
   vercel env add RESEND_API_KEY production
   # Cole sua API key
   ```

5. Crie um domínio verificado (opcional para testes)

### Alternativas Gratuitas

| Serviço | Limite | Melhor Para |
|---------|--------|------------|
| **Resend** | 100/dia | Transacionais simples |
| **Mailgun** | 100/mês | desenvolvimento |
| **SendGrid** | 100/dia | Alto volume |
| **Postmark** | 25/teste | Confiabilidade |

---

## 🔌 Integração Proxy-Seller (Futuro)

### API Base
```
https://proxy-seller.com/personal/api/v1/{API_KEY}/
```

### Endpoints Principais

#### 1. Listar Proxies Ativos
```
GET /proxy/list/ipv6
```
Resposta:
```json
{
  "status": "success",
  "data": {
    "ipv6": [
      {
        "id": "12345",
        "ip": "2a04:xxxx:xxxx::1",
        "port": 80,
        "login": "user1",
        "password": "pass1",
        "orderNumber": "3388485_57471911"
      }
    ]
  }
}
```

#### 2. Listar Autorizações (Usuários)
```
GET /auth/list
```
Retorna todos os usuário/senha criados para cada proxy.

#### 3. Criar Autorização (usuário para cliente)
```
POST /auth/add
Body: { "orderNumber": "3388485_57471911" }
```
Resposta:
```json
{
  "status": "success",
  "data": {
    "id": "66decee1e4b0c423139280d9",
    "active": true,
    "login": "cliente_abc",
    "password": "senha_cliente",
    "orderNumber": "3388485_57471911"
  }
}
```

#### 4. BLOQUEAR Cliente Específico (INADIMPLENTE)
```
POST /auth/change
Body: { "id": "66decee1e4b0c423139280d9", "active": false }
```
**Isso bloqueia SÓ aquele cliente, não afeta os outros!**

#### 5. Desbloquear Cliente
```
POST /auth/change
Body: { "id": "66decee1e4b0c423139280d9", "active": true }
```

#### 6. Trocar Senha do Cliente
```
POST /auth/change
Body: { "id": "66decee1e4b0c423139280d9", "password": "nova_senha_123" }
```

#### 7. Deletar Autorização
```
POST /auth/delete
Body: { "id": "66decee1e4b0c423139280d9" }
```

### Configuração (Futuro)

Adicionar no Vercel:
```bash
vercel env add PROXYSELLER_API_KEY production
# Cole sua API key do proxy-seller.com
```

### Fluxo de Inadimplência (A Implementar)

1. Assinatura expira → sistema detecta
2. Chama `POST /auth/change` com `active: false`
3. Cliente perde acesso ao proxy
4. Quando pagar, chama `POST /auth/change` com `active: true`
5. Cliente volta a ter acesso

---

## 🆘 Suporte

Para dúvidas técnicas:
1. Consulte esta documentação
2. Verifique logs no Vercel Dashboard
3. Teste APIs via Postman/curl
4. Verifique variáveis de ambiente

---

*Documento gerado em 10/04/2026*
