// import fetch from 'node-fetch'; // Using global fetch

const API_URL = 'http://localhost:3000';
const TELEGRAM_ID = '123456789'; // Replace with a valid ID from your DB if needed for real test, or mock
const PASSWORD = 'password123';

async function testAPI() {
  console.log('🧪 Testing API...');

  // 1. Test Stats (Public)
  try {
    const statsRes = await fetch(`${API_URL}/stats`);
    const stats = await statsRes.json();
    console.log('✅ Stats:', stats);
  } catch (e) {
    console.error('❌ Stats failed:', e);
  }

  // 2. Test Login (Fail)
  try {
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: TELEGRAM_ID, password: 'wrongpassword' }),
    });
    if (loginRes.status === 401) {
      console.log('✅ Login fail test passed');
    } else {
      console.error('❌ Login fail test failed', await loginRes.json());
    }
  } catch (e) {
    console.error('❌ Login fail test error:', e);
  }

  // Note: To test success login, we need a real user with password in DB.
  // Since we can't easily interact with the running bot to set password, 
  // we will rely on manual verification or unit tests if needed.
  // But this script confirms API is up and routing works.
}

testAPI();
