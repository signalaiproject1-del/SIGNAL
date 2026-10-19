import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SIGNAL | Political risk research', description: 'A research workspace for understanding UK political risk.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
