const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const { authenticate, isAdmin } = require('./subscription');

router.post('/log', async (req, res) => {
  try {
    const {
      userId,
      proxyId,
      clientIp,
      targetHost,
      targetPort,
      requestMethod,
      requestPath,
      requestHeaders,
      responseStatus,
      bytesSent,
      bytesReceived,
      connectionDuration,
      connectedAt,
      disconnectedAt,
      sessionId,
      userAgent
    } = req.body;

    await sql`
      INSERT INTO access_logs (
        user_id, proxy_id, client_ip, target_host, target_port,
        request_method, request_path, request_headers, response_status,
        bytes_sent, bytes_received, connection_duration,
        connected_at, disconnected_at, session_id, user_agent
      ) VALUES (
        ${userId}, ${proxyId}, ${clientIp}, ${targetHost}, ${targetPort},
        ${requestMethod}, ${requestPath}, ${requestHeaders}, ${responseStatus},
        ${bytesSent || 0}, ${bytesReceived || 0}, ${connectionDuration || 0},
        ${connectedAt ? new Date(connectedAt) : new Date()}, 
        ${disconnectedAt ? new Date(disconnectedAt) : null}, 
        ${sessionId}, ${userAgent}
      )
    `;

    res.json({ success: true });
  } catch (err) {
    console.error('Log access error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/logs', isAdmin, async (req, res) => {
  try {
    const { userId, proxyId, startDate, endDate, limit = 100 } = req.query;

    let query = sql`
      SELECT al.*, u.email, u.name, pp.ip as proxy_ip, pp.port as proxy_port
      FROM access_logs al
      JOIN users u ON al.user_id = u.id
      LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
      WHERE 1=1
    `;

    const params = [];

    if (userId) {
      query = sql`
        SELECT al.*, u.email, u.name, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.user_id = ${userId}
        ORDER BY al.connected_at DESC
        LIMIT ${parseInt(limit)}
      `;
    } else if (proxyId) {
      query = sql`
        SELECT al.*, u.email, u.name, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.proxy_id = ${proxyId}
        ORDER BY al.connected_at DESC
        LIMIT ${parseInt(limit)}
      `;
    } else if (startDate && endDate) {
      query = sql`
        SELECT al.*, u.email, u.name, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.connected_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
        ORDER BY al.connected_at DESC
        LIMIT ${parseInt(limit)}
      `;
    } else {
      query = sql`
        SELECT al.*, u.email, u.name, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        ORDER BY al.connected_at DESC
        LIMIT ${parseInt(limit)}
      `;
    }

    const logs = await query;

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/user/:userId', isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    let query;
    
    if (startDate && endDate) {
      query = sql`
        SELECT al.*, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.user_id = ${userId}
          AND al.connected_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
        ORDER BY al.connected_at DESC
        LIMIT 1000
      `;
    } else {
      query = sql`
        SELECT al.*, pp.ip as proxy_ip, pp.port as proxy_port
        FROM access_logs al
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.user_id = ${userId}
        ORDER BY al.connected_at DESC
        LIMIT 1000
      `;
    }

    const logs = await query;

    const userInfo = await sql`
      SELECT id, email, name, whatsapp, created_at
      FROM users WHERE id = ${userId}
    `;

    res.json({
      success: true,
      user: userInfo[0] || null,
      logs,
      totalConnections: logs.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/proxy/:proxyId', isAdmin, async (req, res) => {
  try {
    const { proxyId } = req.params;

    const logs = await sql`
      SELECT al.*, u.email, u.name
      FROM access_logs al
      JOIN users u ON al.user_id = u.id
      WHERE al.proxy_id = ${proxyId}
      ORDER BY al.connected_at DESC
      LIMIT 500
    `;

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/export', isAdmin, async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;

    let query;
    const params = [];

    if (userId) {
      query = sql`
        SELECT 
          u.id as usuario_id,
          u.email as usuario_email,
          u.name as usuario_nome,
          u.whatsapp as usuario_whatsapp,
          pp.ip as proxy_ip,
          pp.port as proxy_port,
          al.client_ip as ip_acesso_cliente,
          al.target_host as host_destino,
          al.target_port as porta_destino,
          al.request_method as metodo_http,
          al.request_path as caminho_requisicao,
          al.response_status as status_resposta,
          al.connected_at as data_conexao,
          al.disconnected_at as data_desconexao,
          al.bytes_sent as bytes_enviados,
          al.bytes_received as bytes_recebidos
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.user_id = ${userId}
        ORDER BY al.connected_at DESC
      `;
    } else if (startDate && endDate) {
      query = sql`
        SELECT 
          u.id as usuario_id,
          u.email as usuario_email,
          u.name as usuario_nome,
          u.whatsapp as usuario_whatsapp,
          pp.ip as proxy_ip,
          pp.port as proxy_port,
          al.client_ip as ip_acesso_cliente,
          al.target_host as host_destino,
          al.target_port as porta_destino,
          al.request_method as metodo_http,
          al.request_path as caminho_requisicao,
          al.response_status as status_resposta,
          al.connected_at as data_conexao,
          al.disconnected_at as data_desconexao,
          al.bytes_sent as bytes_enviados,
          al.bytes_received as bytes_recebidos
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.connected_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
        ORDER BY al.connected_at DESC
      `;
    } else {
      query = sql`
        SELECT 
          u.id as usuario_id,
          u.email as usuario_email,
          u.name as usuario_nome,
          u.whatsapp as usuario_whatsapp,
          pp.ip as proxy_ip,
          pp.port as proxy_port,
          al.client_ip as ip_acesso_cliente,
          al.target_host as host_destino,
          al.target_port as porta_destino,
          al.request_method as metodo_http,
          al.request_path as caminho_requisicao,
          al.response_status as status_resposta,
          al.connected_at as data_conexao,
          al.disconnected_at as data_desconexao,
          al.bytes_sent as bytes_enviados,
          al.bytes_received as bytes_recebidos
        FROM access_logs al
        JOIN users u ON al.user_id = u.id
        LEFT JOIN proxyseller_proxies pp ON al.proxy_id = pp.id
        WHERE al.connected_at > NOW() - INTERVAL '6 months'
        ORDER BY al.connected_at DESC
        LIMIT 10000
      `;
    }

    const logs = await query;

    const csvHeader = 'usuario_id,usuario_email,usuario_nome,usuario_whatsapp,proxy_ip,proxy_port,ip_acesso_cliente,host_destino,porta_destino,metodo_http,caminho_requisicao,status_resposta,data_conexao,data_desconexao,bytes_enviados,bytes_recebidos\n';

    const csvRows = logs.map(log => 
      `${log.usuario_id},${log.usuario_email},${log.usuario_nome || ''},${log.usuario_whatsapp || ''},${log.proxy_ip || ''},${log.proxy_port || ''},${log.ip_acesso_cliente || ''},${log.host_destino || ''},${log.porta_destino || ''},${log.metodo_http || ''},${(log.caminho_requisicao || '').replace(/,/g, ';')},${log.status_resposta || ''},${log.data_conexao || ''},${log.data_desconexao || ''},${log.bytes_enviados || 0},${log.bytes_recebidos || 0}`
    ).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=logs_acesso_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/stats', isAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = "WHERE al.connected_at > NOW() - INTERVAL '30 days'";
    if (startDate && endDate) {
      dateFilter = `WHERE al.connected_at BETWEEN '${startDate}' AND '${endDate}'`;
    }

    const stats = await sql`
      SELECT 
        COUNT(*) as total_conexoes,
        COUNT(DISTINCT al.user_id) as usuarios_ativos,
        COUNT(DISTINCT al.proxy_id) as proxies_utilizados,
        COUNT(DISTINCT al.client_ip) as ips_unicos_acesso,
        SUM(al.bytes_sent) as total_bytes_enviados,
        SUM(al.bytes_received) as total_bytes_recebidos,
        MIN(al.connected_at) as primeira_conexao,
        MAX(al.connected_at) as ultima_conexao
      FROM access_logs al
      ${startDate && endDate ? sql`WHERE al.connected_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}` : sql``}
    `;

    const topUsers = await sql`
      SELECT 
        u.id, u.email, u.name, u.whatsapp,
        COUNT(*) as total_conexoes,
        MAX(al.connected_at) as ultima_atividade
      FROM access_logs al
      JOIN users u ON al.user_id = u.id
      ${startDate && endDate ? sql`WHERE al.connected_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}` : sql``}
      GROUP BY u.id, u.email, u.name, u.whatsapp
      ORDER BY total_conexoes DESC
      LIMIT 10
    `;

    res.json({
      success: true,
      stats: stats[0],
      topUsers
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cleanup', isAdmin, async (req, res) => {
  try {
    const { daysToKeep = 180 } = req.body;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await sql`
      DELETE FROM access_logs 
      WHERE connected_at < ${cutoffDate}
      RETURNING id
    `;

    res.json({
      success: true,
      deletedRecords: result.length,
      cutoffDate: cutoffDate.toISOString(),
      message: `${result.length} registros antigos removidos. Mantidos logs dos últimos ${daysToKeep} dias.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/user/consent', authenticate, async (req, res) => {
  try {
    const consents = await sql`
      SELECT * FROM user_consents 
      WHERE user_id = ${req.user.id}
      ORDER BY granted_at DESC
    `;

    res.json({ success: true, consents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/user/consent', authenticate, async (req, res) => {
  try {
    const { consentType, granted, ipAddress, userAgent } = req.body;

    await sql`
      INSERT INTO user_consents (
        user_id, consent_type, consent_version, granted,
        ip_address, user_agent
      ) VALUES (
        ${req.user.id}, ${consentType}, '1.0', ${granted},
        ${ipAddress}, ${userAgent}
      )
    `;

    res.json({ success: true, message: 'Consentimento registrado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
