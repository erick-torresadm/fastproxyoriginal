const { Resend } = require('resend');
const RESEND_API_KEY = process.env.RESEND_API_KEY;

let resend;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY || !resend) {
    console.error('❌ RESEND_API_KEY not set');
    console.log('📧 Email would be sent to:', to, '- Subject:', subject);
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'FastProxy <noreply@fastproxy.com>',
      to: [to],
      subject: subject,
      html: html
    });

    if (error) {
      console.error('❌ Email error:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Email sent to:', to);
    return { success: true, data };
  } catch (err) {
    console.error('❌ Email exception:', err);
    return { success: false, error: err.message };
  }
}

async function sendWelcomeEmail(email, name, proxies) {
  const proxiesList = proxies.map(p => 
    `<li style="font-family: monospace; background: #1a1a1a; padding: 10px; margin: 5px 0; border-radius: 5px;">${p.line || `${p.username}:${p.password}@${p.ip}:${p.port}`}</li>`
  ).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #ffffff;">
      <div style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 30px; border-radius: 15px 15px 0 0; text-align: center;">
        <h1 style="margin: 0; color: white;">🛡️ FastProxy</h1>
      </div>
      
      <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 15px 15px;">
        <h2 style="color: #22c55e; margin-top: 0;">Bem-vindo, ${name || 'Cliente'}! 🎉</h2>
        
        <p style="color: #a0a0a0; line-height: 1.6;">
          Sua conta foi criada com sucesso! Abaixo estão suas credenciais de proxy:
        </p>
        
        <div style="background: #0a0a0a; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <h3 style="color: #22c55e; margin-top: 0;">📋 Suas Credenciais:</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${proxiesList}
          </ul>
        </div>
        
        <p style="color: #a0a0a0; font-size: 14px;">
          Copie e cole as credenciais acima no seu software de proxy.
        </p>
        
        <a href="https://fastproxyv3.vercel.app/portal.html" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold; margin-top: 20px;">
          Acessar Painel
        </a>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
        <p>Este é um email automático do FastProxy. Não responda esta mensagem.</p>
        <p>© 2026 FastProxy. Todos os direitos reservados.</p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🎉 Bem-vindo ao FastProxy - Suas Credenciais',
    html
  });
}

async function sendRenewalReminder(email, name, daysLeft, discountCode) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #ffffff;">
      <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 30px; border-radius: 15px 15px 0 0; text-align: center;">
        <h1 style="margin: 0; color: white;">⚠️ Aviso Importante</h1>
      </div>
      
      <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 15px 15px;">
        <h2 style="color: #f59e0b;">Olá, ${name || 'Cliente'}!</h2>
        
        <p style="color: #a0a0a0; line-height: 1.6;">
          Sua assinatura do FastProxy expira em <strong style="color: #f59e0b;">${daysLeft} dia(s)</strong>!
        </p>
        
        <div style="background: #0a0a0a; padding: 20px; border-radius: 10px; margin: 20px 0; border: 2px solid #22c55e;">
          <h3 style="color: #22c55e; margin-top: 0;">🎁 Cupom de Renovação - 50% OFF</h3>
          <p style="color: #a0a0a0;">Use o código abaixo para renovar com desconto:</p>
          <div style="background: #22c55e; color: white; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; border-radius: 5px; letter-spacing: 3px;">
            ${discountCode || 'RENOVACAO50'}
          </div>
          <p style="color: #22c55e; margin-top: 10px;">Válido por 7 dias!</p>
        </div>
        
        <a href="https://fastproxyv3.vercel.app/" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold;">
          Renovar Agora
        </a>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '⚠️ Sua assinatura expira em breve - Use o cupom 50% OFF',
    html
  });
}

async function sendProxyCredentials(email, name, proxies, reason = 'Credenciais atualizadas') {
  const proxiesList = proxies.map(p => 
    `<li style="font-family: monospace; background: #1a1a1a; padding: 10px; margin: 5px 0; border-radius: 5px;">${p.line || `${p.username}:${p.password}@${p.ip}:${p.port}`}</li>`
  ).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #ffffff;">
      <div style="background: linear-gradient(135deg, #22c55e, #16a34a); padding: 30px; border-radius: 15px 15px 0 0; text-align: center;">
        <h1 style="margin: 0; color: white;">🔄 Proxy Atualizado</h1>
      </div>
      
      <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 15px 15px;">
        <h2 style="color: #22c55e;">Olá, ${name || 'Cliente'}!</h2>
        
        <p style="color: #a0a0a0;">${reason}</p>
        
        <div style="background: #0a0a0a; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <h3 style="color: #22c55e; margin-top: 0;">📋 Novas Credenciais:</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${proxiesList}
          </ul>
        </div>
        
        <a href="https://fastproxyv3.vercel.app/portal.html" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold;">
          Acessar Painel
        </a>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🔄 FastProxy - Suas Novas Credenciais',
    html
  });
}

module.exports = { sendEmail, sendWelcomeEmail, sendRenewalReminder, sendProxyCredentials };
