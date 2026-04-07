require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Plan = require('./models/Plan');

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
    }

    const plans = [
      { name: 'Starter', price: 47, proxyCount: 5, tier: 'starter' },
      { name: 'Business', price: 97, proxyCount: 20, tier: 'business' },
      { name: 'Enterprise', price: 197, proxyCount: 50, tier: 'enterprise' }
    ];

    for (const plan of plans) {
      const exists = await Plan.findOne({ name: plan.name });
      if (!exists) {
        await Plan.create(plan);
        console.log(`✅ Plan ${plan.name} created`);
      }
    }

    console.log('✅ Seed completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
}

seed();