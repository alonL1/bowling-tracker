function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function toLocalDateInputValue(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalTimeInputValue(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function combineLocalDateAndTime(dateValue: string, timeValue: string) {
  const trimmedDate = dateValue.trim();
  const trimmedTime = timeValue.trim();

  if (!trimmedDate && !trimmedTime) {
    return null;
  }

  if (!trimmedDate) {
    throw new Error('Enter a date before saving a time.');
  }

  const normalizedTime = trimmedTime || '00:00';
  const parsed = new Date(`${trimmedDate}T${normalizedTime}`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Enter a valid date and time.');
  }

  return parsed.toISOString();
}
