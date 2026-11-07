import type { Metadata } from 'next';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIEdu',
  description: 'AIEdu school management for owners, principals, office staff and accountants',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
