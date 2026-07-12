// gesture-handler DEVE essere importato per primo (richiesto da @react-navigation/stack),
// altrimenti in release si rischiano crash/instabilita di navigazione.
import 'react-native-gesture-handler';
// PRNG polyfill — install globalThis.crypto.getRandomValues BEFORE tweetnacl loads.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;

// tweetnacl's auto-init looks for `self.crypto.getRandomValues`. On Hermes `self` is
// undefined, so it falls through to require('crypto') (not a Metro module) and ends up
// with no PRNG — every call to nacl.randomBytes throws "no PRNG". We install the PRNG
// explicitly using the polyfill we just loaded.
import nacl from 'tweetnacl';
if (!nacl.__prngInstalled) {
  nacl.setPRNG((x, n) => {
    const v = new Uint8Array(n);
    global.crypto.getRandomValues(v);
    for (let i = 0; i < n; i++) x[i] = v[i];
  });
  nacl.__prngInstalled = true;
}

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
