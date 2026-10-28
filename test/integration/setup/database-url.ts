/** The same server and credentials as `base`, pointed at another database. */
export function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export const TEMPLATE_ENV = "PARCELA_TEST_TEMPLATE_DB";
export const ADMIN_URL_ENV = "PARCELA_TEST_ADMIN_URL";
