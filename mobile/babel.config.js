module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@': './src',
          '@screens': './src/screens',
          '@components': './src/components',
          '@services': './src/services',
          '@store': './src/store',
          '@utils': './src/utils',
          '@types': './src/types',
          '@hooks': './src/hooks',
          '@xsec-mtd': './src/xsec-mtd',
        },
      },
    ],
    'react-native-reanimated/plugin',
  ],
};
