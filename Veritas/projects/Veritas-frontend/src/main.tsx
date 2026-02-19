import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/App.css'
import { WalletProvider, WalletManager, WalletId } from '@txnlab/use-wallet-react'

// Purge any stale LocalNet session persisted in localStorage from a prior run.
// use-wallet v4 stores state under "@txnlab/use-wallet:v4"; if activeNetwork is
// "localnet" (or any network not in our config) the WalletManager constructor
// throws before React even mounts.
try {
  const UW_KEY = '@txnlab/use-wallet:v4'
  const raw = localStorage.getItem(UW_KEY)
  if (raw) {
    const saved = JSON.parse(raw) as { activeNetwork?: string }
    if (saved?.activeNetwork && !['testnet', 'mainnet', 'betanet', 'fnet'].includes(saved.activeNetwork)) {
      localStorage.removeItem(UW_KEY)
    }
  }
} catch { /* ignore parse errors */ }

const walletManager = new WalletManager({
  wallets: [
    { id: WalletId.PERA }, // Pera Wallet — Testnet
  ],
  networks: {
    testnet: {
      algod: {
        baseServer: 'https://testnet-api.algonode.cloud',
        port: '',
        token: '',
      },
    },
  },
  defaultNetwork: 'testnet',
})

const Root = () => {
  return (
    <React.StrictMode>
      <WalletProvider manager={walletManager}>
        <App />
      </WalletProvider>
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)

