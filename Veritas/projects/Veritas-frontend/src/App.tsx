import React, { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import ConnectWallet from './components/ConnectWallet'
import algosdk from 'algosdk'

const API     = 'http://localhost:8000'
const APP_ID  = 755787017     // Veritas VeritasRegistry on Testnet
const OWNER   = '64L2PTSAKYUHGR2V63UVIGTYWUKSCQ4HMP7DE35ZKGIG2PJ3XQG7LMCPTY'

type StatusType = 'idle' | 'loading' | 'original' | 'plagiarism' | 'clear' | 'registered' | 'error'
type Tab = 'registry' | 'forensic' | 'architecture'

interface StatusState {
  type: StatusType
  message: string
}

interface ForensicData {
  phash_hex: string
  phash_binary: string
  median_frequency: number
  bitmask_8x8: number[]
  dct_heatmap: number[]
  gray_32x32_b64: string      // denoised — what the algorithm actually hashes
  gray_original_b64: string  // raw — before median blur, for comparison
}

// Pipeline step descriptions shown in the forensic panel
const PIPELINE_STEPS = [
  {
    num: '01',
    title: 'Adversarial Noise Defense',
    color: 'text-blue-400',
    desc: 'A 3×3 Median Blur strips imperceptible high-frequency adversarial perturbations before any hashing begins. Invisible digital noise that tries to alter the hash without changing the visible artwork is eliminated here.',
  },
  {
    num: '02',
    title: 'Grayscale + 32×32 Resize',
    color: 'text-slate-300',
    desc: 'Convert to grayscale and resize to 32×32. This removes colour noise and compression artefacts, leaving only structural luminance data — the raw "skeleton" of the artwork.',
  },
  {
    num: '03',
    title: 'Discrete Cosine Transform',
    color: 'text-amber-400',
    desc: '2D DCT converts 1024 pixel values into 1024 frequency coefficients. Low-frequency coefficients (top-left) capture large structural shapes; high-frequency ones encode fine detail and noise — which we discard.',
  },
  {
    num: '04',
    title: 'Low-Pass Filter (8×8)',
    color: 'text-orange-400',
    desc: 'Keep only the top-left 8×8 block — 64 coefficients representing the lowest frequencies. Cropping, colour grading, JPEG compression, and minor edits all live in the HIGH frequencies, which are thrown away here.',
  },
  {
    num: '05',
    title: 'Median Threshold → 64-bit Hash',
    color: 'text-emerald-400',
    desc: 'Compute the median of the 64 DCT coefficients. Each bit = 1 if above median, 0 if below. The result is a 64-bit structural fingerprint invariant to resizing, colour changes, and compression.',
  },
  {
    num: '06',
    title: '8-Way Symmetry Invariance',
    color: 'text-violet-400',
    desc: 'During verification, all 8 orientations of the suspect image are tested: original + 3 rotations (90°/180°/270°) + their 4 mirrored counterparts. No rotation or flip can bypass the registry.',
  },
]

export default function App() {
  const { activeAddress, transactionSigner, algodClient } = useWallet()
  const [activeTab, setActiveTab] = useState<Tab>('registry')

  // --- Registry tab state ---
  const [registerFile, setRegisterFile] = useState<File | null>(null)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [registerStatus, setRegisterStatus] = useState<StatusState>({ type: 'idle', message: '' })
  const [verifyStatus, setVerifyStatus] = useState<StatusState>({ type: 'idle', message: '' })
  const [verifyDetectionMethod, setVerifyDetectionMethod] = useState<string | null>(null)
  const [registryCount, setRegistryCount] = useState<number>(0)
  const [openWalletModal, setOpenWalletModal] = useState(false)

  // --- Forensic tab state ---
  const [forensicFile, setForensicFile] = useState<File | null>(null)
  const [forensicData, setForensicData] = useState<ForensicData | null>(null)
  const [forensicLoading, setForensicLoading] = useState(false)
  const [forensicError, setForensicError] = useState<string | null>(null)

  const fetchRegistryCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/registry`)
      const data = await res.json()
      setRegistryCount(data.count)
    } catch {
      // backend offline
    }
  }, [])

  useEffect(() => {
    fetchRegistryCount()
  }, [fetchRegistryCount])

  // ── Registry actions ──────────────────────────────────────────────────────

  const registerArtwork = async () => {
    if (!activeAddress) return alert('Please connect your Pera Wallet first.')
    if (!registerFile) return alert('Please select an image to register.')
    setRegisterStatus({ type: 'loading', message: 'Step 1/3 — Computing 64-bit pHash via forensic pipeline...' })

    try {
      // ── Step 1: Compute pHash on backend (Median Blur → DCT → Bitmask) ─────
      const formData = new FormData()
      formData.append('file', registerFile)
      const hashRes = await fetch(`${API}/compute-hash`, { method: 'POST', body: formData })
      const hashData = await hashRes.json()
      if (hashData.error) throw new Error(`Hash error: ${hashData.error}`)
      const phash: string = hashData.phash

      setRegisterStatus({ type: 'loading', message: `Step 2/3 — pHash computed: ${phash}. Building on-chain transaction...` })

      // ── Step 2: Build ABI call to register_work(phash) ───────────────────
      // ARC4 ABI method selector for register_work(string)void
      const METHOD_SELECTOR = algosdk.ABIMethod.fromSignature('register_work(string)void')

      const sp = await algodClient.getTransactionParams().do()

      // Box reference: algopy BoxMap uses field name as prefix → "registered_hashes" + phash bytes
      const boxKey = new TextEncoder().encode('registered_hashes' + phash)

      // ── MBR payment: fund the app account to cover box storage cost ──────
      // Box MBR = 2500 + 400 * (key_len + value_len), base account MBR = 100_000 microALGO
      const appAddress = algosdk.getApplicationAddress(APP_ID)
      const appInfo = await algodClient.accountInformation(appAddress).do()
      const appBalance = Number(appInfo['amount'] ?? 0)
      const boxMbr = 2500 + 400 * (boxKey.length + 32)   // 32 bytes for Account value
      const baseAccountMbr = 100_000
      const mbrNeeded = Math.max(0, baseAccountMbr + boxMbr - appBalance)

      const atc = new algosdk.AtomicTransactionComposer()

      // Include payment to app account if MBR not yet covered
      if (mbrNeeded > 0) {
        const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: activeAddress,
          receiver: appAddress,
          amount: mbrNeeded,
          suggestedParams: { ...sp, fee: 1000, flatFee: true },
        })
        atc.addTransaction({ txn: payTxn, signer: transactionSigner })
      }

      atc.addMethodCall({
        appID: APP_ID,
        method: METHOD_SELECTOR,
        methodArgs: [phash],
        sender: activeAddress,
        signer: transactionSigner,
        suggestedParams: { ...sp, fee: 2000, flatFee: true },
        boxes: [{ appIndex: APP_ID, name: boxKey }],
      })

      setRegisterStatus({ type: 'loading', message: 'Step 3/3 — Please approve the transaction in Pera Wallet...' })

      // ── Step 3: Sign via Pera Wallet and submit to Testnet ───────────────
      const result = await atc.execute(algodClient, 4)
      const txId = result.txIDs[0]

      setRegisterStatus({
        type: 'registered',
        message: `Registered on Algorand Testnet. pHash: ${phash} | TxID: ${txId.slice(0, 12)}... | App #${APP_ID}`,
      })
      fetchRegistryCount()

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('already')) {
        setRegisterStatus({ type: 'error', message: `Already registered on-chain. This pHash already exists in App #${APP_ID}.` })
      } else {
        setRegisterStatus({ type: 'error', message: msg })
      }
    }
  }

  const verifyArtwork = async () => {
    if (!verifyFile) return alert('Please select a suspect image to verify.')
    setVerifyStatus({ type: 'loading', message: 'Running 8-way symmetry scan across all orientations...' })
    setVerifyDetectionMethod(null)

    const formData = new FormData()
    formData.append('file', verifyFile)

    try {
      const res = await fetch(`${API}/verify`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      if (data.status === 'No Registry') {
        setVerifyStatus({ type: 'error', message: 'No artworks registered yet. Register an original first.' })
      } else if (data.status === 'Original') {
        setVerifyStatus({ type: 'original', message: `ORIGINAL VERIFIED — Pixel-perfect match. This is the exact registered artwork. Owner: ${data.owner?.slice(0, 8)}...` })
        setVerifyDetectionMethod(data.detection_method ?? null)
      } else if (data.status === 'Plagiarism Detected') {
        setVerifyStatus({ type: 'plagiarism', message: `PLAGIARISM DETECTED — Hamming Distance: ${data.score}. Matched: ${data.matched_hash?.slice(0, 8)}... — Likely an edited/rotated/compressed copy.` })
        setVerifyDetectionMethod(data.detection_method ?? null)
      } else {
        setVerifyStatus({ type: 'clear', message: `CLEAR — No visual match found across all 8 orientations (closest: ${data.score}). This appears to be an original new artwork.` })
        setVerifyDetectionMethod(data.detection_method ?? null)
      }
    } catch {
      setVerifyStatus({ type: 'error', message: 'Backend offline. Run: python main.py in the api/ folder.' })
    }
  }

  // ── Forensic action ───────────────────────────────────────────────────────

  const runForensicAnalysis = async () => {
    if (!forensicFile) return alert('Please select an image to analyse.')
    setForensicLoading(true)
    setForensicError(null)
    setForensicData(null)

    const formData = new FormData()
    formData.append('file', forensicFile)

    try {
      const res = await fetch(`${API}/analyze`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setForensicData(data as ForensicData)
    } catch (e: unknown) {
      setForensicError(e instanceof Error ? e.message : 'Backend offline. Run: python main.py')
    } finally {
      setForensicLoading(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const statusColors: Record<StatusType, string> = {
    idle: '',
    loading: 'bg-gray-700 border-gray-500 text-gray-300 animate-pulse',
    registered: 'bg-green-900/60 border-green-500 text-green-100',
    original: 'bg-blue-900/60 border-blue-400 text-blue-100',
    plagiarism: 'bg-red-900/70 border-red-500 text-red-100',
    clear: 'bg-emerald-900/60 border-emerald-400 text-emerald-100',
    error: 'bg-yellow-900/60 border-yellow-500 text-yellow-100',
  }

  // Interpolate a normalised value (0-255) to a blue→yellow heatmap colour
  const dctColor = (v: number) => {
    const r = Math.round((v / 255) * 255)
    const g = Math.round((v / 255) * 180)
    const b = Math.round(255 - (v / 255) * 255)
    return `rgb(${r},${g},${b})`
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden" style={{ backgroundColor: 'hsl(222 20% 4%)' }}>
      {/* Ambient glow lights */}
      <div className="ambient-glow w-[600px] h-[600px] -top-40 -left-40 animate-glow-pulse" />
      <div className="ambient-glow w-[500px] h-[500px] top-1/3 -right-32 animate-glow-pulse" style={{ animationDelay: '2s' }} />
      <div className="ambient-glow w-[400px] h-[400px] -bottom-20 left-1/3 animate-glow-pulse" style={{ animationDelay: '1s' }} />

      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl" style={{ borderBottom: '1px solid hsl(220 15% 13% / 0.5)', backgroundColor: 'hsl(222 20% 4% / 0.85)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'hsl(217 91% 60% / 0.15)', border: '1px solid hsl(217 91% 60% / 0.25)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight font-heading" style={{ color: 'hsl(0 0% 95%)' }}>
                VERITAS <span className="font-light text-sm" style={{ color: 'hsl(217 91% 60%)' }}>Protocol</span>
              </div>
              <p className="text-xs -mt-0.5" style={{ color: 'hsl(215 12% 50%)' }}>Decentralized Copyright Registry on Algorand</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs px-3 py-1 rounded-full" style={{ color: 'hsl(215 12% 50%)', backgroundColor: 'hsl(220 16% 10%)', border: '1px solid hsl(220 15% 14%)' }}>
              Registry: <strong style={{ color: 'hsl(0 0% 95%)' }}>{registryCount}</strong> work{registryCount !== 1 ? 's' : ''}
            </span>
            <button onClick={() => setOpenWalletModal(true)} className="btn-outline-glow text-sm">
              {activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </nav>

      <ConnectWallet openModal={openWalletModal} closeModal={() => setOpenWalletModal(false)} />

      {/* ── Tab Bar ── */}
      <div className="max-w-5xl mx-auto px-6 pt-20 flex gap-1 pb-0 relative z-10" style={{ borderBottom: '1px solid hsl(220 15% 13%)' }}>
        <button
          onClick={() => setActiveTab('registry')}
          className="px-5 py-2.5 rounded-t-lg text-sm font-semibold border-b-2 transition-all duration-200"
          style={activeTab === 'registry'
            ? { borderColor: 'hsl(217 91% 60%)', color: 'hsl(217 91% 60%)', backgroundColor: 'hsl(222 18% 7%)' }
            : { borderColor: 'transparent', color: 'hsl(215 12% 50%)' }}
        >
          Register & Verify
        </button>
        <button
          onClick={() => setActiveTab('forensic')}
          className="px-5 py-2.5 rounded-t-lg text-sm font-semibold border-b-2 transition-all duration-200"
          style={activeTab === 'forensic'
            ? { borderColor: 'hsl(271 81% 65%)', color: 'hsl(271 81% 75%)', backgroundColor: 'hsl(0 0% 7%)' }
            : { borderColor: 'transparent', color: 'hsl(0 0% 55%)' }}
        >
          Forensic Visualizer
        </button>
        <button
          onClick={() => setActiveTab('architecture')}
          className="px-5 py-2.5 rounded-t-lg text-sm font-semibold border-b-2 transition-all duration-200"
          style={activeTab === 'architecture'
            ? { borderColor: 'hsl(160 60% 45%)', color: 'hsl(160 60% 55%)', backgroundColor: 'hsl(0 0% 7%)' }
            : { borderColor: 'transparent', color: 'hsl(215 12% 50%)' }}
        >
          Architecture
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — Registry
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'registry' && (
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 relative z-10" style={{ animation: 'fade-in-up 0.5s ease-out' }}>
          {/* How it works */}
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            {[
              { step: '1', title: 'Artist Registers', desc: 'Upload your original artwork. A 64-bit pHash visual fingerprint is generated and stored on Algorand.' },
              { step: '2', title: 'Suspect Image Uploaded', desc: 'Anyone can upload a suspect image to check if it visually matches a registered original.' },
              { step: '3', title: '8-Way Symmetry Scan', desc: 'All 8 orientations tested (4 rotations × 2 mirror states). Hamming Distance ≤ 10 across any orientation = plagiarism detected.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="glass-card glow-border p-4">
                <div className="step-badge mx-auto mb-2" style={{ backgroundColor: 'hsl(217 91% 60% / 0.12)' }}><span className="text-blue-400">{step}</span></div>
                <div className="font-bold text-xs uppercase tracking-widest mb-1 font-heading" style={{ color: 'hsl(217 91% 60%)' }}>Step {step}</div>
                <div className="font-semibold mb-1" style={{ color: 'hsl(0 0% 95%)' }}>{title}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'hsl(215 12% 50%)' }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* Two-panel layout */}
          <div className="grid grid-cols-2 gap-6">
            {/* Panel 1: Register */}
            <div className="glass-card glow-border p-6 flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'hsl(217 91% 60%)', color: '#fff' }}>STEP 1</span>
                  <h2 className="text-lg font-bold font-heading" style={{ color: 'hsl(0 0% 95%)' }}>Register Original Artwork</h2>
                </div>
                <p className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>Upload YOUR original artwork to claim ownership. Stores the visual fingerprint on-chain.</p>
              </div>
              <label
                className="flex flex-col items-center justify-center h-36 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-300"
                style={registerFile
                  ? { borderColor: 'hsl(217 91% 60%)', backgroundColor: 'hsl(217 91% 60% / 0.05)' }
                  : { borderColor: 'hsl(220 15% 16%)' }}
              >
                <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && setRegisterFile(e.target.files[0])} />
                {registerFile ? (
                  <>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-sm font-medium" style={{ color: 'hsl(217 91% 60%)' }}>Image Ready</span>
                    <span className="text-xs mt-1 font-mono" style={{ color: 'hsl(0 0% 55%)' }}>{registerFile.name}</span>
                  </>
                ) : (
                  <>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2" style={{ color: 'hsl(0 0% 55%)' }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>Click to upload artwork</span>
                  </>
                )}
              </label>
              {registerStatus.type === 'loading' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="status-dot status-dot-pending" />
                  <span className="text-yellow-400 font-mono text-xs">{registerStatus.message}</span>
                </div>
              )}
              {registerStatus.type === 'registered' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="status-dot status-dot-success" />
                  <span className="text-emerald-400 font-mono text-xs">{registerStatus.message}</span>
                </div>
              )}
              {(registerStatus.type === 'error') && (
                <div className="p-3 rounded-xl border text-xs font-mono leading-relaxed" style={{ backgroundColor: 'hsl(45 93% 47% / 0.08)', borderColor: 'hsl(45 93% 47% / 0.4)', color: 'hsl(45 93% 75%)' }}>
                  {registerStatus.message}
                </div>
              )}
              <button onClick={registerArtwork} className="btn-primary-glow w-full text-sm">
                Register on Algorand
              </button>
            </div>

            {/* Panel 2: Verify */}
            <div className="glass-card glow-border p-6 flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'hsl(271 81% 56%)', color: '#fff' }}>STEP 2</span>
                  <h2 className="text-lg font-bold" style={{ color: 'hsl(0 0% 95%)' }}>Verify Suspect Artwork</h2>
                </div>
                <p className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>Upload a SUSPECT image to check if it's a plagiarised copy of any registered original.</p>
              </div>
              <label
                className="flex flex-col items-center justify-center h-36 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-300"
                style={verifyFile
                  ? { borderColor: 'hsl(271 81% 56%)', backgroundColor: 'hsl(271 81% 56% / 0.05)' }
                  : { borderColor: 'hsl(0 0% 16%)' }}
              >
                <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && setVerifyFile(e.target.files[0])} />
                {verifyFile ? (
                  <>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(271, 81%, 65%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-sm font-medium" style={{ color: 'hsl(271 81% 75%)' }}>Image Ready</span>
                    <span className="text-xs mt-1 font-mono" style={{ color: 'hsl(0 0% 55%)' }}>{verifyFile.name}</span>
                  </>
                ) : (
                  <>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2" style={{ color: 'hsl(0 0% 55%)' }}>
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <span className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>Click to upload suspect image</span>
                  </>
                )}
              </label>
              {verifyStatus.type === 'loading' && (
                <div className="flex items-center gap-2">
                  <span className="status-dot status-dot-pending" />
                  <span className="text-yellow-400 font-mono text-xs">{verifyStatus.message}</span>
                </div>
              )}
              {verifyStatus.type === 'original' && (
                <div className="p-3 rounded-xl border text-xs font-mono" style={{ backgroundColor: 'hsl(217 91% 40% / 0.1)', borderColor: 'hsl(217 91% 60% / 0.4)', color: 'hsl(217 91% 80%)' }}>
                  {verifyStatus.message}
                </div>
              )}
              {verifyStatus.type === 'plagiarism' && (
                <div className="p-3 rounded-xl border text-xs font-mono" style={{ backgroundColor: 'hsl(0 85% 55% / 0.1)', borderColor: 'hsl(0 85% 55% / 0.5)', color: 'hsl(0 85% 80%)' }}>
                  {verifyStatus.message}
                </div>
              )}
              {verifyStatus.type === 'clear' && (
                <div className="p-3 rounded-xl border text-xs font-mono" style={{ backgroundColor: 'hsl(160 60% 30% / 0.15)', borderColor: 'hsl(160 60% 45% / 0.4)', color: 'hsl(160 60% 75%)' }}>
                  {verifyStatus.message}
                </div>
              )}
              {verifyStatus.type === 'error' && (
                <div className="p-3 rounded-xl border text-xs font-mono" style={{ backgroundColor: 'hsl(45 93% 47% / 0.08)', borderColor: 'hsl(45 93% 47% / 0.4)', color: 'hsl(45 93% 75%)' }}>
                  {verifyStatus.message}
                </div>
              )}
              {verifyDetectionMethod && verifyStatus.type !== 'idle' && verifyStatus.type !== 'loading' && (
                <div className="p-3 rounded-xl text-xs space-y-2" style={{ backgroundColor: 'hsl(0 0% 12%)', border: '1px solid hsl(271 81% 56% / 0.3)' }}>
                  <div className="font-bold uppercase tracking-widest mb-1 font-heading" style={{ color: 'hsl(271 81% 75%)' }}>Forensic Transparency Report</div>
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0" style={{ color: 'hsl(0 0% 55%)' }}>Detection:</span>
                    <span className="font-mono text-yellow-300">{verifyDetectionMethod}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0" style={{ color: 'hsl(0 0% 55%)' }}>On-chain:</span>
                    <span className="font-mono" style={{ color: 'hsl(217 91% 70%)' }}>Algorand App ID #{APP_ID} (Testnet)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0" style={{ color: 'hsl(0 0% 55%)' }}>Pipeline:</span>
                    <span className="font-mono" style={{ color: 'hsl(0 0% 80%)' }}>Median Blur → pHash DCT → 8-Way Symmetry</span>
                  </div>
                </div>
              )}
              <button onClick={verifyArtwork} className="btn-primary-glow w-full text-sm mt-auto" style={{ backgroundColor: 'hsl(271 81% 56%)', boxShadow: '0 0 20px hsl(271 81% 56% / 0.3)' }}>
                Scan for Matches
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — Forensic Visualizer
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'forensic' && (
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8 relative z-10" style={{ animation: 'fade-in-up 0.5s ease-out' }}>

          {/* Intro */}
          <div className="glass-card glow-border p-6">
            <h2 className="text-xl font-bold mb-2 font-heading" style={{ color: 'hsl(271 81% 80%)' }}>Multi-Layered Forensic Pipeline</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'hsl(0 0% 55%)' }}>
              Veritas is <strong className="text-white">not a hash-checker</strong> — it is a resilient computer-vision protocol with zero blind spots.
              Upload any image to see every step: adversarial noise is stripped with a{' '}
              <span className="text-red-400">Median Blur</span>, the structural skeleton is extracted via a{' '}
              <span className="text-yellow-300">DCT low-pass filter</span>, and all{' '}
              <span className="text-pink-400">8 rotation/mirror variants</span> of the suspect image are tested.
              All results cross-reference <span className="text-blue-400">Algorand App #{APP_ID}</span> to prove timestamped on-chain ownership.
            </p>
          </div>

          {/* Pipeline Steps Reference */}
          <div className="grid grid-cols-2 gap-4">
            {PIPELINE_STEPS.map((s) => (
              <div key={s.num} className="glass-card p-4 flex gap-3">
                <div className="step-badge shrink-0" style={{ backgroundColor: 'hsl(220 16% 12%)' }}><span className={s.color}>{s.num}</span></div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-mono text-xs font-bold ${s.color}`}>STEP {s.num}</span>
                    <span className="text-sm font-semibold">{s.title}</span>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Upload + Analyse */}
          <div className="glass-card glow-border p-6 space-y-4">
            <h3 className="font-bold text-lg" style={{ color: 'hsl(0 0% 95%)' }}>Upload Image to Analyse</h3>
            <div className="flex gap-4 items-end">
              <label
                className="flex-1 flex flex-col items-center justify-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-300"
                style={forensicFile
                  ? { borderColor: 'hsl(271 81% 56%)', backgroundColor: 'hsl(271 81% 56% / 0.05)' }
                  : { borderColor: 'hsl(0 0% 16%)' }}
              >
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files) {
                      setForensicFile(e.target.files[0])
                      setForensicData(null)
                      setForensicError(null)
                    }
                  }}
                />
                {forensicFile ? (
                  <>
                    <span className="text-sm font-medium" style={{ color: 'hsl(271 81% 75%)' }}>{forensicFile.name}</span>
                  </>
                ) : (
                  <span className="text-sm" style={{ color: 'hsl(0 0% 55%)' }}>Click to upload image</span>
                )}
              </label>
              <button
                onClick={runForensicAnalysis}
                disabled={forensicLoading || !forensicFile}
                className="btn-primary-glow text-sm"
                style={{ backgroundColor: 'hsl(271 81% 56%)', boxShadow: '0 0 20px hsl(271 81% 56% / 0.3)' }}
              >
                {forensicLoading ? 'Analysing...' : 'Run Analysis'}
              </button>
            </div>
            {forensicError && (
              <div className="p-3 rounded-xl border text-sm font-mono" style={{ backgroundColor: 'hsl(45 93% 47% / 0.08)', borderColor: 'hsl(45 93% 47% / 0.4)', color: 'hsl(45 93% 75%)' }}>
                {forensicError}
              </div>
            )}
          </div>

          {/* Results */}
          {forensicData && (
            <div className="space-y-6">

              {/* Row 1: Grayscale image + DCT heatmap */}
              <div className="grid grid-cols-2 gap-6">

                {/* Steps 01-02 result — Raw vs Denoised grayscale */}
                <div className="glass-card p-5 space-y-3" style={{ border: '1px solid hsl(187 67% 40% / 0.4)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold" style={{ color: 'hsl(187 67% 60%)' }}>STEPS 01–02 OUTPUT</span>
                    <span className="text-sm font-semibold">Noise Defense + Grayscale</span>
                  </div>
                  <p className="text-gray-400 text-xs">
                    <span className="text-gray-300">Left:</span> raw grayscale (before denoising).{' '}
                    <span className="text-cyan-300">Right:</span> after 3×3 Median Blur — adversarial perturbations stripped.
                    The algorithm only ever hashes the <span className="text-cyan-300">right image</span>.
                  </p>
                  <div className="flex justify-center items-center gap-4">
                    <div className="text-center space-y-1">
                      <img
                        src={`data:image/png;base64,${forensicData.gray_original_b64}`}
                        alt="raw grayscale"
                        className="rounded border border-gray-600 bg-black"
                        style={{ width: '72px', height: '72px', imageRendering: 'pixelated' }}
                      />
                      <p className="text-xs text-gray-500">Raw Input</p>
                    </div>
                    <div className="text-gray-600 text-xl font-light">→</div>
                    <div className="text-center space-y-1">
                      <img
                        src={`data:image/png;base64,${forensicData.gray_32x32_b64}`}
                        alt="denoised grayscale"
                        className="rounded border border-cyan-700 bg-black"
                        style={{ width: '72px', height: '72px', imageRendering: 'pixelated' }}
                      />
                      <p className="text-xs text-cyan-400">After Denoising</p>
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-500">Pixelated rendering — each of the 32×32 pixels is visible</p>
                </div>

                {/* Step 3 result — DCT low-freq heatmap 8×8 */}
                <div className="glass-card p-5 space-y-3" style={{ border: '1px solid hsl(45 93% 47% / 0.4)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold" style={{ color: 'hsl(45 93% 60%)' }}>STEP 02–03 OUTPUT</span>
                    <span className="text-sm font-semibold">DCT Low-Frequency Heatmap</span>
                  </div>
                  <p className="text-gray-400 text-xs">The 8×8 lowest-frequency DCT coefficients. Yellow = high energy (dominant structure), blue = low energy. Noise lives outside this grid.</p>
                  <div className="flex justify-center">
                    <div
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px', width: '160px', height: '160px' }}
                    >
                      {forensicData.dct_heatmap.map((v, i) => (
                        <div
                          key={i}
                          title={`[${Math.floor(i / 8)},${i % 8}] = ${v.toFixed(1)}`}
                          style={{
                            backgroundColor: dctColor(v),
                            borderRadius: '2px',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-500">8×8 coefficient grid. Hover for exact value.</p>
                </div>
              </div>

              {/* Row 2: Bitmask 8×8 + Binary string */}
              <div className="grid grid-cols-2 gap-6">

                {/* Step 4 result — 8×8 bitmask */}
                <div className="glass-card p-5 space-y-3" style={{ border: '1px solid hsl(142 71% 45% / 0.4)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold" style={{ color: 'hsl(142 71% 55%)' }}>STEP 04 OUTPUT</span>
                    <span className="text-sm font-semibold">64-bit Bitmask Grid</span>
                  </div>
                  <p className="text-gray-400 text-xs">
                    Median threshold = <code className="text-yellow-300 bg-gray-800 px-1 rounded">{forensicData.median_frequency}</code>.
                    {' '}Green cell = 1 (above median). Black cell = 0 (below). This 8×8 grid IS the pHash.
                  </p>
                  <div className="flex justify-center">
                    <div
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px', width: '160px', height: '160px' }}
                    >
                      {forensicData.bitmask_8x8.map((bit, i) => (
                        <div
                          key={i}
                          title={`bit[${i}] = ${bit}`}
                          style={{
                            backgroundColor: bit === 1 ? '#22c55e' : '#111827',
                            border: '1px solid #374151',
                            borderRadius: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <span style={{ fontSize: '9px', color: bit === 1 ? '#bbf7d0' : '#4b5563', fontFamily: 'monospace' }}>
                            {bit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-500">Green = bit 1, Dark = bit 0</p>
                </div>

                {/* Hash summary */}
                <div className="glass-card p-5 space-y-4" style={{ border: '1px solid hsl(142 71% 45% / 0.4)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold" style={{ color: 'hsl(142 71% 55%)' }}>FINAL HASH</span>
                    <span className="text-sm font-semibold">Fingerprint Summary</span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Hexadecimal pHash (16 chars)</p>
                      <code className="text-green-300 bg-gray-800 px-3 py-1.5 rounded-lg text-sm font-mono block tracking-widest">
                        {forensicData.phash_hex}
                      </code>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">64-bit Binary String</p>
                      <div className="bg-gray-800 rounded-lg px-3 py-2 font-mono text-xs leading-relaxed break-all">
                        {/* Render 8 groups of 8 bits for readability */}
                        {Array.from({ length: 8 }, (_, row) => (
                          <span key={row} className="inline-block mr-2">
                            {forensicData.phash_binary.slice(row * 8, row * 8 + 8).split('').map((bit, col) => (
                              <span
                                key={col}
                                className={bit === '1' ? 'text-green-300' : 'text-gray-600'}
                              >
                                {bit}
                              </span>
                            ))}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Median DCT Coefficient</p>
                      <code className="text-yellow-300 bg-gray-800 px-3 py-1.5 rounded-lg text-sm font-mono block">
                        {forensicData.median_frequency}
                      </code>
                    </div>
                  </div>

                  <div className="mt-auto pt-2 border-t border-gray-800">
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Hamming distance between two images = number of differing bits in their 64-bit hashes.
                      {' '}<span className="text-yellow-300">Distance ≤ 10</span> → structurally identical (plagiarism).
                      {' '}<span className="text-green-300">Distance &gt; 10</span> → different artwork (clear).
                    </p>
                  </div>
                </div>
              </div>

              {/* Tamper resistance note */}
              <div className="glass-card p-5">
                <h4 className="font-semibold text-sm mb-3 font-heading" style={{ color: 'hsl(0 0% 80%)' }}>Zero Blind Spots — Every Attack Vector Covered</h4>
                <div className="grid grid-cols-5 gap-3 text-xs" style={{ color: 'hsl(215 12% 50%)' }}>
                  {[
                    { edit: 'Colour Grading', why: 'Grayscale step strips all colour before hashing. Colour shifts produce zero Hamming distance change.' },
                    { edit: 'JPEG Compression', why: 'Artefacts live in high-frequency DCT bands that are discarded by the 8×8 low-pass filter.' },
                    { edit: 'Cropping', why: 'Resize to 32×32 re-normalises geometry. Even 20% crops shift very few of the 64 structural bits.' },
                    { edit: 'Rotation / Flip', why: '8-way symmetry scan tests all 4 rotations and 4 mirror variants. No orientation escapes detection.' },
                    { edit: 'Adversarial Noise', why: 'Median blur pre-processing squeezes out imperceptible high-frequency perturbations before the DCT runs.' },
                  ].map(({ edit, why }) => (
                    <div key={edit} className="rounded-xl p-3" style={{ backgroundColor: 'hsl(0 0% 12%)' }}>
                      <div className="font-semibold text-white mb-1">{edit}</div>
                      <div>{why}</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      )}
      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3 — System Architecture
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'architecture' && (
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8 relative z-10" style={{ animation: 'fade-in-up 0.5s ease-out' }}>

          {/* Title */}
          <div className="glass-card glow-border p-6">
            <h2 className="text-xl font-bold text-emerald-300 mb-1 font-heading">System Architecture — Veritas Protocol</h2>
            <p className="text-gray-400 text-sm">
              End-to-end flow from image upload to on-chain copyright proof on{' '}
              <span className="text-blue-400 font-semibold">Algorand Testnet</span>.
              App ID: <code className="text-yellow-300 bg-gray-800 px-1 rounded">{APP_ID}</code> ·
              Owner: <code className="text-green-300 bg-gray-800 px-1 rounded text-xs">{OWNER.slice(0, 12)}...{OWNER.slice(-6)}</code>
            </p>
          </div>

          {/* Artist Flow */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 font-heading" style={{ color: 'hsl(217 91% 70%)' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: 'hsl(217 91% 60%)' }}>A</span>
              Artist Registration Flow
            </h3>
            <div className="flex items-stretch gap-2">
              {[
                { label: 'Upload Artwork', sub: 'Any image format', color: 'border-blue-700 bg-blue-950/30' },
                { label: 'Median Blur', sub: 'Denoise 3×3 kernel', color: 'border-red-700 bg-red-950/30' },
                { label: 'Grayscale 32×32', sub: 'Strip colour + resize', color: 'border-gray-600 bg-gray-800/50' },
                { label: '2D DCT', sub: 'Freq. domain transform', color: 'border-yellow-700 bg-yellow-950/30' },
                { label: '8×8 Low-pass', sub: 'Keep structure only', color: 'border-orange-700 bg-orange-950/30' },
                { label: '64-bit pHash', sub: 'Median threshold bits', color: 'border-green-700 bg-green-950/30' },
                { label: 'Pera Sign', sub: 'register_work(hash)', color: 'border-purple-700 bg-purple-950/30' },
                { label: 'Algorand Box', sub: `App #${APP_ID} Testnet`, color: 'border-teal-600 bg-teal-950/30' },
              ].map((step, i, arr) => (
                <React.Fragment key={step.label}>
                  <div className={`flex-1 rounded-xl border p-3 text-center ${step.color}`}>
                    <div className="step-badge mx-auto mb-1" style={{ backgroundColor: 'hsl(220 16% 10%)' }}><span className="text-xs">{String(i + 1).padStart(2, '0')}</span></div>
                    <div className="text-xs font-semibold text-white leading-tight">{step.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-tight">{step.sub}</div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex items-center text-gray-600 text-lg font-light self-center">›</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Verifier Flow */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 font-heading" style={{ color: 'hsl(271 81% 75%)' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: 'hsl(271 81% 56%)' }}>V</span>
              Verifier Forensic Scan Flow
            </h3>
            <div className="flex items-stretch gap-2">
              {[
                { label: 'Upload Suspect', sub: 'Potential copy', color: 'border-purple-700 bg-purple-950/30' },
                { label: 'Median Blur', sub: 'Adversarial defense', color: 'border-red-700 bg-red-950/30' },
                { label: '8 Orientations', sub: '4 rot × 2 mirrors', color: 'border-pink-700 bg-pink-950/30' },
                { label: 'pHash Each', sub: 'DCT skeleton hash', color: 'border-green-700 bg-green-950/30' },
                { label: 'Read BoxMap', sub: `App #${APP_ID} live`, color: 'border-teal-600 bg-teal-950/30' },
                { label: 'Hamming Dist.', sub: '64-bit XOR count', color: 'border-yellow-700 bg-yellow-950/30' },
                { label: 'Threshold ≤10', sub: 'D=0 orig, D≤10 copy', color: 'border-orange-700 bg-orange-950/30' },
                { label: 'Forensic Report', sub: 'Transform + TxID', color: 'border-blue-700 bg-blue-950/30' },
              ].map((step, i, arr) => (
                <React.Fragment key={step.label}>
                  <div className={`flex-1 rounded-xl border p-3 text-center ${step.color}`}>
                    <div className="step-badge mx-auto mb-1" style={{ backgroundColor: 'hsl(220 16% 10%)' }}><span className="text-xs">{String(i + 1).padStart(2, '0')}</span></div>
                    <div className="text-xs font-semibold text-white leading-tight">{step.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-tight">{step.sub}</div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex items-center text-gray-600 text-lg font-light self-center">›</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* On-chain storage diagram */}
          <div className="grid grid-cols-3 gap-4">
            <div className="glass-card p-5 col-span-2" style={{ border: '1px solid hsl(187 67% 40% / 0.4)' }}>
              <h4 className="font-bold text-sm mb-3 font-heading" style={{ color: 'hsl(187 67% 60%)' }}>On-Chain Storage Model (Algorand BoxMap)</h4>
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="text-teal-500">Contract:</span>
                  <span>VeritasRegistry (App #{APP_ID}) — Testnet</span>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 space-y-1">
                  <div className="text-gray-500 mb-2">BoxMap[String → Account]</div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="text-yellow-400 mb-1">Box Key (pHash hex)</div>
                      <div className="text-gray-300 bg-gray-900 rounded p-2 break-all">"e3b0c44298fc1c14..."</div>
                      <div className="text-gray-500 mt-1">16 hex chars = 64 bits</div>
                    </div>
                    <div className="text-gray-600 self-center text-xl">→</div>
                    <div className="flex-1">
                      <div className="text-green-400 mb-1">Box Value (Owner)</div>
                      <div className="text-gray-300 bg-gray-900 rounded p-2 break-all">"{OWNER.slice(0, 16)}..."</div>
                      <div className="text-gray-500 mt-1">32-byte Algorand pubkey</div>
                    </div>
                  </div>
                </div>
                <div className="text-gray-500">
                  ABI method: <span className="text-purple-400">register_work(string)void</span> · Fee: 2000 µALGO (covers box MBR)
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="glass-card p-5" style={{ border: '1px solid hsl(217 91% 60% / 0.3)' }}>
                <h4 className="font-bold text-sm mb-2 font-heading" style={{ color: 'hsl(217 91% 70%)' }}>Network Configuration</h4>
                <div className="space-y-2 text-xs font-mono">
                  <div><span className="text-gray-500">Node: </span><span className="text-gray-300 break-all">testnet-api.algonode.cloud</span></div>
                  <div><span className="text-gray-500">Indexer: </span><span className="text-gray-300 break-all">testnet-idx.algonode.cloud</span></div>
                  <div><span className="text-gray-500">Wallet: </span><span className="text-purple-400">Pera (@perawallet)</span></div>
                  <div><span className="text-gray-500">Network: </span><span className="text-yellow-400">Algorand Testnet</span></div>
                </div>
              </div>
              <div className="glass-card p-5" style={{ border: '1px solid hsl(142 71% 45% / 0.3)' }}>
                <h4 className="font-bold text-sm mb-2 font-heading" style={{ color: 'hsl(142 71% 55%)' }}>Security Layers</h4>
                <div className="space-y-1.5 text-xs text-gray-400">
                  <div className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0"></span>Median Blur — adversarial noise</div>
                  <div className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0"></span>8-way D4 symmetry invariance</div>
                  <div className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0"></span>DCT skeleton (structure only)</div>
                  <div className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0"></span>Immutable Algorand timestamp</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tech stack */}
          <div className="glass-card p-5">
            <h4 className="font-semibold text-sm mb-4 font-heading" style={{ color: 'hsl(0 0% 80%)' }}>Technology Stack</h4>
            <div className="grid grid-cols-4 gap-4 text-xs">
              {[
                { layer: 'Frontend', color: 'text-blue-400', items: ['React 18 + TypeScript', 'Vite 5', 'Tailwind CSS v3', 'DaisyUI v4', '@txnlab/use-wallet-react v4', 'algosdk (ATC + ABI)'] },
                { layer: 'Wallet', color: 'text-purple-400', items: ['Pera Wallet', 'WalletId.PERA', 'transactionSigner', 'AtomicTransactionComposer', 'ARC4 ABI call', 'Box MBR fee'] },
                { layer: 'Backend (FastAPI)', color: 'text-yellow-400', items: ['Python 3.11', 'imagehash (pHash)', 'Pillow + MedianFilter', 'numpy + scipy DCT', 'algosdk v2client', 'AlgoNode REST API'] },
                { layer: 'Blockchain', color: 'text-teal-400', items: ['Algorand Testnet', `App ID #${APP_ID}`, 'VeritasRegistry ARC4', 'BoxMap(String→Account)', 'ARC4 Event: Registration', 'AlgoNode (no token)'] },
              ].map(({ layer, color, items }) => (
                <div key={layer}>
                  <div className={`font-bold ${color} mb-2 uppercase tracking-widest text-xs`}>{layer}</div>
                  <ul className="space-y-1 text-gray-400">
                    {items.map(item => <li key={item} className="flex gap-1"><span className="text-gray-600">·</span>{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 py-8 px-6" style={{ borderTop: '1px solid hsl(220 15% 13% / 0.5)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs" style={{ color: 'hsl(215 12% 50%)' }}>
          <span>© 2026 Veritas Protocol. Decentralized Copyright on Algorand.</span>
          <span className="font-mono">App #{APP_ID} · Testnet</span>
        </div>
      </footer>
    </div>
  )
}
