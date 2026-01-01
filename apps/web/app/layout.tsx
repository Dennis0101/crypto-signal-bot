import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trading',
  description: 'Security-first trading terminal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

