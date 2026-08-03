export function apiUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  return `${baseUrl}${path}`;
}
