// Date and Time utility configured specifically for WIB (Waktu Indonesia Barat - Asia/Jakarta UTC+7)

export const TIMEZONE_WIB = 'Asia/Jakarta';

/**
 * Format jam dan menit saat ini atau dari objek Date ke format WIB (misal: "14:30 WIB")
 */
export function formatTimeWIB(dateInput: Date | string | number = new Date()): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  const timeStr = date.toLocaleTimeString('id-ID', {
    timeZone: TIMEZONE_WIB,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${timeStr} WIB`;
}

/**
 * Format tanggal lengkap dalam WIB (misal: "19 Oktober 2026")
 */
export function formatDateWIB(dateInput: Date | string | number = new Date()): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  return date.toLocaleDateString('id-ID', {
    timeZone: TIMEZONE_WIB,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format tanggal dan waktu lengkap dalam WIB (misal: "19 Okt 2026, 14:30 WIB")
 */
export function formatDateTimeWIB(dateInput: Date | string | number = new Date()): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  const datePart = date.toLocaleDateString('id-ID', {
    timeZone: TIMEZONE_WIB,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('id-ID', {
    timeZone: TIMEZONE_WIB,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart}, ${timePart} WIB`;
}
