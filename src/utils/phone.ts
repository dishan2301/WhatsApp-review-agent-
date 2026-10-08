export function normalizeIndianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
  if (digits.length !== 12 || !digits.startsWith('91') || !/^[6-9]/.test(digits.slice(2))) return null;
  if (/^(\d)\1+$/.test(digits.slice(2))) return null;
  return digits;
}

export function maskPhone(phone: string): string {
  return phone.length < 6 ? '***' : `${phone.slice(0, 2)}******${phone.slice(-4)}`;
}
