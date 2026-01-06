/**
 * Custom Authentication Script
 * Handles login, session validation, and particle animation
 */

// --- Particle Animation (Ported from launcher.html) ---
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('loginParticles');
    if (canvas) {
        canvas.style.pointerEvents = 'none'; // Ensure clicks pass through
        const ctx = canvas.getContext('2d');
        let width, height;
        let particles = [];

        // Configuration
        const particleCount = 60;
        const connectionDistance = 120;
        const mouseDistance = 150;

        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }

        class Particle {
            constructor() {
                this.x = Math.random() * width;
                this.y = Math.random() * height;
                this.vx = (Math.random() - 0.5) * 1;
                this.vy = (Math.random() - 0.5) * 1;
                this.size = Math.random() * 2 + 1;
                this.color = '#ffcd00'; // Yellow
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;

                if (this.x < 0 || this.x > width) this.vx *= -1;
                if (this.y < 0 || this.y > height) this.vy *= -1;
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.4;
                ctx.fill();
            }
        }

        function initParticles() {
            particles = [];
            for (let i = 0; i < particleCount; i++) {
                particles.push(new Particle());
            }
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);

            for (let i = 0; i < particles.length; i++) {
                particles[i].update();
                particles[i].draw();

                // Connections between particles
                for (let j = i; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < connectionDistance) {
                        ctx.beginPath();
                        ctx.strokeStyle = '#ffcd00';
                        ctx.globalAlpha = 0.15 * (1 - distance / connectionDistance);
                        ctx.lineWidth = 1;
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }

                // Mouse interaction - draw lines to cursor
                if (mouse.x && mouse.y) {
                    const dx = particles[i].x - mouse.x;
                    const dy = particles[i].y - mouse.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < mouseDistance) {
                        ctx.beginPath();
                        ctx.strokeStyle = '#ffcd00';
                        ctx.globalAlpha = 0.3 * (1 - distance / mouseDistance);
                        ctx.lineWidth = 1.5;
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(mouse.x, mouse.y);
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(animate);
        }

        // Mouse interaction
        let mouse = { x: null, y: null };
        window.addEventListener('mousemove', (e) => {
            mouse.x = e.x;
            mouse.y = e.y;
        });

        window.addEventListener('resize', () => {
            resize();
            initParticles();
        });

        resize();
        initParticles();
        animate();
    }
});

// --- Auth Logic ---

