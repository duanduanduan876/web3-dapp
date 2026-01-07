import './globals.css'
import Providers from './providers'
import '@rainbow-me/rainbowkit/styles.css'

export const metadata = {
  title: 'Web3 DApp',
  description: 'Demo dapp',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}







