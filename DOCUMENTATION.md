# FastProxy - Documentação do Sistema

## 📋 Resumo do Projeto

Sistema de gestão de proxies com compra via Stripe, portal do usuário e painel admin.

---

## 🗄️ Banco de Dados

### Tabelas Principais

| Tabela | Descrição |
|--------|----------|
| `users` | Usuários do sistema (email, senha, role, subscription_status) |
| `subscriptions` | Assinaturas ativas (período, proxy_count, datas) |
| `proxies` | Proxies dos usuários (ip, porta, credentials) |
| `proxy_orders` | Pedidos do sistema (quantidade, período, preço) |
| `reward_points` | Pontos de fidelidade |
| `reward_transactions` | Histórico de transações de pontos |
| `coupons` | Cupons de desconto |
| `proxy_replacements` | Histórico de trocas de proxy |

---

## 🔧 Implementações Realizadas

### 1. Portal do Usuário (portal.html)

**Funcionalidades:**
- Login com validação
- Dashboard mostrando proxies ativos
- Histórico de transações (pontos)
- Sistema de pontos de fidelidade
- Trocar proxy com pontos (100 pontos = 1 troca grátis)
- Preço dinâmico de troca (R$ 1,99 - 11,99 baseado em dias de uso)
- Mostrar data de criação de cada proxy
- Status "Ativo" quando tem proxies, mesmo sem subscription válida
- Expirado com opção de renovar em 12h

**Correções:**
- `hasActiveSubscription` agora considera usuários com proxies ativos
- Sistema não mostra mais "Expirado" incorretamente
- Data do proxy mostrada (📅)

### 2. Painel Admin (admin.html)

**Funcionalidades:**
- Login admin
- Listar usuários e proxies
- Atribuir proxy por email
- Cancelar assinaturas
- Estatísticas

**APIs utilizadas:**
- `/api/subscription/admin/users` - Lista usuários
- `/api/subscription/admin/users/by-email/:email` - Busca por email
- `/api/subscription/admin/proxies/allocate` - Aloca proxy

### 3. Checkout (routes/checkout.js + stripe.js)

**Fluxo:**
1. Usuário escolhe quantidade e período
2. Cria sessão Stripe com metadata
3. Após pagamento, cria subscription e proxies automaticamente
4. Pontos de fidelidade concedidos (1 ponto por R$ 1)

**Correções:**
- `proxy_count` lido corretamente da metadata (era `quantity`)
- Datas de subscription corrigidas

### 4. API de Login (routes/subscription.js)

**Correções:**
- Busca proxies por `user_id` (não só `subscription_id`)
- `hasActiveSubscription` considera usuários com proxies ativos
- Resposta inclui subscription mesmo quando não há subscription válida

---

## 🔐 Credenciais de Teste

### Admin
- Email: `ericktorresadm@hotmail.com`
- Senha: `@Fastproxy10`

### Usuários
| Email | Senha |
|-------|-------|
| erickusuario@tuamaeaquelaursa.com | erick123 |
| lis-lago@tuamaeaquelaursa.com | lis123 |

---

## 🌐 URLs

- **Produção**: https://fastproxyoriginal.vercel.app
- **Portal**: https://fastproxyoriginal.vercel.app/portal.html
- **Admin**: https://fastproxyoriginal.vercel.app/admin.html

---

## 📝 Variáveis de Ambiente (Vercel)

```
DATABASE_URL=postgresql://neondb_owner:npg_...@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require
APP_URL=https://fastproxyoriginal.vercel.app
JWT_SECRET=fastproxy_secret_key_2024
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 📌 Problemas Conhecidos

1. ~~Subscription não aparece no portal~~ ✅ CORRIGIDO
2. ~~Status mostra "Expirado" incorretamente~~ ✅ CORRIGIDO  
3. ~~Botão copiar não funciona~~ ✅ CORRIGIDO
4. ~~Swap price não mostra~~ ✅ CORRIGIDO

---

## 📅 Histórico de Alterações

### 2026-04-16
- Implementado sistema de pontos de fidelidade
- Portal mostra proxies ativos mesmo sem subscription válida
- Adicionada data de criação do proxy
- Melhorado modal de troca com preço padrão

### 2026-04-15
- Correção do proxy_count na metadata
- Login retorna dados de proxies corretamente

### 2026-04-14
- Deploy inicial após várias correções
- Sistema de checkout funcionando