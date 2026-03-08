const https = require('https');
const os = require('os');
const config = require('./src/config');
const { ensureCerts } = require('./src/utils/certGenerator');
const app = require('./src/app');

const { key, cert } = ensureCerts(config.certsDir);

const server = https.createServer({ key, cert }, app);

server.listen(config.port, config.host, () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push(info.address);
      }
    }
  }

  console.log(`\nInsta360 Viewer running on:`);
  console.log(`  Local:   https://localhost:${config.port}`);
  addresses.forEach(addr => {
    console.log(`  Network: https://${addr}:${config.port}`);
  });
  console.log(`\nMedia root: ${config.mediaRoot}`);
  console.log(`Open the Network URL on your Meta Quest 3 browser.\n`);
});
