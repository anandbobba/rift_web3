import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/App.css'
import { WalletProvider, WalletManager, WalletId } from '@txnlab/use-wallet-react'

const walletManager = new WalletManager({
  wallets: [
    { id: WalletId.KMD }, // LocalNet wallet
  ],
  networks: {
    localnet: {
      algod: {
        baseServer: 'http://localhost',
        port: '4001',
        token: 'a'.repeat(64),
      },
    },
  },
  defaultNetwork: 'localnet',
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
