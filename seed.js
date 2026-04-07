require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Plan = require('./models/Plan');
const Proxy = require('./models/Proxy');

const PROXY_IP = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');

function generateUsername() {
  return 'fastproxy' + Math.floor(Math.random() * 9000 + 1000);
}

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 6; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const adminExists = await User.findOne({ email: 'admin@fastproxy.com' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await User.create({
        name: 'Admin',
        email: 'admin@fastproxy.com',
        password: hashedPassword,
        role: 'admin'
      });
      console.log('✅ Admin user created');
    } else {
      console.log('ℹ️ Admin user already exists');
    }

    const plans = [
      { name: 'Júnior', price: 297, proxyCount: 1, tier: 'basic', period: 'monthly', replacements: 1, isActive: true, isFeatured: false },
      { name: 'Premium', price: 497, proxyCount: 1, tier: 'premium', period: 'monthly', replacements: 3, isActive: true, isFeatured: true },
      { name: 'Máster', price: 797, proxyCount: 1, tier: 'master', period: 'monthly', replacements: 5, isActive: true, isFeatured: false }
    ];

    for (const plan of plans) {
      const exists = await Plan.findOne({ name: plan.name });
      if (!exists) {
        await Plan.create(plan);
        console.log(`✅ Plan ${plan.name} created`);
      }
    }

    const proxyCount = await Proxy.countDocuments({ status: 'available' });
    if (proxyCount < 10) {
      const toCreate = 38 - proxyCount;
      const proxies = [];
      for (let i = 0; i < toCreate; i++) {
        const port = PORT_START + i;
        proxies.push({
          ip: PROXY_IP,
          port: port,
          username: generateUsername(),
          password: generatePassword(),
          tier: 'basic',
          status: 'available'
        });
      }
      await Proxy.insertMany(proxies);
      console.log(`✅ Created ${toCreate} proxy(s) in stock`);
    } else {
      console.log(`ℹ️ ${proxyCount} proxies already in stock`);
    }

    console.log('✅ Seed completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
}

seed();