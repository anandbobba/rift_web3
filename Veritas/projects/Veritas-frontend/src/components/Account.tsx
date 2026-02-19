import { useWallet } from '@txnlab/use-wallet-react'
import { ellipseAddress } from '../utils/ellipseAddress'

const Account = () => {
  const { activeAddress } = useWallet()

  return (
    <div>
      <a className="text-xl" target="_blank" href={`https://lora.algokit.io/testnet/account/${activeAddress}/`} rel="noreferrer">
        Address: {ellipseAddress(activeAddress)}
      </a>
      <div className="text-xl">Network: testnet</div>
    </div>
  )
}

export default Account
