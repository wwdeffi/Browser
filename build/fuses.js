'use strict';
// afterPack: переключает Electron Fuses в упакованном exe (до подписи и сборки инсталлятора)
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  const ext = context.electronPlatformName === 'win32' ? '.exe' : '';
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}${ext}`);
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  });
};
