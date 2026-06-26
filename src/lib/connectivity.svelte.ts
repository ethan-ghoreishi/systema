/**
 * Reactive online/offline state. The field experience never *requires* the
 * network, but a few screens (sync status, capture queue) want to reflect it.
 */

class Connectivity {
  online = $state<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => (this.online = true));
      window.addEventListener('offline', () => (this.online = false));
    }
  }
}

export const connectivity = new Connectivity();
