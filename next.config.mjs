/** @type {import('next').NextConfig} */
const nextConfig = {
  /* better-sqlite3 is a native module. Next must be told to leave it alone
   * rather than trying to bundle it — a compiled .node binary cannot be
   * traced and inlined like JavaScript, and bundling it fails at runtime with
   * an error that points nowhere near the real cause. */
  serverExternalPackages: ['better-sqlite3', 'bcryptjs'],
};

export default nextConfig;
