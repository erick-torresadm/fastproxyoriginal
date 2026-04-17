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

## 🔧 Lógica do Sistema (SIMPLIFICADA)

### Regra Principal: PROXY = ACESSO

**Se o usuário tem proxies ativos = pode usar o sistema**
- Não precisa de subscription válida para acessar portal
- Não precisa de subscription válida para ver proxies
- Não precisa de subscription válida para trocar proxy

### Fluxo Simplificado:

1. **Usuário compra** → Sistema cria subscription + proxies
2. **Usuário tem proxies** → Acesso garantido ao portal
3. **Subscription expira** → Usuário ainda usa proxies até renovar
4. **Renovar** → Estende data da subscription

### Código (regras):

```
SE (user.tem proxies ativos) → ACESSO LIBERADO
SE (subscription.expirada) → MOSTRAR "RENOVE EM 12H"
SE (não tem proxies) → MOSTRAR "COMPRE PROXIES"
```

### APIs importante:

- `/login` - Retorna proxies se usuário tem proxies ativos
- `/me` - Retorna proxies se usuário tem proxies ativos
- `hasActiveSubscription` = TRUE se tem proxies OU subscription válida

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
5. ~~API /me não retorna proxies quando não tem subscription~~ ✅ CORRIGIDO

## 📌 Estados do Usuário

| Tem Proxies | Sub Válida | Status Mostrado |
|------------|------------|----------------|
| SIM | SIM | Ativo |
| SIM | NÃO | Ativo (pode renovar) |
| NÃO | SIM | Ativo (sem proxies ainda) |
| NÃO | NÃO | Precisa comprar |

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