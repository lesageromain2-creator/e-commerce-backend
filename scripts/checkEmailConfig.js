// backend/scripts/checkEmailConfig.js
// Script pour vérifier la configuration email en production

require('dotenv').config();

console.log('🔍 Vérification configuration Email\n');

// Vérifier les variables essentielles
const requiredVars = [
  'EMAIL_PROVIDER',
  'SMTP_HOST', 
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM_ADDRESS'
];

const missingVars = [];
const configVars = {};

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    missingVars.push(varName);
  } else {
    configVars[varName] = varName.includes('PASS') ? '***' : value;
  }
});

if (missingVars.length > 0) {
  console.error('❌ Variables manquantes:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\n⚠️  Les emails ne peuvent pas être envoyés !');
  process.exit(1);
}

console.log('✅ Configuration complète:');
Object.entries(configVars).forEach(([key, value]) => {
  console.log(`   ${key}: ${value}`);
});

// Test de connexion SMTP
const nodemailer = require('nodemailer');

const testConnection = async () => {
  console.log('\n🧪 Test de connexion SMTP...');
  
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.verify();
    console.log('✅ Connexion SMTP réussie !');
    
    // Test envoi email
    const testEmail = await transporter.sendMail({
      from: process.env.EMAIL_FROM_ADDRESS,
      to: process.env.SMTP_USER,
      subject: '🧪 Test Email LE SAGE DEV',
      text: 'Ceci est un email de test depuis votre serveur de production.',
      html: '<h2>🧪 Test Email</h2><p>Ceci est un email de test depuis votre serveur de production.</p>'
    });
    
    console.log('✅ Email de test envoyé !');
    console.log(`   Message ID: ${testEmail.messageId}`);
    
  } catch (error) {
    console.error('❌ Erreur de connexion SMTP:', error.message);
    
    if (error.code === 'EAUTH') {
      console.error('\n🔧 Solutions possibles:');
      console.error('1. Vérifiez SMTP_USER et SMTP_PASS');
      console.error('2. Pour Gmail: utilisez un mot de passe d\'application');
      console.error('3. Activez "Accès moins sécurisé" si nécessaire');
    }
    
    process.exit(1);
  }
};

testConnection();
