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
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen min-h-[100dvh]">
        {children}
      </body>
    </html>
  );
}
