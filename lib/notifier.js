const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('📢 [Telegram not sent] TOKEN or CHAT_ID not configured');
    return;
  }
  try {
    const res = await fetch(TELEGRAM_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('❌ Telegram error:', data.description);
    }
  } catch (err) {
    console.error('❌ Telegram exception:', err.message);
  }
}

async function notifyPurchase({ user, order, proxies }) {
  const typeLabels = { ipv6: 'IPv6', ipv4: 'IPv4', isp: 'ISP', mobile: 'Mobile 4G/5G' };
  const periodLabels = { '1w': '1 Sem', '2w': '2 Sem', '1m': '1 Mês', '3m': '3 Meses', '6m': '6 Meses', '12m': '12 Meses', monthly: 'Mensal', annual: 'Anual' };

  const type = typeLabels[order?.type] || order?.type || '?';
  const period = periodLabels[order?.period] || order?.period || '';
  const qty = order?.quantity || proxies?.length || 0;
  const price = order?.pricePaid ? `R$ ${Number(order.pricePaid).toFixed(2).replace('.', ',')}` : '?';

  const msg = `<b>💰 Nova Compra — FastProxy</b>

👤 <b>Email:</b> ${user?.email || '?'}
📱 <b>WhatsApp:</b> ${user?.whatsapp || '—'}
📦 <b>Tipo:</b> ${type}
🔢 <b>Qtd:</b> ${qty} proxy(s)
⏱️ <b>Período:</b> ${period}
💵 <b>Valor:</b> ${price}
🕐 <b>Hora:</b> ${new Date().toLocaleString('pt-BR')}`;

  await sendTelegram(msg);
}

async function notifyCancellation({ user, subscription, reason }) {
  const msg = `<b>❌ Cancelamento — FastProxy</b>

👤 <b>Email:</b> ${user?.email}
📦 <b>Plano:</b> ${subscription?.period || '?'} — ${subscription?.proxyCount || 0} proxy(s)
📝 <b>Motivo:</b> ${reason || 'Não informado'}
🕐 <b>Hora:</b> ${new Date().toLocaleString('pt-BR')}`;

  await sendTelegram(msg);
}

async function testNotification() {
  await sendTelegram(`🧪 <b>Teste — FastProxy</b>

Notificações do Telegram estão funcionando!
🕐 ${new Date().toLocaleString('pt-BR')}`);
}

module.exports = { sendTelegram, notifyPurchase, notifyCancellation, testNotification };
