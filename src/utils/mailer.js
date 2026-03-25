/**
 * ============================================================================
 * FILE: mailer.js
 * PURPOSE: Professional Email Delivery Service
 * ============================================================================
 */

const nodemailer = require('nodemailer');

// Configuration for professional SMTP
// These should be defined in your .env file
const SMTP_CONFIG = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE === 'true' || true,
    auth: {
        user: process.env.EMAIL_USER || 'placeholder@domain.com',
        pass: process.env.EMAIL_PASS || 'placeholder_pass'
    }
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

/**
 * Send a professional HTML email
 * 
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content
 * @returns {Promise<boolean>} Success status
 */
async function sendEmail(to, subject, html) {
    try {
        const info = await transporter.sendMail({
            from: `"The Saran Trader" <${SMTP_CONFIG.auth.user}>`,
            to,
            subject,
            html
        });
        
        console.log(`✉️ [Email] Message sent: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('❌ [Email] Delivery failed:', error.message);
        // Fallback to console for development if needed
        if (process.env.NODE_ENV === 'development') {
            console.log('--- DEVELOPMENT MAIL FALLBACK ---');
            console.log(`To: ${to}`);
            console.log(`Subject: ${subject}`);
            console.log(`Content: ${html}`);
            console.log('-------------------------------');
        }
        return false;
    }
}

/**
 * Send OTP Verification Email
 * 
 * @param {string} email - Recipient email
 * @param {string} otp - 6-digit code
 * @returns {Promise<boolean>}
 */
async function sendOtpEmail(email, otp) {
    const subject = `${otp} is your verification code`;
    const html = `
        <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #2563eb; text-align: center;">The Saran Trader</h2>
            <p>Hello,</p>
            <p>Your verification code is:</p>
            <div style="background: #f8fafc; padding: 20px; text-align: center; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e293b; margin: 20px 0;">
                ${otp}
            </div>
            <p style="font-size: 14px; color: #64748b;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">© 2026 The Saran Trader. All rights reserved.</p>
        </div>
    `;
    
    return sendEmail(email, subject, html);
}

module.exports = {
    sendEmail,
    sendOtpEmail
};
