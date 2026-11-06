// Spots contact details in swap notes and chat messages (routes/swaps.ts), so
// nobody has to post an email or phone number to strangers. Kept in step with
// findContactDetails() in public/js/lib/pure.js, which warns before sending.
//
// Deliberately loose: a false alarm costs one "Send anyway" tap, a miss puts a
// personal email in front of someone you have never swapped with.

export type ContactKind = 'email' | 'phone' | 'link' | 'messenger';

const EMAIL = /[\w.+-]+\s*(?:@|\(at\)|\[at\])\s*[\w-]+(?:\s*(?:\.|\(dot\)|\[dot\])\s*[\w-]+)*\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i;
// 8+ digits joined only by spaces, dots, dashes or brackets. Set numbers
// ("75258-1") are removed first so a list of sets is not a "phone number".
const PHONE = /(?:\+\s*)?\d(?:[\s().-]{0,2}\d){7,}/;
const SET_NUM = /\b\d{3,7}-\d{1,2}\b/g;
const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|gg|ru|ua|de|fr|uk|co)\b(?:\/|\s|$)/i;
const MESSENGER = /(?<![\p{L}\d])(?:t\.me|wa\.me|telegram|whats\s?app|viber|signal\s+(?:me|app)|discord|instagram|insta|facebook|snapchat|wechat|skype|телеграм\p{L}*|телеґрам\p{L}*|вайбер\p{L}*|ватсап\p{L}*|вотсап\p{L}*|вацап\p{L}*)(?![\p{L}\d])/iu;

/** Kinds of contact details found in a piece of text, empty when it looks clean. */
export function findContactDetails(text: string | null | undefined): ContactKind[] {
  const s = String(text || '');
  if (!s.trim()) return [];
  const found: ContactKind[] = [];
  if (EMAIL.test(s)) found.push('email');
  if (PHONE.test(s.replace(SET_NUM, ' '))) found.push('phone');
  if (LINK.test(s.replace(new RegExp(EMAIL.source, 'gi'), ' '))) found.push('link');
  if (MESSENGER.test(s)) found.push('messenger');
  return found;
}
