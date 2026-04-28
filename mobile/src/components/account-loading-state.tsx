import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const loadingItems = [
  {
    image: require('../../assets/pins/happy_pin.png'),
    message: 'Polishing the pins...',
  },
  {
    image: require('../../assets/pins/idea_pin.png'),
    message: 'Checking the oil pattern...',
  },
  {
    image: require('../../assets/pins/thinking_pin.png'),
    message: 'Finding your lane...',
  },
  {
    image: require('../../assets/pins/happy_pin.png'),
    message: 'Warming up the scorekeeper...',
  },
  {
    image: require('../../assets/pins/thinking_pin.png'),
    message: 'Seeing if the 10-pin is still standing...',
  },
  {
    image: require('../../assets/pins/idea_pin.png'),
    message: 'Getting your PinPoint log ready...',
  },
];

export default function AccountLoadingState() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = loadingItems[activeIndex] ?? loadingItems[0];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % loadingItems.length);
    }, 1300);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Image source={activeItem.image} style={styles.pinImage} resizeMode="contain" />
      <BowlingBallSpinner size={46} />
      <Text style={styles.title}>{activeItem.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    backgroundColor: palette.background,
  },
  pinImage: {
    width: 112,
    height: 112,
    marginBottom: spacing.xs,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    textAlign: 'center',
  },
});
