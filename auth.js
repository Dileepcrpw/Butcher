(function () {
    var STORAGE_KEY = 'butcher_accounts';
    var SESSION_KEY = 'butcher_session';

    function getUsers() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var data = JSON.parse(raw);
            return Array.isArray(data.users) ? data.users : [];
        } catch (e) {
            return [];
        }
    }

    function setUsers(users) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ users: users }));
    }

    function hashPassword(password) {
        if (window.crypto && crypto.subtle) {
            var enc = new TextEncoder();
            return crypto.subtle.digest('SHA-256', enc.encode(password)).then(function (buf) {
                return Array.from(new Uint8Array(buf))
                    .map(function (b) {
                        return b.toString(16).padStart(2, '0');
                    })
                    .join('');
            });
        }
        return Promise.resolve('fallback:' + btoa(unescape(encodeURIComponent(password))));
    }

    function normalizePhone(phone) {
        return String(phone || '').replace(/\D/g, '');
    }

    function setSession(user) {
        localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ phone: user.phone, fullName: user.fullName })
        );
    }

    function initSignup() {
        var form = document.getElementById('signupForm');
        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var fullName = document.getElementById('fullName').value.trim();
            var phone = normalizePhone(document.getElementById('signupPhone').value);
            var email = document.getElementById('signupEmail').value.trim();
            var password = document.getElementById('signupPassword').value;

            if (!fullName) {
                alert('Please enter your full name.');
                return;
            }
            if (phone.length !== 10) {
                alert('Please enter a valid 10-digit mobile number.');
                return;
            }
            if (password.length < 6) {
                alert('Password must be at least 6 characters.');
                return;
            }

            var users = getUsers();
            if (users.some(function (u) { return u.phone === phone; })) {
                alert('An account with this mobile number already exists. Please log in.');
                return;
            }

            hashPassword(password).then(function (hash) {
                users.push({
                    fullName: fullName,
                    phone: phone,
                    email: email,
                    passwordHash: hash,
                    createdAt: new Date().toISOString()
                });
                setUsers(users);
                setSession({ phone: phone, fullName: fullName });
                window.location.href = 'Index.html';
            });
        });
    }

    function initGetOtp() {
        var btn = document.getElementById('getOtpBtn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            var phone = normalizePhone(document.getElementById('phoneNumber').value);
            if (phone.length !== 10) {
                alert('Please enter a valid 10-digit mobile number.');
                return;
            }
            window.location.href = 'otp.html?phone=' + encodeURIComponent(phone);
        });
    }

    function initOtpPage() {
        var container = document.querySelector('.otp-container');
        if (!container) return;

        var params = new URLSearchParams(window.location.search);
        var phone = normalizePhone(params.get('phone') || '');
        if (phone.length !== 10) {
            window.location.href = 'Index.html';
            return;
        }

        var display = document.getElementById('otpPhoneDisplay');
        if (display) display.textContent = '+91 ' + phone;

        var form = document.getElementById('otpForm');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var otp = String(document.getElementById('otpInput').value || '').replace(/\D/g, '');
                if (otp.length < 4) {
                    alert('Please enter the OTP you received.');
                    return;
                }
                alert('OTP verified successfully.');
            });
        }

        var resend = document.getElementById('resendOtp');
        if (resend) {
            resend.addEventListener('click', function () {
                alert('A new code has been sent to +91 ' + phone + '.');
            });
        }
    }

    function initLogin() {
        var form = document.getElementById('loginForm');
        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var phone = normalizePhone(document.getElementById('phoneNumber').value);
            var passwordEl =
                document.getElementById('loginPassword') || document.getElementById('password');
            var password = passwordEl ? passwordEl.value : '';

            if (phone.length !== 10) {
                alert('Please enter a valid 10-digit mobile number.');
                return;
            }
            if (!password) {
                alert('Please enter your password.');
                return;
            }

            var users = getUsers();
            var user = users.find(function (u) { return u.phone === phone; });
            if (!user) {
                alert('No account found for this number. Please sign up first.');
                return;
            }

            hashPassword(password).then(function (hash) {
                if (hash !== user.passwordHash) {
                    alert('Incorrect password.');
                    return;
                }
                setSession({ phone: user.phone, fullName: user.fullName });
                if (passwordEl) passwordEl.value = '';
                window.location.href = 'home.html';
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initSignup();
            initLogin();
            initGetOtp();
            initOtpPage();
        });
    } else {
        initSignup();
        initLogin();
        initGetOtp();
        initOtpPage();
    }
})();
