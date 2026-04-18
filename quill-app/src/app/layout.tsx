import type { Metadata } from 'next'
import { Cormorant_Garamond, DM_Sans, DM_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import Script from 'next/script'
import './globals.css'
import 'katex/dist/katex.min.css'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400'],
  style: ['normal', 'italic'],
  variable: '--font-serif-fallback',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-sans',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400'],
  variable: '--font-mono',
  display: 'swap',
})

const canela = localFont({
  src: [
    { path: '../../public/fonts/Canela-Regular.otf', weight: '400', style: 'normal' },
  ],
  variable: '--font-canela',
  display: 'swap',
  fallback: ['Cormorant Garamond', 'Georgia', 'serif'],
})

export const metadata: Metadata = {
  title: 'Quill — Your semester, understood.',
  description: 'Quill connects to your courses and knows your entire academic life.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${canela.variable} ${cormorant.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <head />
      <body>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  )
}
