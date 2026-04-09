import { Redirect, useRootNavigationState, type Href } from 'expo-router';
import React from 'react';

type SafeRedirectProps = {
  href: Href;
};

export default function SafeRedirect({ href }: SafeRedirectProps) {
  const rootNavigationState = useRootNavigationState();

  if (!rootNavigationState?.key) {
    return null;
  }

  return <Redirect href={href} />;
}
