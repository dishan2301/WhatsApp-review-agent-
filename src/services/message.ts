import type { SheetCustomerRow } from '../google/rows.js';

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildReviewMessage(row: SheetCustomerRow, reviewUrl: string): string {
  const name = clean(row.name) || 'Customer';
  const item = clean(row.product || row.serviceType) || 'recent purchase or service';
  return `Hi ${name} 👋

Thank you for choosing Swastik Mobile & Computers for your ${item}.

We hope you're happy with your experience.

If you have a moment, we'd really appreciate your feedback:
⭐ ${reviewUrl}

Thank you for supporting us!
Swastik Mobile & Computers`;
}

export interface BilingualMessages {
  english: string;
  gujarati: string;
}

export function buildBilingualReviewMessages(row: SheetCustomerRow, reviewUrl: string): BilingualMessages {
  void row;
  return {
    english: `Hello 👋

Thank you for choosing Swastik Mobile & Computers.

We hope you're happy with your experience.

If you have a moment, we'd really appreciate your feedback:
⭐ ${reviewUrl}

Thank you for supporting us!
Swastik Mobile & Computers`,
    gujarati: `નમસ્તે 👋

સ્વસ્તિક મોબાઇલ એન્ડ કમ્પ્યુટર્સ પસંદ કરવા બદલ આભાર.

અમને આશા છે કે તમે અમારા કામ અને સેવાથી ખુશ છો.

જો તમારી પાસે થોડો સમય હોય, તો કૃપા કરીને તમારો પ્રતિસાદ આપશો:
⭐ ${reviewUrl}

તમારા સહકાર બદલ આભાર!
સ્વસ્તિક મોબાઇલ એન્ડ કમ્પ્યુટર્સ`,
  };
}

export function buildBilingualFollowupMessages(row: SheetCustomerRow, reviewUrl: string): BilingualMessages {
  const name = clean(row.name) || 'Customer';
  return {
    english: `Hi ${name} 👋\n\nJust a friendly reminder from Swastik Mobile & Computers. Please share your experience with us—your review helps us serve you better:\n⭐ ${reviewUrl}\n\nThank you for your support!`,
    gujarati: `નમસ્તે ${name} 👋\n\nસ્વસ્તિક મોબાઇલ એન્ડ કમ્પ્યુટર્સ તરફથી મૈત્રીપૂર્ણ યાદ. કૃપા કરીને તમારો અનુભવ અમારી સાથે શેર કરો—તમારો રિવ્યૂ અમને વધુ સારી સેવા આપવામાં મદદ કરે છે:\n⭐ ${reviewUrl}\n\nતમારા સહકાર બદલ આભાર!`,
  };
}
