import type { Href, Router } from 'expo-router';

export function navigateBackOrFallback(router: Router, fallbackHref: Href) {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackHref);
}
