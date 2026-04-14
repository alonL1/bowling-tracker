import { useRouter, useRootNavigationState, type Href } from 'expo-router';
import React, { useLayoutEffect, useMemo, useRef } from 'react';

type SafeRedirectProps = {
  href: Href;
};

export default function SafeRedirect({ href }: SafeRedirectProps) {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const dispatchedHrefRef = useRef<string | null>(null);
  const hrefKey = useMemo(
    () => (typeof href === 'string' ? href : JSON.stringify(href)),
    [href],
  );

  useLayoutEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }

    if (dispatchedHrefRef.current === hrefKey) {
      return;
    }

    dispatchedHrefRef.current = hrefKey;
    router.replace(href);
  }, [href, hrefKey, rootNavigationState?.key, router]);

  return null;
}
