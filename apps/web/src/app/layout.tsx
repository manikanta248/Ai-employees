import type { ReactNode } from 'react';

// The <html> element lives in [locale]/layout.tsx so it can carry the right lang attribute.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
