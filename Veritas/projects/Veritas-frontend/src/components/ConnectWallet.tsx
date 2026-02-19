import { useWallet, Wallet, WalletId } from '@txnlab/use-wallet-react'
import Account from './Account'

interface ConnectWalletInterface {
  openModal: boolean
  closeModal: () => void
}

const ConnectWallet = ({ openModal, closeModal }: ConnectWalletInterface) => {
  const { wallets, activeAddress } = useWallet()

  const isKmd = (wallet: Wallet) => wallet.id === WalletId.KMD

  if (!openModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8 max-w-md w-full shadow-2xl shadow-blue-500/20">
        <h3 className="text-2xl font-bold mb-6 text-blue-400">Select Wallet Provider</h3>

        <div className="space-y-3">
          {activeAddress && (
            <div className="mb-6">
              <Account />
              <div className="h-px bg-gray-700 my-4" />
            </div>
          )}

          {!activeAddress &&
            wallets?.map((wallet) => (
              <button
                key={`provider-${wallet.id}`}
                className="w-full flex items-center justify-between p-4 bg-gray-700 hover:bg-gray-600 rounded-xl border border-gray-600 transition-all group"
                onClick={async () => {
                  await wallet.connect()
                  closeModal()
                }}
              >
                <div className="flex items-center gap-4">
                  {!isKmd(wallet) && (
                    <img
                      alt={wallet.id}
                      src={wallet.metadata.icon}
                      className="w-8 h-8 object-contain"
                    />
                  )}
                  <span className="font-semibold text-lg">
                    {isKmd(wallet) ? 'LocalNet Wallet (KMD)' : wallet.metadata.name}
                  </span>
                </div>
                <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:animate-ping" />
              </button>
            ))}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {activeAddress && (
            <button
              className="w-full py-3 bg-red-600 hover:bg-red-700 rounded-xl font-bold transition-all"
              onClick={async () => {
                const activeWallet = wallets?.find((w) => w.isActive)
                if (activeWallet) {
                  await activeWallet.disconnect()
                } else {
                  localStorage.removeItem('@txnlab/use-wallet:v3')
                  window.location.reload()
                }
                closeModal()
              }}
            >
              Logout / Disconnect
            </button>
          )}

          <button
            className="w-full py-3 bg-gray-600 hover:bg-gray-500 rounded-xl font-bold transition-all"
            onClick={closeModal}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConnectWallet
