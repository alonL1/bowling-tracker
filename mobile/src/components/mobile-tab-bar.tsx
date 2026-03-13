import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type TabBarIconRenderer = (props: {
  focused: boolean;
  color: string;
  size: number;
}) => React.ReactNode;

type MobileTabBarItemProps = {
  label: string;
  focused: boolean;
  color: string;
  accessibilityLabel?: string;
  testID?: string;
  icon?: TabBarIconRenderer;
  onPress: () => void;
  onLongPress: () => void;
};

function MobileTabBarItem({
  label,
  focused,
  color,
  accessibilityLabel,
  testID,
  icon,
  onPress,
  onLongPress,
}: MobileTabBarItemProps) {
  const iconOffset = useRef(new Animated.Value(focused ? -4 : 0)).current;
  const labelOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const labelOffset = useRef(new Animated.Value(focused ? -4 : 0)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(iconOffset, {
        toValue: focused ? -4 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(labelOpacity, {
        toValue: focused ? 1 : 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(labelOffset, {
        toValue: focused ? -4 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [focused, iconOffset, labelOpacity, labelOffset]);

  const renderedIcon = useMemo(
    () => icon?.({ focused, color, size: 31 }) ?? null,
    [color, focused, icon],
  );

  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
        <Animated.View style={[styles.iconWrap, { transform: [{ translateY: iconOffset }] }]}>
          {renderedIcon}
        </Animated.View>
      </Pressable>
      <Animated.Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            opacity: labelOpacity,
            transform: [{ translateY: labelOffset }],
          },
        ]}>
        {label}
      </Animated.Text>
    </View>
  );
}

function getLabel(
  routeName: string,
  labelOption: BottomTabBarProps['descriptors'][string]['options']['tabBarLabel'],
  titleOption: string | undefined,
) {
  if (typeof labelOption === 'string') {
    return labelOption;
  }
  if (typeof titleOption === 'string') {
    return titleOption;
  }

  return routeName.charAt(0).toUpperCase() + routeName.slice(1);
}

export default function MobileTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: 10 + insets.bottom }]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const focused = state.index === index;
          const color = focused ? palette.text : palette.navIcon;
          const label = getLabel(route.name, options.tabBarLabel, options.title);
          const icon = options.tabBarIcon as TabBarIconRenderer | undefined;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (focused || event.defaultPrevented) {
              return;
            }

            navigation.dispatch(
              CommonActions.navigate({
                name: route.name,
                params: route.params,
              }),
            );
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <MobileTabBarItem
              key={route.key}
              label={label}
              focused={focused}
              color={color}
              icon={icon}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.nav,
    paddingTop: 8,
    paddingHorizontal: 8,
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
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pressable: {
    width: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.9,
  },
  iconWrap: {
    minHeight: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    minHeight: 18,
    paddingHorizontal: 4,
    color: palette.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
});
