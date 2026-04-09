const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth, admin } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { email, password, proxyCount, period } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Este email já está cadastrado. Tente fazer login.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      subscription: {
        period: period || 'monthly',
        proxyCount: proxyCount || 1,
        status: 'active',
        startDate: new Date()
      }
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d'
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        subscription: user.subscription
      }
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ success: false, message: 'Erro ao criar usuário', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d'
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        subscription: user.subscription
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Erro no login', error: err.message });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const User = require('../models/User');
    
    const adminExists = await User.findOne({ email: 'admin@fastproxy.com' });
    if (adminExists) {
      return res.json({ success: true, message: 'Admin já existe' });
    }
    
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({
      name: 'Admin',
      email: 'admin@fastproxy.com',
      password: hashedPassword,
      role: 'admin'
    });
    
    res.json({ success: true, message: 'Admin criado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro no setup', error: err.message });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      subscription: req.user.subscription
    }
  });
});

router.get('/users', auth, admin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários', error: err.message });
  }
});

module.exports = router;
