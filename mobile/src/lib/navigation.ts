import type { Href, Router } from 'expo-router';

type BackNavigationLike = {
  canGoBack(): boolean;
  goBack(): void;
  getState(): { index: number } | undefined;
  getParent(): BackNavigationLike | undefined;
};

function canNavigationGoBack(
  navigation?: BackNavigationLike,
): navigation is BackNavigationLike {
  let current: BackNavigationLike | undefined = navigation;

  while (current) {
    const state = current.getState();
    if (current.canGoBack() || (state?.index ?? 0) > 0) {
      return true;
    }
    current = current.getParent();
  }

  return false;
}

export function navigateBackOrFallback(
  router: Router,
  fallbackHref: Href,
  navigation?: BackNavigationLike,
) {
  if (canNavigationGoBack(navigation)) {
    navigation.goBack();
    return;
  }

  router.replace(fallbackHref);
}
