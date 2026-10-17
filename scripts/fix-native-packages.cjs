// Runs after `npm install`. @capgo/capacitor-updater's Package.swift declares a
// test target at ios/Tests/CapacitorUpdaterPluginTests, but the npm package
// doesn't include that folder. Xcode then can't load the package and fails with
// "Missing package product 'CapApp-SPM'". Creating the folder with a placeholder
// file fixes it; nothing here is built into the app.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'node_modules', '@capgo', 'capacitor-updater', 'ios', 'Tests', 'CapacitorUpdaterPluginTests');
if (fs.existsSync(path.join(__dirname, '..', 'node_modules', '@capgo', 'capacitor-updater', 'Package.swift'))) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Placeholder.swift');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '// Placeholder so Swift Package Manager can load @capgo/capacitor-updater (see scripts/fix-native-packages.cjs).\n');
  }
}
