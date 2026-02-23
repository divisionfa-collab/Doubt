import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doubt - لعبة الشك',
  description: 'لعبة الخداع والتحقيق الجماعية',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
