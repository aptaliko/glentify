import { describe, it, expect } from 'vitest';
import { validateImageFile, MAX_IMAGE_BYTES } from './imageValidation';

describe('validateImageFile', () => {
  it('accepts a png within the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
  });

  it('accepts jpeg and webp', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1 }).ok).toBe(true);
    expect(validateImageFile({ type: 'image/webp', size: 1 }).ok).toBe(true);
  });

  it('rejects an unsupported mime type with a Greek reason', () => {
    const result = validateImageFile({ type: 'image/gif', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('rejects a file over the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 });
    expect(result.ok).toBe(false);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });
});