const AuthManagerCustom = {
    API_URL: 'http://85.198.81.194:3000',

    init() {
        this.bindEvents();
        this.checkStartupSession();
        
        // Start hourly validation
        setInterval(() => this.validateSession(), 60 * 60 * 1000);
    },

    bindEvents() {
        // Toggle Password Visibility
        document.getElementById('toggleToken')?.addEventListener('click', () => {
            const input = document.getElementById('loginToken');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('togglePassword')?.addEventListener('click', () => {
            const input = document.getElementById('loginPassword');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        // Form Submit
        document.getElementById('customLoginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });
    },

    async login() {
        const token = document.getElementById('loginToken').value.trim();
        const password = document.getElementById('loginPassword').value.trim();
        const nickname = document.getElementById('loginNickname').value.trim();
        const remember = document.getElementById('loginRemember').checked;
        const errorEl = document.getElementById('loginError');
        const submitBtn = document.getElementById('loginSubmitBtn');

        if (!token || !password || !nickname) {
            this.showError('Заполните все поля');
            return;
        }

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'ВХОД...';
            errorEl.style.display = 'none';

            console.log('[AUTH] Starting login process...');
            console.log('[AUTH] Token (UUID):', token);
            console.log('[AUTH] Nickname:', nickname);
            console.log('[AUTH] Remember Me:', remember);

            // 1. Auth Request
            console.log('[AUTH] Step 1: Sending POST to', `${this.API_URL}/auth/login`);
            const requestBody = { accessToken: token, password: password };
            console.log('[AUTH] Request body:', { accessToken: token, password: '***' });
            
            const response = await fetch(`${this.API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody) 
            });

            console.log('[AUTH] Step 1: Response status:', response.status, response.statusText);

            if (!response.ok) {
                if (response.status === 503) {
                    console.error('[AUTH] Server unavailable (503)');
                    throw new Error('Сервер временно недоступен. Попробуйте позже.');
                } else if (response.status === 500) {
                    console.error('[AUTH] Server error (500)');
                    throw new Error('Ошибка сервера. Попробуйте позже.');
                } else if (response.status === 401 || response.status === 403) {
                    console.error('[AUTH] Auth failed (401/403)');
                    throw new Error('Неверные данные входа');
                } else {
                    console.error('[AUTH] Unexpected error:', response.status);
                    throw new Error('Ошибка соединения с сервером');
                }
            }

            const data = await response.json();
            const accessToken = data.accessToken;
            console.log('[AUTH] Step 1: Received access token:', accessToken ? 'YES' : 'NO');

            // 2. Get Profile
            console.log('[AUTH] Step 2: Fetching profile from', `${this.API_URL}/user/me`);
            const profileRes = await fetch(`${this.API_URL}/user/me`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            console.log('[AUTH] Step 2: Response status:', profileRes.status);
            if (!profileRes.ok) throw new Error('Ошибка получения профиля');
            const profile = await profileRes.json();
            console.log('[AUTH] Step 2: Profile loaded:', profile);

            // 3. Save Session
            console.log('[AUTH] Step 3: Saving session to ConfigManager...');
            const ConfigManager = require('./assets/js/configmanager');
            ConfigManager.setAuthData({
                accessToken: accessToken,
                uuid: token, // Saving the ID entered
                password: remember ? password : null, // Only save if remember is checked
                gameNickname: nickname,
                userProfile: profile,
                lastLogin: new Date().toISOString()
            });
            console.log('[AUTH] Step 3: Session saved');

            // 4. Success
            console.log('[AUTH] Login successful! Proceeding to main UI...');
            this.onLoginSuccess();

        } catch (err) {
            console.error('[AUTH] Login failed:', err);
            console.error('[AUTH] Error message:', err.message);
            console.error('[AUTH] Full error:', err);
            this.showError(err.message || 'Ошибка соединения с сервером');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'ВОЙТИ В ИГРУ';
        }
    },

    async checkStartupSession() {
        const ConfigManager = require('./assets/js/configmanager');
        const authData = ConfigManager.getAuthData();

        if (authData && authData.accessToken) {
            // Validate token
            try {
                const res = await fetch(`${this.API_URL}/user/me`, {
                    headers: { 'Authorization': `Bearer ${authData.accessToken}` }
                });

                if (res.ok) {
                    const profile = await res.json();
                    if (profile.status === 'frozen' || profile.status === 'expired') {
                        throw new Error('Аккаунт заморожен или истек');
                    }
                    
                    // Update profile and proceed
                    ConfigManager.setAuthData({ ...authData, userProfile: profile });
                    this.onLoginSuccess();
                } else {
                    throw new Error('Сессия истекла');
                }
            } catch (err) {
                console.log('Startup session check failed:', err);
                // Don't show error or pre-fill on first load, just leave login visible
            }
        }
        // If no auth data, login modal stays visible (it's default state)
    },

    async validateSession() {
        const ConfigManager = require('./assets/js/configmanager');
        const authData = ConfigManager.getAuthData();

        if (!authData?.accessToken) return;

        try {
            const res = await fetch(`${this.API_URL}/user/me`, {
                headers: { 'Authorization': `Bearer ${authData.accessToken}` }
            });

            if (!res.ok) throw new Error('Token expired');
            
            const profile = await res.json();
            if (profile.status === 'frozen' || profile.status === 'expired') {
                throw new Error('Account status invalid');
            }
        } catch (err) {
            console.warn('Session validation failed:', err);
            this.logout();
            this.showError('Ваша сессия истекла. Пожалуйста, войдите снова.');
        }
    },

    onLoginSuccess() {
        // Hide login container
        document.getElementById('customLoginContainer').style.display = 'none';
        
        // Show landing (using global switchView if available, or just fading in)
        // Assuming standard Helios/Electron launcher structure where we have views
        if (typeof switchView === 'function' && typeof VIEWS !== 'undefined') {
            switchView(getCurrentView(), VIEWS.landing);
        } else {
            // Fallback if switchView isn't ready yet
            const landing = document.getElementById('landingContainer');
            if (landing) {
                landing.style.display = 'block';
                landing.style.opacity = '1';
            }
        }
        
        // Load account data into dashboard if it exists
        if (typeof AccountManager !== 'undefined' && AccountManager.init) {
            AccountManager.init();
        }
    },

    logout() {
        const ConfigManager = require('./assets/js/configmanager');
        // Keep credentials if "remember me" was used? 
        // The prompt says "Fields not cleared" on error, but for explicit logout usually we clear.
        // However, for "Auto-check -> frozen/expired -> THROW TO LOGIN", we should keep fields.
        
        // We just show the login container again.
        document.getElementById('customLoginContainer').style.display = 'flex';
    },

    showError(msg) {
        const el = document.getElementById('loginError');
        el.textContent = msg;
        el.style.display = 'block';
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    AuthManagerCustom.init();
});
