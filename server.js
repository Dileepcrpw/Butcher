require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const twilio = require('twilio');

const app = express();
const port = Number(process.env.PORT) || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const defaultCountryCode = process.env.TWILIO_DEFAULT_COUNTRY_CODE || '+91';
const otpTestMode = String(process.env.OTP_TEST_MODE || 'false').toLowerCase() === 'true';
const otpExpirySeconds = Number(process.env.OTP_TEST_EXPIRY_SECONDS) || 300;
const localSmsLogging = String(process.env.LOCAL_SMS_LOGGING || 'true').toLowerCase() === 'true';
const otpStore = new Map();
const otpLogFile = path.join(__dirname, 'otp_log.txt');
const signupFile = path.join(__dirname, 'signup_data.json');
const hasTwilioConfig = Boolean(accountSid && authToken && verifyServiceSid);

app.use(express.json());
app.use(express.static(__dirname));

function normalizePhoneNumber(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim();

    if (trimmed.startsWith('+')) {
        const formatted = `+${trimmed.slice(1).replace(/\D/g, '')}`;
        return formatted.length >= 11 ? formatted : null;
    }

    const digits = trimmed.replace(/\D/g, '');

    if (digits.length === 10) {
        return `${defaultCountryCode}${digits}`;
    }

    if (digits.length > 10) {
        return `+${digits}`;
    }

    return null;
}

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function logSmsToFile(phoneNumber, otpCode) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Phone: ${phoneNumber} | OTP: ${otpCode}\n`;
    
    try {
        fs.appendFileSync(otpLogFile, logEntry, 'utf8');
        console.log(`[LOCAL SMS LOG] ${phoneNumber} -> ${otpCode}`);
        return true;
    } catch (error) {
        console.error('Failed to write OTP log:', error.message);
        return false;
    }
}

function readSignupData() {
    if (!fs.existsSync(signupFile)) {
        return [];
    }

    try {
        const raw = fs.readFileSync(signupFile, 'utf8').trim();
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeSignupData(data) {
    fs.writeFileSync(signupFile, JSON.stringify(data, null, 2), 'utf8');
}

app.post('/send-otp', async (req, res) => {
    const normalizedNumber = normalizePhoneNumber(req.body?.phoneNumber);

    if (!normalizedNumber) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid mobile number'
        });
    }

    if (otpTestMode) {
        const otpCode = generateOtp();
        const expiresAt = Date.now() + otpExpirySeconds * 1000;

        otpStore.set(normalizedNumber, {
            otpCode,
            expiresAt
        });

        console.log(`[OTP TEST MODE] ${normalizedNumber} -> ${otpCode}`);

        return res.status(200).json({
            success: true,
            status: 'pending',
            message: `Test OTP generated (valid for ${otpExpirySeconds} seconds)`,
            debugOtp: otpCode
        });
    }

    if (!hasTwilioConfig) {
        if (localSmsLogging) {
            const otpCode = generateOtp();
            const expiresAt = Date.now() + otpExpirySeconds * 1000;

            otpStore.set(normalizedNumber, {
                otpCode,
                expiresAt
            });

            logSmsToFile(normalizedNumber, otpCode);

            return res.status(200).json({
                success: true,
                status: 'pending',
                message: `OTP logged to: otp_log.txt`,
                fileLocation: path.join(__dirname, 'otp_log.txt')
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Missing Twilio config in .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)'
        });
    }

    try {
        const client = twilio(accountSid, authToken);

        const verification = await client.verify.v2
            .services(verifyServiceSid)
            .verifications.create({
                to: normalizedNumber,
                channel: 'sms'
            });

        return res.status(200).json({
            success: true,
            status: verification.status,
            message: 'OTP sent successfully'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to send OTP',
            details: error.message
        });
    }
});

app.post('/verify-otp', async (req, res) => {
    const normalizedNumber = normalizePhoneNumber(req.body?.phoneNumber);
    const otpCode = String(req.body?.otp || '').trim();

    if (!normalizedNumber) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid mobile number'
        });
    }

    if (!/^\d{4,8}$/.test(otpCode)) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid OTP'
        });
    }

    if (otpTestMode || localSmsLogging) {
        const entry = otpStore.get(normalizedNumber);

        if (!entry) {
            return res.status(400).json({
                success: false,
                message: 'No OTP requested for this number'
            });
        }

        if (Date.now() > entry.expiresAt) {
            otpStore.delete(normalizedNumber);
            return res.status(400).json({
                success: false,
                message: 'OTP expired. Request a new OTP'
            });
        }

        if (entry.otpCode !== otpCode) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }

        otpStore.delete(normalizedNumber);
        return res.status(200).json({
            success: true,
            status: 'approved',
            message: 'OTP verified successfully'
        });
    }

    if (!hasTwilioConfig) {
        return res.status(500).json({
            success: false,
            message: 'Missing Twilio config in .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)'
        });
    }

    try {
        const client = twilio(accountSid, authToken);

        const verificationCheck = await client.verify.v2
            .services(verifyServiceSid)
            .verificationChecks.create({
                to: normalizedNumber,
                code: otpCode
            });

        if (verificationCheck.status !== 'approved') {
            return res.status(400).json({
                success: false,
                status: verificationCheck.status,
                message: 'Invalid or expired OTP'
            });
        }

        return res.status(200).json({
            success: true,
            status: verificationCheck.status,
            message: 'OTP verified successfully'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to verify OTP',
            details: error.message
        });
    }
});

app.post('/signup', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);

    if (!name) {
        return res.status(400).json({
            success: false,
            message: 'Name is required'
        });
    }

    if (!phoneNumber) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid mobile number'
        });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid email address'
        });
    }

    try {
        const users = readSignupData();
        const duplicate = users.find((user) => user.email === email || user.phoneNumber === phoneNumber);

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: 'Account already exists with this email or phone number'
            });
        }

        const newUser = {
            id: Date.now(),
            name,
            email,
            phoneNumber,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        writeSignupData(users);

        return res.status(201).json({
            success: true,
            message: 'Sign up successful',
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                phoneNumber: newUser.phoneNumber
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to save signup',
            details: error.message
        });
    }
});

app.get('/', (_, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    if (otpTestMode) {
        console.log('[OTP TEST MODE] Enabled - SMS sending is bypassed.');
    } else if (localSmsLogging && !hasTwilioConfig) {
        console.log('[LOCAL SMS LOGGING] OTPs logged to otp_log.txt. Upgrade to Twilio for real SMS.');
    } else if (!hasTwilioConfig) {
        console.log('[OTP] Twilio config missing. Add credentials in .env to send real SMS OTP.');
    }
});
