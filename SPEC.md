# FastProxy - Sistema de Gestão de Proxies HTTP

## Visão Geral do Projeto

**Nome:** FastProxy  
**Tipo:** SaaS de Gestão de Proxies HTTP  
**Resumo:** Sistema para venda e administração de proxies HTTP dedicados para campanhas, bots e automações.  
**Usuários-alvo:** Profissionais de marketing digital, desenvolvedores de bots, empresas de automação

---

## Especificação de Requisitos

### 1. Formato dos Proxies

O sistema deve gerar proxies no formato:
```
username:password@ip:port
```

Exemplo:
```
fastproxy123:fast123@177.54.146.90:11331
fastproxy123:fast123@177.54.146.90:11332
fastproxy123:fast123@177.54.146.90:11333
fastproxy123:fast123@177.54.146.90:11368
```

**Regras:**
- Um proxy por linha (um por linha no arquivo)
- Quando cliente compra **N** proxies, recebe **N** linhas
- O IPbase é fixo por cliente, apenas a porta varia
- O username é criado automaticamente (ex: fastproxy{número})

### 2. Páginas do Sistema

| Página | Arquivo | Descrição |
|-------|--------|-----------|
| Landing Page | `index.html` | Página de vendas e conversão |
| Portal do Cliente | `portal.html` | Área restrita para clientes gerenciarem proxies |
| Painel Admin | `admin.html` | Área administrativa para gestão |

### 3. Fluxo do Cliente

```
Landing Page → Escolher Plano → Cadastro/Login → Compra → Receber Proxies
```

---

## Análise dos Arquivos Atuais

### Structure Atual

```
fastproxyv3/
├── public/
│   ├── index.html       (landing - modelo perfis Facebook)
│   ├── portal.html     (cliente - modelo perfis Facebook)  
│   └── admin.html      (admin - modelo perfis Facebook)
├── server/
│   ├── src/api/index.ts
│   └── package.json
├── server.js           (Express server principal)
├── routes/
│   ├── auth.js
│   ├── proxies.js
│   ├── orders.js
│   └── plans.js
├── models/
│   ├── User.js
│   ├── Proxy.js
│   ├── Order.js
│   └── Plan.js
├── middleware/
│   └── auth.js
├── package.json
└── seed.js
```

### Problemas Identificados

1. **Modelo atual é para Perfis Facebook** - precisa adaptar para Proxies HTTP
2. **Formato perfil** - atualmente `email|senha`, precisa ser `user:pass@ip:port`
3. **Campos do modelo** - não tem campos específicos de proxy (ip, port, username, password)

---

## Especificação Técnica

### Modelo de Proxy (novo)

```javascript
// models/Proxy.js - ATUALIZAR
{
  ip: { type: String, required: true },        // 177.54.146.90
  port: { type: Number, required: true },        // 11331, 11332, etc
  username: { type: String, required: true },   // fastproxy123
  password: { type: String, required: true },  // fast123
  tier: { type: String, enum: ['basic', 'premium', 'master'], default: 'basic' },
  status: { type: String, enum: ['available', 'active', 'expired'], default: 'available' },
  userId: { type: ObjectId, ref: 'User' },
  orderId: { type: ObjectId, ref: 'Order' },
  expiresAt: { type: Date },
  basePort: { type: Number }  // porta base para cliente específico
}
```

### Gerenciamento de Portas

- Cada cliente recebe um IP dedicado ou grupo de portas
- Exemplo: IP `177.54.146.90` com portas `11331-11368` (38 portas disponíveis)
- Sistema aloca automaticamente a próxima porta livre

### API Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/proxies` | Listar todos os proxies (admin) |
| GET | `/api/proxies/my` | Listar proxies do cliente |
| GET | `/api/proxies/available` | Listar proxies disponíveis |
| POST | `/api/proxies` | Criar proxy (admin) |
| POST | `/api/proxies/bulk` | Criar múltiplos proxies (admin) |
| POST | `/api/proxies/allocate` | Alocar proxy para cliente |
| PUT | `/api/proxies/:id` | Atualizar proxy |
| DELETE | `/api/proxies/:id` | Deletar proxy (admin) |

---

## Design de Referência

### Style Guide (Tailwind CSS)

**Cores do tema:**
```javascript
colors: {
  brand: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d'
  }
}
```

**Fonte:** Inter  
**Gradiente:** `linear-gradient(135deg, #a855f7 0%, #6366f1 50%, #3b82f6 100%)`

### Estrutura das Páginas

#### Landing Page (`index.html`)

1. **Navbar** - Logo, links, tema toggle, botão área cliente
2. **Hero** - Headline, CTA, benefícios
3. **Estatísticas** - 50K+ proxies, 500+ clientes, 99.9% uptime, 24/7
4. **Problema/Solução** - Comparativo antes/depois
5. **Benefícios** - 6 cards com ícones
6. **Como Funciona** - 4 passos
7. **Planos** - Toggle mensal/anual/compra única
8. **FAQ** - Perguntas frequentes
9. **Footer** - Links, WhatsApp

#### Portal Cliente (`portal.html`)

1. **Navbar** - Logo, menus, usuário logado
2. **Auth** - Login/Cadastro (modal ou seção)
3. **Meus Proxies** - Lista com botão copiar/baixa
4. **Planos** - Compra de mais proxies
5. **Pedidos** - Histórico
6. **Reposição** - Solicitar substituição

#### Painel Admin (`admin.html`)

1. **Navbar** - Logo, menus admin
2. **Login** - Autenticação admin
3. **Dashboard** - Estatísticas
4. **Pedidos** - Gerenciar pedidos
5. **Proxies** - Estoque
6. **Upload** - Importar bulk
7. **Usuários** - Gerenciar clientes

---

## Tarefas de Adaptação

### Fase 1: Backend

- [x] Atualizar modelo Proxy para campos de proxy HTTP
- [ ] Criar seed com IPs e portas disponíveis
- [x] Atualizar rotas para novo modelo
- [x] Implementar alocação automática de portas

### Fase 2: Frontend

- [ ] Atualizar index.html para FastProxy
- [ ] Atualizar portal.html para exibir proxies formato correto
- [ ] Atualizar admin.html para gerenciar proxies
- [ ] Adicionar botão copiar/baixa

### Fase 3: Deploy

- [ ] Testar localmente
- [ ] Deploy no Vercel
- [ ] Configurar MongoDB Atlas
- [ ] Deploy produção

---

## Notas do Desenvolvedor

### Repositório de Referência

- GitHub: https://github.com/erick-torresadm/fastproxyoriginal.git
- Design atual é para "perfis Facebook" - precisa adaptar para "proxies HTTP"

### Diferenças Principais

| Aspecto | AdFast (Atual) | FastProxy (Novo) |
|---------|---------------|-----------------|
| Produto | Perfis Facebook | Proxies HTTP |
| Formato | email:senha | user:pass@ip:port |
| Campos | email, password, cookies | ip, port, username, password |
| Entrega | Arquivo com credenciais | Proxy formatado |

### Conexão com adfast

O usuário mencionou que gostou do design e do fluxo de deploy da pasta `adfast` - usar como referência visual e estrutura de deployment.