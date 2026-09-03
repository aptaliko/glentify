// Mirrors the ceilings declared in src/app/api/songs/image-upload/route.ts. Keeping these
// in sync is what makes a server-side upload rejection near-impossible, so the sync handler
// can treat any upload() throw as a transient systemic-error rather than a permanent block.
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT_ATTR = ALLOWED_IMAGE_TYPES.join(',');

export type ImageValidationResult = { ok: true } | { ok: false; reason: string };

export function validateImageFile(file: { type: string; size: number }): ImageValidationResult {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'Μη υποστηριζόμενος τύπος εικόνας. Επιτρέπονται PNG, JPEG ή WebP.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'Η εικόνα ξεπερνά το όριο των 10MB.' };
  }
  return { ok: true };
}
