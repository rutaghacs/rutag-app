const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">13.205.201.82</domain>
  </domain-config>
</network-security-config>
`;

function withAndroidCleartext(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const application = manifest.application && manifest.application[0];

    if (!application) {
      throw new Error('Android manifest is missing application node');
    }

    application.$['android:usesCleartextTraffic'] = 'true';
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';

    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const xmlDir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      const outputPath = path.join(xmlDir, 'network_security_config.xml');

      await fs.promises.mkdir(xmlDir, { recursive: true });
      await fs.promises.writeFile(outputPath, NETWORK_SECURITY_CONFIG, 'utf8');

      return mod;
    },
  ]);

  return config;
}

module.exports = withAndroidCleartext;
