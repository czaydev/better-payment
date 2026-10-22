import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'better-payment shop',
  description: 'Example shop built with better-payment, Next.js and Prisma',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bar">
          <Link className="brand" href="/">
            better-payment shop
          </Link>
          <nav>
            <Link href="/cart">Cart</Link>
            <Link href="/admin">Admin</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="note">
          Example app — uses <code>MockProvider</code> by default, so no credentials and no real
          money. <a href="https://github.com/czaydev/better-payment">better-payment</a>
        </footer>
      </body>
    </html>
  );
}
