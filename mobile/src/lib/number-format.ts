function trimFormattedNumber(formatted: string) {
  return formatted.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function roundToDecimals(value: number, decimals: number) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatTenths(value: number) {
  return trimFormattedNumber(roundToDecimals(value, 1).toFixed(1));
}

export function formatRoundedHundredths(value: number) {
  return trimFormattedNumber(value.toFixed(2));
}
