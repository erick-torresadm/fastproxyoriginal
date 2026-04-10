const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql } = require('../lib/database');

const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

router.post('/register', async (req, res) => {
  try {
    const { email, password, proxyCount, period } = req.body;
    
    console.log('Register attempt:', email);
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Check if user exists
    const existingUsers = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Este email já está cadastrado. Tente fazer login.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUsers = await sql`
      INSERT INTO users (email, password, subscription_period, subscription_proxy_count, subscription_status, subscription_start_date)
      VALUES (${email.toLowerCase()}, ${hashedPassword}, ${period || 'monthly'}, ${proxyCount || 1}, 'active', CURRENT_TIMESTAMP)
      RETURNING id, email, subscription_period, subscription_proxy_count, subscription_status
    `;
    
    const user = newUsers[0];
    
    console.log('User created:', user.email);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRE
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        subscription: {
          period: user.subscription_period,
          proxyCount: user.subscription_proxy_count,
          status: user.subscription_status
        }
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar usuário', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRE
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        subscription: {
          period: user.subscription_period,
          proxyCount: user.subscription_proxy_count,
          status: user.subscription_status
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Erro no login', error: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const users = await sql`
      SELECT id, email, subscription_period, subscription_proxy_count, subscription_status, subscription_start_date, subscription_end_date
      FROM users WHERE id = ${decoded.id}
    `;
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    
    const user = users[0];
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        subscription: {
          period: user.subscription_period,
          proxyCount: user.subscription_proxy_count,
          status: user.subscription_status,
          startDate: user.subscription_start_date,
          endDate: user.subscription_end_date
        }
      }
    });
  } catch (err) {
    console.error('Auth check error:', err.message);
    res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    
    const admins = await sql`SELECT id FROM users WHERE email = 'admin@fastproxy.com'`;
    
    if (admins.length > 0) {
      return res.json({ success: true, message: 'Admin já existe' });
    }
    
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await sql`
      INSERT INTO users (email, password, name, role)
      VALUES ('admin@fastproxy.com', ${hashedPassword}, 'Admin', 'admin')
    `;
    
    res.json({ success: true, message: 'Admin criado com sucesso' });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ success: false, message: 'Erro no setup', error: err.message });
  }
});

router.get('/check-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const users = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    res.json({
      exists: users.length > 0,
      email: email.toLowerCase()
    });
  } catch (err) {
    console.error('Check email error:', err);
    res.status(500).json({ exists: false, error: err.message });
  }
});

module.exports = router;
