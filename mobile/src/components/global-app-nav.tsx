import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useRouter, usePathname, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type NavKey = 'sessions' | 'chat' | 'record' | 'friends' | 'account';

type NavItem = {
  key: NavKey;
  label: string;
  href: Href;
  icon: (props: { color: string; size: number }) => React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: 'sessions',
    label: 'Sessions',
    href: '/(tabs)/sessions',
    icon: ({ color, size }) => (
      <MaterialCommunityIcons name="book-open-page-variant" size={size} color={color} />
    ),
  },
  {
    key: 'chat',
    label: 'Chat',
    href: '/(tabs)/chat',
    icon: ({ color, size }) => (
      <Ionicons name="chatbubble-ellipses" size={size} color={color} />
    ),
  },
  {
    key: 'record',
    label: 'Record',
    href: '/(tabs)/record',
    icon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} />,
  },
  {
    key: 'friends',
    label: 'Friends',
    href: '/(tabs)/friends',
    icon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
  },
  {
    key: 'account',
    label: 'Account',
    href: '/(tabs)/account',
    icon: ({ color, size }) => <MaterialIcons name="person" size={size} color={color} />,
  },
];

function shouldShowGlobalNav(pathname: string) {
  return (
    pathname.startsWith('/games/') ||
    pathname.startsWith('/invite/') ||
    pathname === '/uploads-processing' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  );
}

function getActiveKey(pathname: string): NavKey {
  if (pathname.startsWith('/invite/')) {
    return 'friends';
  }

  if (
    pathname === '/uploads-processing' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/delete-account' ||
    pathname === '/delete-data'
  ) {
    return 'account';
  }

  return 'sessions';
}

export default function GlobalAppNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const visible = useMemo(
    () => shouldShowGlobalNav(pathname ?? ''),
    [pathname],
  );

  if (!visible) {
    return null;
  }

  const activeKey = getActiveKey(pathname ?? '');

  return (
    <View
      pointerEvents={keyboardVisible ? 'none' : 'auto'}
      style={[
        styles.container,
        { paddingBottom: 10 + insets.bottom },
        keyboardVisible && styles.containerHidden,
      ]}>
      <View style={styles.row}>
        {NAV_ITEMS.map((item) => {
          const focused = item.key === activeKey;
          const color = focused ? palette.text : palette.navIcon;

          return (
            <View key={item.key} style={styles.item}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={focused ? { selected: true } : {}}
                onPress={() => router.navigate(item.href)}
                style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
                <View style={styles.iconWrap}>{item.icon({ color, size: 31 })}</View>
                <Text style={[styles.label, focused && styles.labelFocused]}>{item.label}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: palette.nav,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  containerHidden: {
    opacity: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
  },
  item: {
    flex: 1,
    minWidth: 0,
  },
  pressable: {
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 2,
  },
  pressed: {
    opacity: 0.9,
  },
  iconWrap: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: palette.navIcon,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  labelFocused: {
    color: palette.text,
  },
});
