export function sharedBadgeText(emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return `μοιράζεται με ${emails[0]}`;
  return `μοιράζεται με ${emails[0]} +${emails.length - 1} ακόμα`;
}
