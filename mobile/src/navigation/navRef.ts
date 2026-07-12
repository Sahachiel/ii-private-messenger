import { createNavigationContainerRef } from '@react-navigation/native';

// Ref globale al NavigationContainer: serve a navigare da FUORI dai componenti (es. useSocket
// all'arrivo di una chiamata) verso le schermate Call/VideoCall, altrimenti la chiamata in
// arrivo resta solo nello stato redux e nessuna UI si apre → impossibile rispondere.
export const navigationRef = createNavigationContainerRef();

export function navigate(name: string, params?: object): void {
  if (navigationRef.isReady()) {
    // @ts-expect-error nomi route dinamici
    navigationRef.navigate(name, params);
  }
}
