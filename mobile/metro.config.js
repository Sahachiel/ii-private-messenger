const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
// unstable_enablePackageExports: necessario per risolvere i subpath ESM di
// @noble/post-quantum (ml-kem.js/ml-dsa.js) e @noble/hashes usati dalla crittografia post-quantum.
const config = {
  resolver: {
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
