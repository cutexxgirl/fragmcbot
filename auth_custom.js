/**
 * Custom Authentication Script
 * Handles login, session validation, and particle animation.
 */

// --- Particle Animation (Ported from launcher.html) ---
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('loginParticles');
    if (canvas) {
        canvas.style.pointerEvents = 'none';
        const ctx = canvas.getContext('2d');
        let width;
        let height;
        let particles = [];

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
                this.color = '#ffcd00';
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

        const mouse = { x: null, y: null };
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

const getConfigManager = () => require('./assets/js/configmanager');

const normalizeApiUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.replace(/\/+$/, '') : null;
};

const getSavedApiUrl = () => {
    try {
        const authData = getConfigManager().getAuthData();
        return normalizeApiUrl(authData?.apiUrl);
    } catch {
        return null;
    }
};

const resolveApiUrl = () => {
    const runtimeApiUrl = normalizeApiUrl(globalThis.FRAGMENT_API_URL);
    if (runtimeApiUrl) return runtimeApiUrl;

    const envApiUrl = normalizeApiUrl(globalThis.process?.env?.FRAGMENT_API_URL);
    if (envApiUrl) return envApiUrl;

    const savedApiUrl = getSavedApiUrl();
    if (savedApiUrl) return savedApiUrl;

    try {
        const localApiUrl = normalizeApiUrl(window.localStorage?.getItem('fragmentApiUrl'));
        if (localApiUrl) return localApiUrl;
    } catch {}

    if (window.location?.origin && /^https?:/i.test(window.location.origin)) {
        return normalizeApiUrl(window.location.origin);
    }

    return null;
};

const AuthManagerCustom = {
    getApiUrl() {
        const apiUrl = resolveApiUrl();
        if (!apiUrl) {
            throw new Error('Не настроен адрес API. Укажите FRAGMENT_API_URL для лаунчера.');
        }
        return apiUrl;
    },

    init() {
        this.bindEvents();
        this.checkStartupSession();
        setInterval(() => this.validateSession(), 60 * 60 * 1000);
    },

    bindEvents() {
        document.getElementById('toggleToken')?.addEventListener('click', () => {
            const input = document.getElementById('loginToken');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('togglePassword')?.addEventListener('click', () => {
            const input = document.getElementById('loginPassword');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

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
            const apiUrl = this.getApiUrl();

            submitBtn.disabled = true;
            submitBtn.textContent = 'ВХОД...';
            errorEl.style.display = 'none';

            const response = await fetch(`${apiUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: token, password })
            });

            if (!response.ok) {
                if (response.status === 503) {
                    throw new Error('Сервер временно недоступен. Попробуйте позже.');
                } else if (response.status === 500) {
                    throw new Error('Ошибка сервера. Попробуйте позже.');
                } else if (response.status === 401 || response.status === 403) {
                    throw new Error('Неверные данные входа');
                } else {
                    throw new Error('Ошибка соединения с сервером');
                }
            }

            const data = await response.json();
            const accessToken = data.accessToken;

            const profileRes = await fetch(`${apiUrl}/user/me`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!profileRes.ok) {
                throw new Error('Ошибка получения профиля');
            }

            const profile = await profileRes.json();
            const ConfigManager = getConfigManager();
            ConfigManager.setAuthData({
                accessToken,
                uuid: token,
                password: remember ? password : null,
                gameNickname: nickname,
                userProfile: profile,
                apiUrl,
                lastLogin: new Date().toISOString()
            });

            this.onLoginSuccess();
        } catch (err) {
            console.error('[AUTH] Login failed:', err);
            this.showError(err.message || 'Ошибка соединения с сервером');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'ВОЙТИ В ИГРУ';
        }
    },

    async checkStartupSession() {
        const ConfigManager = getConfigManager();
        const authData = ConfigManager.getAuthData();

        if (authData?.accessToken) {
            try {
                const apiUrl = this.getApiUrl();
                const res = await fetch(`${apiUrl}/user/me`, {
                    headers: { Authorization: `Bearer ${authData.accessToken}` }
                });

                if (!res.ok) {
                    return;
                }

                const profile = await res.json();
                if (profile.status === 'frozen' || profile.status === 'expired') {
                    throw new Error('Аккаунт заморожен или истек');
                }

                ConfigManager.setAuthData({ ...authData, userProfile: profile, apiUrl });
                this.onLoginSuccess();
            } catch (err) {
                console.log('Startup session check failed:', err);
            }
        }
    },

    async validateSession() {
        const ConfigManager = getConfigManager();
        const authData = ConfigManager.getAuthData();

        if (!authData?.accessToken) return;

        try {
            const apiUrl = this.getApiUrl();
            const res = await fetch(`${apiUrl}/user/me`, {
                headers: { Authorization: `Bearer ${authData.accessToken}` }
            });

            if (!res.ok) throw new Error('Token expired');

            const profile = await res.json();
            if (profile.status === 'frozen' || profile.status === 'expired') {
                throw new Error('Account status invalid');
            }

            ConfigManager.setAuthData({ ...authData, userProfile: profile, apiUrl });
        } catch (err) {
            console.warn('Session validation failed:', err);
            this.logout();
            this.showError('Ваша сессия истекла. Пожалуйста, войдите снова.');
        }
    },

    onLoginSuccess() {
        document.getElementById('customLoginContainer').style.display = 'none';

        if (typeof switchView === 'function' && typeof VIEWS !== 'undefined') {
            switchView(getCurrentView(), VIEWS.landing);
        } else {
            const landing = document.getElementById('landingContainer');
            if (landing) {
                landing.style.display = 'block';
                landing.style.opacity = '1';
            }
        }

        if (typeof AccountManager !== 'undefined' && AccountManager.init) {
            AccountManager.init();
        }
    },

    logout() {
        document.getElementById('customLoginContainer').style.display = 'flex';
    },

    showError(msg) {
        const el = document.getElementById('loginError');
        el.textContent = msg;
        el.style.display = 'block';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AuthManagerCustom.init();
});
