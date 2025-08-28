// scripts/generate-vapid.js
const webpush = require('web-push');

function main() {
  const keys = webpush.generateVAPIDKeys();
  console.log('# VAPID KEYS (copy these to your .env or secret store)');
  console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
  console.log('\nExample subject (mailto or URL):');
  console.log('VAPID_SUBJECT=mailto:admin@yourdomain.example');
}

main();
