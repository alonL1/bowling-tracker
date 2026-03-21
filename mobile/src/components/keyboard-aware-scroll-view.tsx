import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
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

type ScrollToOptions = {
  x?: number;
  y?: number;
  animated?: boolean;
};

export type KeyboardAwareScrollHandle = {
  scrollTo?: (options: ScrollToOptions) => void;
  scrollToEnd?: (options?: { animated?: boolean } | boolean) => void;
  getScrollResponder?: () => unknown;
};

const DEFAULT_EXTRA_SCROLL_HEIGHT = Platform.select({
  ios: 48,
  android: 180,
  default: 0,
}) as number;

const KeyboardAwareScrollView = forwardRef<
  KeyboardAwareScrollHandle,
  KeyboardAwareScrollViewProps
>(function KeyboardAwareScrollView(
  {
    children,
    keyboardShouldPersistTaps = 'handled',
    extraScrollHeight = DEFAULT_EXTRA_SCROLL_HEIGHT,
    contentContainerStyle,
    ...props
  },
  ref,
) {
  const webScrollRef = useRef<ScrollView | null>(null);
  const nativeKeyboardAwareRef = useRef<any>(null);
  const flattenedContentContainerStyle =
    StyleSheet.flatten(contentContainerStyle) ?? undefined;
  const usePlainScrollView = Platform.OS !== 'android';

  useImperativeHandle(ref, () => {
    if (usePlainScrollView) {
      return (webScrollRef.current as KeyboardAwareScrollHandle | null) ?? {};
    }

    return {
      scrollTo: (options: ScrollToOptions) => {
        nativeKeyboardAwareRef.current?.scrollToPosition?.(
          options?.x ?? 0,
          options?.y ?? 0,
          options?.animated ?? true,
        );
      },
      scrollToEnd: (options?: { animated?: boolean } | boolean) => {
        const animated =
          typeof options === 'boolean' ? options : options?.animated ?? true;
        nativeKeyboardAwareRef.current?.scrollToEnd?.(animated);
      },
      getScrollResponder: () =>
        nativeKeyboardAwareRef.current?.getScrollResponder?.() ?? null,
    };
  }, []);

  if (usePlainScrollView) {
    return (
      <ScrollView
        {...props}
        ref={webScrollRef}
        contentContainerStyle={flattenedContentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
        {children}
      </ScrollView>
    );
  }

  return (
    <NativeKeyboardAwareScrollView
      {...props}
      ref={nativeKeyboardAwareRef}
      contentContainerStyle={flattenedContentContainerStyle}
      enableOnAndroid
      extraHeight={extraScrollHeight}
      extraScrollHeight={0}
      keyboardOpeningTime={0}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
      {children}
    </NativeKeyboardAwareScrollView>
  );
});

export default KeyboardAwareScrollView;
