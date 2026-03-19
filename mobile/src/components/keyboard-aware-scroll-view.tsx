import React, { type ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
} from 'react-native';
import { KeyboardAwareScrollView as NativeKeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  children?: ReactNode;
  extraScrollHeight?: number;
};

const DEFAULT_EXTRA_SCROLL_HEIGHT = Platform.select({
  ios: 48,
  android: 180,
  default: 0,
}) as number;

export default function KeyboardAwareScrollView({
  children,
  keyboardShouldPersistTaps = 'handled',
  extraScrollHeight = DEFAULT_EXTRA_SCROLL_HEIGHT,
  contentContainerStyle,
  ...props
}: KeyboardAwareScrollViewProps) {
  const flattenedContentContainerStyle =
    StyleSheet.flatten(contentContainerStyle) ?? undefined;

  if (Platform.OS === 'web') {
    return (
      <ScrollView
        {...props}
        contentContainerStyle={flattenedContentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
        {children}
      </ScrollView>
    );
  }

  return (
    <NativeKeyboardAwareScrollView
      {...props}
      contentContainerStyle={flattenedContentContainerStyle}
      enableOnAndroid
      extraHeight={extraScrollHeight}
      extraScrollHeight={0}
      keyboardOpeningTime={0}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
      {children}
    </NativeKeyboardAwareScrollView>
  );
}
