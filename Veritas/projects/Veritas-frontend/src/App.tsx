import React, { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import ConnectWallet from './components/ConnectWallet'
import algosdk from 'algosdk'

const API     = import.meta.env.VITE_API_URL ?? 'https://veritas-api-vgus.onrender.com'
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
    desc: 'A 3×3 Median Blur strips imperceptible high-frequency adversarial perturbations before any hashing begins. Invisible digital noise that tries to alter the hash without changing the visible artwork is eliminated here.',
  },
  {
    num: '02',
    title: 'Grayscale + 32×32 Resize',
    desc: 'Convert to grayscale and resize to 32×32. This removes colour noise and compression artefacts, leaving only structural luminance data — the raw "skeleton" of the artwork.',
  },
  {
    num: '03',
    title: 'Discrete Cosine Transform',
    desc: '2D DCT converts 1024 pixel values into 1024 frequency coefficients. Low-frequency coefficients (top-left) capture large structural shapes; high-frequency ones encode fine detail and noise — which we discard.',
  },
  {
    num: '04',
    title: 'Low-Pass Filter (8×8)',
    desc: 'Keep only the top-left 8×8 block — 64 coefficients representing the lowest frequencies. Cropping, colour grading, JPEG compression, and minor edits all live in the HIGH frequencies, which are thrown away here.',
  },
  {
    num: '05',
    title: 'Median Threshold → 64-bit Hash',
    desc: 'Compute the median of the 64 DCT coefficients. Each bit = 1 if above median, 0 if below. The result is a 64-bit structural fingerprint invariant to resizing, colour changes, and compression.',
  },
  {
    num: '06',
    title: '8-Way Symmetry Invariance',
    desc: 'During verification, all 8 orientations of the suspect image are tested: original + 3 rotations (90°/180°/270°) + their 4 mirrored counterparts. No rotation or flip can bypass the registry.',
  },
]

// ── Perceptual-hash colour scale (blue → yellow) ────────────────────────
const dctColor = (v: number): string => {
  const r = Math.round((v / 255) * 255)
  const g = Math.round((v / 255) * 180)
  const b = Math.round(255 - (v / 255) * 255)
  return `rgb(${r},${g},${b})`
}

// ── Forensic Visualizer sub-components ──────────────────────────────────

function RightArrow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', flexShrink: 0 }}>
      <svg width="52" height="16" viewBox="0 0 52 16" fill="none">
        <line x1="0" y1="8" x2="40" y2="8"
          stroke="rgb(63 63 70)" strokeWidth="1.5" strokeDasharray="4 3"
          style={{ animation: 'flow-right 0.7s linear infinite' }} />
        <polyline points="34,3 44,8 34,13"
          stroke="rgb(63 63 70)" strokeWidth="1.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function DownConnector() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
      <svg width="20" height="40" viewBox="0 0 20 40" fill="none">
        <line x1="10" y1="0" x2="10" y2="30"
          stroke="rgb(63 63 70)" strokeWidth="1.5" strokeDasharray="4 3"
          style={{ animation: 'flow-down 0.7s linear infinite' }} />
        <polyline points="4,25 10,34 16,25"
          stroke="rgb(63 63 70)" strokeWidth="1.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function ForensicStepCard({ num, title, tooltip, children, delay = 0 }: {
  num: string; title: string; tooltip: string; children: React.ReactNode; delay?: number
}) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div
      className="card p-5"
      style={{ animation: `fade-in 0.4s ease ${delay}s both` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span className="step-num">{num}</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{title}</span>
        <span
          className="mono"
          style={{
            marginLeft: 'auto', fontSize: '0.625rem', letterSpacing: '0.04em',
            cursor: 'help', userSelect: 'none',
            padding: '2px 7px', borderRadius: 5,
            color: showTip ? 'rgb(147 197 253)' : 'rgb(63 63 70)',
            background: showTip ? 'rgb(59 130 246 / 0.1)' : 'rgb(39 39 42 / 0.5)',
            border: `1px solid ${showTip ? 'rgb(59 130 246 / 0.25)' : 'rgb(63 63 70 / 0.35)'}`,
            transition: 'color 0.18s, background 0.18s, border-color 0.18s',
          }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >ℹ theory</span>
      </div>
      {/* Theory tooltip — slides in only when hovering the ℹ badge */}
      <div style={{
        maxHeight: showTip ? '200px' : '0px', overflow: 'hidden',
        opacity: showTip ? 1 : 0, marginBottom: showTip ? 14 : 0,
        transition: 'max-height 0.32s ease, opacity 0.2s ease, margin-bottom 0.25s ease',
      }}>
        <div style={{
          fontSize: '0.75rem', color: 'rgb(161 161 170)', lineHeight: 1.7,
          padding: '10px 13px', background: 'rgb(9 9 11)',
          borderRadius: 8, border: '1px solid rgb(59 130 246 / 0.12)',
        }}>
          {tooltip}
        </div>
      </div>
      {children}
    </div>
  )
}

function ForensicImgBox({ label, src }: { label: string; src: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgb(39 39 42)', background: '#000' }}>
        <img src={src} alt={label} style={{ width: 160, height: 160, imageRendering: 'pixelated', display: 'block' }} />
      </div>
      <span className="mono" style={{ fontSize: '0.6875rem', color: 'rgb(113 113 122)' }}>{label}</span>
    </div>
  )
}

function DCTHeatmapGrid({ data }: { data: number[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
        gap: 2, width: 160, height: 160,
        borderRadius: 10, overflow: 'hidden', border: '1px solid rgb(39 39 42)',
      }}>
        {data.map((v, i) => (
          <div
            key={i}
            title={`[${Math.floor(i / 8)},${i % 8}] = ${v.toFixed(1)}`}
            style={{ backgroundColor: dctColor(v), animation: `fade-in 0.25s ease ${i * 0.006}s both` }}
          />
        ))}
      </div>
      <span className="mono" style={{ fontSize: '0.6875rem', color: 'rgb(113 113 122)' }}>DCT Heatmap</span>
    </div>
  )
}

function BitmaskGrid({ data }: { data: number[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3, width: 160, height: 160 }}>
        {data.map((bit, i) => (
          <div
            key={i}
            title={`bit[${i}] = ${bit}`}
            style={{
              backgroundColor: bit === 1 ? 'rgba(59,130,246,0.45)' : 'rgb(18,18,20)',
              border: `1px solid ${bit === 1 ? 'rgba(59,130,246,0.3)' : 'rgb(39,39,42)'}`,
              borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: `bit-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.013}s both`,
            }}
          >
            <span className="mono" style={{ fontSize: 9, color: bit === 1 ? 'rgb(191,219,254)' : 'rgb(63,63,70)' }}>{bit}</span>
          </div>
        ))}
      </div>
      <span className="mono" style={{ fontSize: '0.6875rem', color: 'rgb(113 113 122)' }}>64-bit Fingerprint</span>
    </div>
  )
}

function DCTBarGraph({ data }: { data: number[] }) {
  const maxVal = Math.max(...data, 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'flex-end', gap: 0.5,
        height: 64, width: 160, padding: '0 3px',
        background: 'rgb(9,9,11)', borderRadius: 8, border: '1px solid rgb(39,39,42)', overflow: 'hidden',
      }}>
        {/* Moving scan line — gives the graph a live/dynamic feel */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: 2, zIndex: 2, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, transparent 0%, rgb(250 250 250 / 0.45) 50%, transparent 100%)',
          animation: 'scan 2.6s ease-in-out infinite',
        }} />
        {data.map((v, i) => (
          <div
            key={i}
            title={`coeff[${i}] = ${v.toFixed(1)}`}
            style={{
              flex: 1, minHeight: 2, borderRadius: '2px 2px 0 0',
              height: `${Math.max((v / maxVal) * 100, 2)}%`,
              backgroundColor: dctColor(v),
              transformOrigin: 'bottom',
              animation: `bar-rise 0.7s cubic-bezier(0.16,1,0.3,1) ${i * 0.01}s both`,
            }}
          />
        ))}
      </div>
      <span className="mono" style={{ fontSize: '0.6875rem', color: 'rgb(63,63,70)', textAlign: 'center' }}>64 coefficients</span>
    </div>
  )
}

export default function App() {
  const { activeAddress, transactionSigner, algodClient } = useWallet()
  const [activeTab, setActiveTab] = useState<Tab>('registry')

  // --- Registry tab state ---
  const [registerFile, setRegisterFile] = useState<File | null>(null)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [registerStatus, setRegisterStatus] = useState<StatusState>({ type: 'idle', message: '' })
  const [verifyStatus, setVerifyStatus] = useState<StatusState>({ type: 'idle', message: '' })
  const [verifyDetectionMethod, setVerifyDetectionMethod] = useState<string | null>(null)
  const [registryCount, setRegistryCount] = useState<number | null>(null)
  const [backendReady, setBackendReady] = useState(false)
  const [backendWaking, setBackendWaking] = useState(false)
  const [openWalletModal, setOpenWalletModal] = useState(false)
  const [registerCloudinaryUrl, setRegisterCloudinaryUrl] = useState<string | null>(null)

  // --- Forensic tab state ---
  const [forensicFile, setForensicFile] = useState<File | null>(null)
  const [forensicOriginalUrl, setForensicOriginalUrl] = useState<string | null>(null)
  const [forensicData, setForensicData] = useState<ForensicData | null>(null)
  const [forensicLoading, setForensicLoading] = useState(false)
  const [forensicError, setForensicError] = useState<string | null>(null)
  const [registerPreviewUrl, setRegisterPreviewUrl] = useState<string | null>(null)

  // Poll backend every 6s until it responds, then stop
  useEffect(() => {
    const tryFetch = () => {
      fetch(`${API}/registry`)
        .then(r => r.json())
        .then(data => {
          setRegistryCount(data.count ?? 0)
          setBackendReady(true)
          setBackendWaking(false)
          clearInterval(id)
        })
        .catch(() => { /* still waking, keep polling */ })
    }
    setBackendWaking(true)
    tryFetch() // immediate first attempt
    const id = setInterval(tryFetch, 6000)
    return () => clearInterval(id)
  }, [])

  const fetchRegistryCount = useCallback(() => {
    fetch(`${API}/registry`)
      .then(r => r.json())
      .then(data => setRegistryCount(data.count ?? 0))
      .catch(() => { /* ignore */ })
  }, [])

  // ── Fetch with auto-retry (handles Render cold start) ────────────────────
  const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, delayMs = 5000): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options)
        if (res.ok) return res
      } catch { /* retry */ }
      if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs))
    }
    throw new Error('Backend is not responding. Please wait a moment and try again.')
  }

  // ── Registry actions ──────────────────────────────────────────────────────

  const registerArtwork = async () => {
    if (!activeAddress) return alert('Please connect your Pera Wallet first.')
    if (!registerFile) return alert('Please select an image to register.')
    setRegisterStatus({ type: 'loading', message: 'Step 1/3 — Computing 64-bit pHash (waking backend if needed)...' })

    try {
      // ── Step 1: Compute pHash on backend (Median Blur → DCT → Bitmask) ─────
      const formData = new FormData()
      formData.append('file', registerFile)
      let hashData: Record<string, string>
      try {
        const hashRes = await fetchWithRetry(`${API}/compute-hash`, { method: 'POST', body: formData })
        hashData = await hashRes.json()
      } catch {
        throw new Error('Could not reach the backend. It may be waking up — please wait 30 seconds and try again.')
      }
      if (hashData.error) throw new Error(`Hash error: ${hashData.error}`)
      const phash: string = hashData.phash
      if (!phash) throw new Error('Backend returned no hash. It may still be waking up — please try again in a moment.')
      if (hashData.cloudinary_url) setRegisterCloudinaryUrl(hashData.cloudinary_url)

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
      const isDuplicate =
        msg.toLowerCase().includes('already') ||
        msg.toLowerCase().includes('assert failed') ||
        msg.toLowerCase().includes('logic eval error')
      if (isDuplicate) {
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
      const res = await fetchWithRetry(`${API}/verify`, { method: 'POST', body: formData })
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
      setVerifyStatus({ type: 'error', message: 'Could not reach the backend. Please try again in a moment.' })
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
      const res = await fetchWithRetry(`${API}/analyze`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (!data.phash_binary || !data.phash_hex || !data.dct_heatmap) {
        throw new Error('Backend returned incomplete data. It may still be waking up — please try again in a moment.')
      }
      setForensicData(data as ForensicData)
    } catch (e: unknown) {
      setForensicError(e instanceof Error ? e.message : 'Could not reach the backend. Please try again in a moment.')
    } finally {
      setForensicLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'rgb(9 9 11)', color: 'rgb(250 250 250)' }}>

      {/* ── Waking banner ── */}
      {backendWaking && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-xs" style={{ backgroundColor: 'rgb(161 98 7 / 0.15)', borderBottom: '1px solid rgb(161 98 7 / 0.3)', color: 'rgb(253 224 71)' }}>
          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          Backend is waking up (free hosting cold start) — this takes ~30 seconds, please wait…
        </div>
      )}

      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md" style={{ backgroundColor: 'rgb(9 9 11 / 0.85)', borderBottom: '1px solid rgb(39 39 42)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(250 250 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            <span className="text-sm font-semibold tracking-tight">Veritas Protocol</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs mono px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)', color: 'rgb(161 161 170)' }}>
              <span className="dot" style={{ backgroundColor: backendReady ? 'rgb(34 197 94)' : 'rgb(234 179 8)' }} />
              <span>{backendWaking ? 'Connecting…' : registryCount === null ? '—' : `${registryCount} registered`}</span>
            </div>
            {activeAddress ? (
              <button onClick={() => setOpenWalletModal(true)} className="btn-wallet">
                <span className="dot" style={{ backgroundColor: 'rgb(34 197 94)' }} />
                <span className="hidden sm:inline">{activeAddress.slice(0, 6)}…{activeAddress.slice(-4)}</span>
                <span className="sm:hidden">{activeAddress.slice(0, 4)}…</span>
              </button>
            ) : (
              <button onClick={() => setOpenWalletModal(true)} className="btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.5rem 0.875rem' }}>
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <ConnectWallet openModal={openWalletModal} closeModal={() => setOpenWalletModal(false)} />

      {/* ── Tabs ── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16" style={{ borderBottom: '1px solid rgb(39 39 42)' }}>
        <div className="flex gap-0 overflow-x-auto scrollbar-hide">
          {([
            { key: 'registry' as Tab, label: 'Register & Verify' },
            { key: 'forensic' as Tab, label: 'Forensic' },
            { key: 'architecture' as Tab, label: 'Architecture' },
          ]).map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} className={`tab whitespace-nowrap ${activeTab === t.key ? 'tab-active' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — Registry
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'registry' && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8 sm:space-y-10" style={{ animation: 'fade-in 0.35s ease' }}>

          {/* Hero */}
          <div className="text-center space-y-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Protect your creative work
            </h1>
            <p className="text-sm max-w-lg mx-auto" style={{ color: 'rgb(161 161 170)' }}>
              Register a 64-bit perceptual fingerprint on Algorand. Detects copies
              even after cropping, rotation, compression, or colour manipulation.
            </p>
          </div>

          {/* How it works */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { n: '01', title: 'Register', desc: 'Upload your artwork. A pHash fingerprint is computed and stored immutably on-chain.' },
              { n: '02', title: 'Upload Suspect', desc: 'Anyone can upload a suspect image to check against all registered originals.' },
              { n: '03', title: 'Forensic Scan', desc: 'All 8 orientations tested. Hamming Distance ≤ 10 flags plagiarism.' },
            ].map(({ n, title, desc }, i) => (
              <div key={n} className={`card p-5 stagger-${i + 1}`}>
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="step-num">{n}</span>
                  <span className="text-sm font-medium">{title}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'rgb(113 113 122)' }}>{desc}</p>
              </div>
            ))}
          </div>

          {/* Two-panel layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Register panel */}
            <div className="card p-6 flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md tracking-wider" style={{ background: 'rgb(59 130 246)', color: '#fff' }}>REGISTER</span>
                  <h2 className="text-base font-semibold">Original Artwork</h2>
                </div>
                <p className="text-xs" style={{ color: 'rgb(113 113 122)' }}>Upload your original to claim on-chain ownership.</p>
              </div>

              <label className={`upload-zone h-36 ${registerFile ? 'upload-zone-active' : ''}`}>
                <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                  if (e.target.files) {
                    const f = e.target.files[0]
                    setRegisterFile(f)
                    setRegisterPreviewUrl(URL.createObjectURL(f))
                    setRegisterCloudinaryUrl(null)
                    setRegisterStatus({ type: 'idle', message: '' })
                  }
                }} />
                {registerFile && registerPreviewUrl ? (
                  <div className="flex flex-col items-center gap-1.5 w-full h-full">
                    <img src={registerPreviewUrl} alt="preview" className="rounded-lg object-contain" style={{ maxHeight: 80, maxWidth: '100%' }} />
                    <span className="text-xs mono px-2 py-0.5 rounded max-w-[200px] truncate" style={{ color: 'rgb(59 130 246)', backgroundColor: 'rgb(24 24 27)' }}>{registerFile.name}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(113 113 122)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <span className="text-sm" style={{ color: 'rgb(113 113 122)' }}>Click to upload</span>
                    <span className="text-[10px]" style={{ color: 'rgb(63 63 70)' }}>PNG, JPG, WEBP</span>
                  </div>
                )}
              </label>

              {registerStatus.type === 'loading' && (
                <div className="alert alert-warning flex items-center gap-2">
                  <span className="dot dot-pulse" style={{ backgroundColor: 'rgb(245 158 11)' }} />
                  <span className="text-xs">{registerStatus.message}</span>
                </div>
              )}
              {registerStatus.type === 'registered' && (
                <div className="alert alert-success flex items-center gap-2">
                  <span className="dot" style={{ backgroundColor: 'rgb(34 197 94)' }} />
                  <span className="text-xs">{registerStatus.message}</span>
                </div>
              )}
              {registerStatus.type === 'error' && (
                <div className="alert alert-danger text-xs">{registerStatus.message}</div>
              )}

              {registerCloudinaryUrl && registerStatus.type === 'registered' && (
                <div className="p-3 rounded-xl space-y-2" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgb(161 161 170)' }}>Stored on Cloudinary</div>
                  <img
                    src={registerCloudinaryUrl}
                    alt="Registered artwork"
                    className="w-full rounded-lg object-contain"
                    style={{ maxHeight: 120 }}
                  />
                  <a
                    href={registerCloudinaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono text-[10px] block truncate"
                    style={{ color: 'rgb(59 130 246)' }}
                  >
                    {registerCloudinaryUrl}
                  </a>
                </div>
              )}

              <button onClick={registerArtwork} className="btn-primary w-full mt-auto">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                Register on Algorand
              </button>
            </div>

            {/* Verify panel */}
            <div className="card p-6 flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md tracking-wider" style={{ background: 'rgb(39 39 42)', color: 'rgb(161 161 170)' }}>VERIFY</span>
                  <h2 className="text-base font-semibold">Suspect Artwork</h2>
                </div>
                <p className="text-xs" style={{ color: 'rgb(113 113 122)' }}>Upload a suspect image to check for plagiarism.</p>
              </div>

              <label className={`upload-zone h-36 ${verifyFile ? 'upload-zone-active' : ''}`}>
                <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && setVerifyFile(e.target.files[0])} />
                {verifyFile ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(59 130 246)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    <span className="text-sm font-medium" style={{ color: 'rgb(59 130 246)' }}>Ready</span>
                    <span className="text-xs mono px-2 py-0.5 rounded max-w-[200px] truncate" style={{ color: 'rgb(161 161 170)', backgroundColor: 'rgb(24 24 27)' }}>{verifyFile.name}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(113 113 122)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <span className="text-sm" style={{ color: 'rgb(113 113 122)' }}>Click to upload suspect</span>
                    <span className="text-[10px]" style={{ color: 'rgb(63 63 70)' }}>PNG, JPG, WEBP</span>
                  </div>
                )}
              </label>

              {verifyStatus.type === 'loading' && (
                <div className="alert alert-warning flex items-center gap-2">
                  <span className="dot dot-pulse" style={{ backgroundColor: 'rgb(245 158 11)' }} />
                  <span className="text-xs">{verifyStatus.message}</span>
                </div>
              )}
              {verifyStatus.type === 'original' && (
                <div className="alert alert-info">
                  <div className="flex items-center gap-1.5 mb-1"><span className="dot" style={{ backgroundColor: 'rgb(59 130 246)' }} /><strong className="text-xs">ORIGINAL VERIFIED</strong></div>
                  <span className="text-xs">{verifyStatus.message}</span>
                </div>
              )}
              {verifyStatus.type === 'plagiarism' && (
                <div className="alert alert-danger">
                  <div className="flex items-center gap-1.5 mb-1"><span className="dot" style={{ backgroundColor: 'rgb(239 68 68)' }} /><strong className="text-xs">PLAGIARISM DETECTED</strong></div>
                  <span className="text-xs">{verifyStatus.message}</span>
                </div>
              )}
              {verifyStatus.type === 'clear' && (
                <div className="alert alert-success">
                  <div className="flex items-center gap-1.5 mb-1"><span className="dot" style={{ backgroundColor: 'rgb(34 197 94)' }} /><strong className="text-xs">CLEAR</strong></div>
                  <span className="text-xs">{verifyStatus.message}</span>
                </div>
              )}
              {verifyStatus.type === 'error' && (
                <div className="alert alert-danger text-xs">{verifyStatus.message}</div>
              )}

              {verifyDetectionMethod && verifyStatus.type !== 'idle' && verifyStatus.type !== 'loading' && (
                <div className="p-4 rounded-xl text-xs space-y-2" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgb(161 161 170)' }}>Forensic Report</div>
                  <div className="flex gap-2"><span style={{ color: 'rgb(113 113 122)', width: 72, flexShrink: 0 }}>Detection</span><span className="mono" style={{ color: 'rgb(253 224 71)' }}>{verifyDetectionMethod}</span></div>
                  <div className="flex gap-2"><span style={{ color: 'rgb(113 113 122)', width: 72, flexShrink: 0 }}>On-chain</span><span className="mono" style={{ color: 'rgb(161 161 170)' }}>App #{APP_ID} · Algorand Testnet</span></div>
                  <div className="flex gap-2"><span style={{ color: 'rgb(113 113 122)', width: 72, flexShrink: 0 }}>Pipeline</span><span className="mono" style={{ color: 'rgb(161 161 170)' }}>Median Blur → DCT → 8-Way Symmetry</span></div>
                </div>
              )}

              <button onClick={verifyArtwork} className="btn-secondary w-full mt-auto">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8" style={{ animation: 'fade-in 0.35s ease' }}>

          {/* ── Upload strip ─────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-6 sm:mb-7">
            <label className={`upload-zone flex-1 ${forensicFile ? 'upload-zone-active' : ''}`} style={{ height: 52 }}>
              <input type="file" className="hidden" accept="image/*" onChange={(e) => { if (e.target.files) { const f = e.target.files[0]; setForensicFile(f); setForensicOriginalUrl(URL.createObjectURL(f)); setForensicData(null); setForensicError(null) } }} />
              {forensicFile
                ? <span className="mono text-sm truncate px-3" style={{ color: 'rgb(161 161 170)', maxWidth: '100%' }}>{forensicFile.name}</span>
                : <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(113 113 122)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span className="text-sm" style={{ color: 'rgb(113 113 122)' }}>Drop an image or click to upload</span>
                  </div>
              }
            </label>
            <button onClick={runForensicAnalysis} disabled={forensicLoading || !forensicFile} className="btn-primary w-full sm:w-auto" style={{ height: 52, padding: '0 24px', flexShrink: 0 }}>
              {forensicLoading
                ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Analysing…</>
                : <>Run Analysis</>
              }
            </button>
          </div>

          {forensicError && <div className="alert alert-danger text-xs" style={{ marginBottom: 20 }}>{forensicError}</div>}

          {/* ── Idle placeholder ─────────────────────────────────────────── */}
          {!forensicData && !forensicLoading && (
            <div style={{ textAlign: 'center', paddingTop: 72, paddingBottom: 72, color: 'rgb(63 63 70)' }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>🔬</div>
              <p className="text-sm">Upload an image and run analysis to visualise the full pipeline</p>
            </div>
          )}

          {/* ── Pipeline results ─────────────────────────────────────────── */}
          {forensicData && (
            <div style={{ animation: 'fade-in 0.4s ease' }}>

              {/* STEP 01→02 — Noise Defense + Grayscale */}
              <ForensicStepCard num="01→02" title="Noise Defense + Grayscale" delay={0}
                tooltip="A 3×3 Median Blur removes adversarial high-frequency perturbations before hashing. The image is then converted to grayscale and resized to 32×32 — stripping colour noise and leaving only the structural luminance skeleton.">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <div className="flex-1 flex justify-center py-2">
                    <ForensicImgBox label="Original (colour)" src={forensicOriginalUrl ?? `data:image/png;base64,${forensicData.gray_original_b64}`} />
                  </div>
                  <RightArrow />
                  <div className="flex-1 flex justify-center py-2">
                    <ForensicImgBox label="Denoised · 32×32 (grey)" src={`data:image/png;base64,${forensicData.gray_32x32_b64}`} />
                  </div>
                </div>
              </ForensicStepCard>

              <DownConnector />

              {/* STEP 02→03 — DCT Frequency Decomposition */}
              <ForensicStepCard num="02→03" title="DCT Frequency Decomposition" delay={0.05}
                tooltip="2D Discrete Cosine Transform converts the 32×32 pixel grid into 1024 frequency coefficients. Only the top-left 8×8 block is kept — the 64 lowest-frequency values encoding large structural shapes. High-frequency noise and detail are discarded.">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <div className="flex-1 flex justify-center py-2">
                    <ForensicImgBox label="Denoised Input" src={`data:image/png;base64,${forensicData.gray_32x32_b64}`} />
                  </div>
                  <RightArrow />
                  <div className="flex-1 flex flex-col items-center gap-2.5 py-2">
                    <DCTHeatmapGrid data={forensicData.dct_heatmap} />
                    <DCTBarGraph data={forensicData.dct_heatmap} />
                  </div>
                </div>
              </ForensicStepCard>

              <DownConnector />

              {/* STEP 04 — 64-bit Bitmask */}
              <ForensicStepCard num="04" title="64-bit Bitmask" delay={0.1}
                tooltip="The median of the 64 DCT coefficients is computed. Each coefficient above the median becomes bit 1, below becomes 0. Result: a 64-bit structural fingerprint invariant to resizing, colour shifts, and compression artefacts.">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <div className="flex-1 flex justify-center py-2">
                    <DCTHeatmapGrid data={forensicData.dct_heatmap} />
                  </div>
                  <RightArrow />
                  <div className="flex-1 flex justify-center py-2">
                    <BitmaskGrid data={forensicData.bitmask_8x8} />
                  </div>
                </div>
              </ForensicStepCard>

              <DownConnector />

              {/* STEP 05 — Fingerprint Summary */}
              <div className="card p-5" style={{ animation: 'fade-in 0.4s ease 0.15s both' }}>
                <div className="flex items-center gap-2.5 mb-5">
                  <span className="step-num">05</span>
                  <span className="text-sm font-semibold">Fingerprint Summary</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div style={{ padding: '14px 16px', background: 'rgb(9,9,11)', borderRadius: 8, border: '1px solid rgb(39,39,42)' }}>
                    <p className="mono" style={{ fontSize: '0.625rem', color: 'rgb(63,63,70)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Hex pHash</p>
                    <code className="mono" style={{ fontSize: '0.8125rem', color: 'rgb(134,239,172)', letterSpacing: '0.05em', wordBreak: 'break-all' }}>{forensicData.phash_hex}</code>
                  </div>
                  <div style={{ padding: '14px 16px', background: 'rgb(9,9,11)', borderRadius: 8, border: '1px solid rgb(39,39,42)' }}>
                    <p className="mono" style={{ fontSize: '0.625rem', color: 'rgb(63,63,70)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>64-bit Binary</p>
                    <div className="mono" style={{ fontSize: '0.6875rem', lineHeight: 1.7, wordBreak: 'break-all' }}>
                      {Array.from({ length: 8 }, (_, row) => (
                        <span key={row} style={{ marginRight: 6, display: 'inline-block' }}>
                          {(forensicData.phash_binary ?? '').slice(row * 8, row * 8 + 8).split('').map((b, col) => (
                            <span key={col} style={{ color: b === '1' ? 'rgb(250,250,250)' : 'rgb(63,63,70)' }}>{b}</span>
                          ))}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: '14px 16px', background: 'rgb(9,9,11)', borderRadius: 8, border: '1px solid rgb(39,39,42)' }}>
                    <p className="mono" style={{ fontSize: '0.625rem', color: 'rgb(63,63,70)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Median Coefficient</p>
                    <code className="mono" style={{ fontSize: '1.125rem', color: 'rgb(253,224,71)' }}>{forensicData.median_frequency}</code>
                    <div style={{ marginTop: 10, fontSize: '0.6875rem', color: 'rgb(113,113,122)', lineHeight: 1.6 }}>
                      Hamming ≤ 10 → plagiarism<br />Hamming &gt; 10 → clear
                    </div>
                  </div>
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8 sm:space-y-10" style={{ animation: 'fade-in 0.35s ease' }}>

          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">System Architecture</h1>
            <p className="text-sm leading-relaxed" style={{ color: 'rgb(161 161 170)', maxWidth: '100%' }}>
              End-to-end pipeline from image upload to immutable on-chain copyright proof on Algorand Testnet.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                `App #${APP_ID}`,
                'Algorand Testnet',
                'VeritasRegistry ARC4',
                activeAddress ? `Owner: ${activeAddress.slice(0, 8)}…${activeAddress.slice(-4)}` : 'Owner: not connected',
              ].map(label => (
                <span key={label} className="mono text-[11px] px-3 py-1 rounded-full" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)', color: 'rgb(161 161 170)' }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Registration Flow ────────────────────────────────────────── */}
          <div className="card p-6 space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md" style={{ backgroundColor: 'rgb(59 130 246 / 0.12)', color: 'rgb(59 130 246)', border: '1px solid rgb(59 130 246 / 0.3)' }}>
                Registration
              </span>
              <span className="text-xs" style={{ color: 'rgb(113 113 122)' }}>Artist uploads original → immutable proof stored on-chain</span>
            </div>

            {/* Phase 1 */}
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgb(63 63 70)' }}>Phase 1 — Image Processing</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { n: '01', label: 'Upload Artwork', sub: 'Any format' },
                  { n: '02', label: 'Median Blur', sub: '3×3 denoise' },
                  { n: '03', label: 'Grayscale 32×32', sub: 'Strip colour' },
                  { n: '04', label: '2D DCT', sub: 'Freq. transform' },
                ].map((s) => (
                  <div key={s.n} className="rounded-xl p-3 sm:p-4" style={{ backgroundColor: 'rgb(14 14 16)', border: '1px solid rgb(39 39 42)' }}>
                    <span className="mono text-[10px] font-semibold" style={{ color: 'rgb(59 130 246)' }}>{s.n}</span>
                    <div className="text-xs sm:text-sm font-semibold mt-1.5 leading-tight">{s.label}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgb(113 113 122)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase connector */}
            <div className="flex items-center gap-3 px-1">
              <div style={{ width: 1, height: 24, backgroundColor: 'rgb(39 39 42)', marginLeft: 40 }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(63 63 70)' }}>continues ↓</span>
            </div>

            {/* Phase 2 */}
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgb(63 63 70)' }}>Phase 2 — Hash & Sign</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { n: '05', label: '8×8 Low-pass', sub: 'Structure only' },
                  { n: '06', label: '64-bit pHash', sub: 'Threshold bits' },
                  { n: '07', label: 'Pera Sign', sub: 'register_work()' },
                  { n: '08', label: 'Algorand Box', sub: `App #${APP_ID}` },
                ].map((s) => (
                  <div key={s.n} className="rounded-xl p-3 sm:p-4" style={{ backgroundColor: 'rgb(14 14 16)', border: '1px solid rgb(59 130 246 / 0.2)' }}>
                    <span className="mono text-[10px] font-semibold" style={{ color: 'rgb(34 197 94)' }}>{s.n}</span>
                    <div className="text-xs sm:text-sm font-semibold mt-1.5 leading-tight">{s.label}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgb(113 113 122)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Verification Flow ────────────────────────────────────────── */}
          <div className="card p-6 space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md" style={{ backgroundColor: 'rgb(245 158 11 / 0.12)', color: 'rgb(245 158 11)', border: '1px solid rgb(245 158 11 / 0.3)' }}>
                Verification
              </span>
              <span className="text-xs" style={{ color: 'rgb(113 113 122)' }}>Upload suspect → 8-way forensic scan → plagiarism report</span>
            </div>

            {/* Phase 1 */}
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgb(63 63 70)' }}>Phase 1 — Multi-orientation Scan</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { n: '01', label: 'Upload Suspect', sub: 'Potential copy' },
                  { n: '02', label: 'Median Blur', sub: 'Noise defense' },
                  { n: '03', label: '8 Orientations', sub: '4 rot × 2 mirror' },
                  { n: '04', label: 'pHash Each', sub: 'DCT skeleton' },
                ].map((s) => (
                  <div key={s.n} className="rounded-xl p-3 sm:p-4" style={{ backgroundColor: 'rgb(14 14 16)', border: '1px solid rgb(39 39 42)' }}>
                    <span className="mono text-[10px] font-semibold" style={{ color: 'rgb(245 158 11)' }}>{s.n}</span>
                    <div className="text-xs sm:text-sm font-semibold mt-1.5 leading-tight">{s.label}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgb(113 113 122)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase connector */}
            <div className="flex items-center gap-3 px-1">
              <div style={{ width: 1, height: 24, backgroundColor: 'rgb(39 39 42)', marginLeft: 40 }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(63 63 70)' }}>continues ↓</span>
            </div>

            {/* Phase 2 */}
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgb(63 63 70)' }}>Phase 2 — Compare &amp; Report</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { n: '05', label: 'Read BoxMap', sub: `App #${APP_ID}` },
                  { n: '06', label: 'Hamming Dist.', sub: '64-bit XOR' },
                  { n: '07', label: 'Threshold ≤10', sub: 'Plagiarism flag' },
                  { n: '08', label: 'Report', sub: 'Transform + TxID' },
                ].map((s) => (
                  <div key={s.n} className="rounded-xl p-3 sm:p-4" style={{ backgroundColor: 'rgb(14 14 16)', border: '1px solid rgb(245 158 11 / 0.2)' }}>
                    <span className="mono text-[10px] font-semibold" style={{ color: 'rgb(239 68 68)' }}>{s.n}</span>
                    <div className="text-xs sm:text-sm font-semibold mt-1.5 leading-tight">{s.label}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgb(113 113 122)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── On-chain storage + Network + Security ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-4 sm:p-6 lg:col-span-2 space-y-4">
              <h4 className="text-sm font-semibold">On-Chain Storage — Algorand BoxMap</h4>
              <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgb(9 9 11)', border: '1px solid rgb(30 30 33)' }}>
                <div className="mono text-xs" style={{ color: 'rgb(63 63 70)' }}>// VeritasRegistry · App #{APP_ID} · Algorand Testnet</div>
                <div className="mono text-xs" style={{ color: 'rgb(113 113 122)' }}>
                  BoxMap[<span style={{ color: 'rgb(253 224 71)' }}>String</span> → <span style={{ color: 'rgb(134 239 172)' }}>Account</span>]
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: 'rgb(253 224 71)' }}>Key — pHash (hex)</div>
                    <div className="mono text-xs rounded-lg p-3" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)', color: 'rgb(161 161 170)' }}>
                      "e3b0c44298fc1c14..."
                    </div>
                  </div>
                  <div>
                    <div className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: 'rgb(134 239 172)' }}>Value — Owner address</div>
                    <div className="mono text-xs rounded-lg p-3" style={{ backgroundColor: 'rgb(24 24 27)', border: '1px solid rgb(39 39 42)', color: 'rgb(161 161 170)' }}>
                      {activeAddress ? `"${activeAddress.slice(0, 20)}..."` : '"Connect wallet to see address"'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mono text-xs" style={{ color: 'rgb(113 113 122)' }}>
                ABI: <span style={{ color: 'rgb(161 161 170)' }}>register_work(string)void</span>
                {' '}· Fee: <span style={{ color: 'rgb(161 161 170)' }}>2000 µALGO</span>
                {' '}· MBR: <span style={{ color: 'rgb(161 161 170)' }}>auto-calculated + funded</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-5">
                <h4 className="text-sm font-semibold mb-4">Network</h4>
                <div className="space-y-3">
                  {[
                    { k: 'Node', v: 'algonode.cloud' },
                    { k: 'Indexer', v: 'idx.algonode.cloud' },
                    { k: 'Wallet', v: 'Pera Wallet' },
                    { k: 'Chain', v: 'Algorand Testnet' },
                  ].map(r => (
                    <div key={r.k} className="flex justify-between items-baseline gap-2">
                      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'rgb(63 63 70)' }}>{r.k}</span>
                      <span className="mono text-[11px]" style={{ color: 'rgb(161 161 170)' }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-5">
                <h4 className="text-sm font-semibold mb-4">Security</h4>
                <div className="space-y-2.5">
                  {[
                    'Median Blur noise defense',
                    '8-way symmetry invariance',
                    'DCT structural skeleton',
                    'Immutable Algorand proof',
                  ].map(item => (
                    <div key={item} className="flex items-start gap-2.5 text-xs" style={{ color: 'rgb(113 113 122)' }}>
                      <span className="dot mt-0.5 shrink-0" style={{ backgroundColor: 'rgb(34 197 94)' }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Tech Stack ──────────────────────────────────────────────── */}
          <div className="card p-6">
            <h4 className="text-sm font-semibold mb-6">Technology Stack</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {[
                { layer: 'Frontend', accent: 'rgb(59 130 246)', items: ['React 18 + TypeScript', 'Vite 5', 'Tailwind CSS v3', '@txnlab/use-wallet-react', 'algosdk (ATC + ABI)'] },
                { layer: 'Wallet', accent: 'rgb(168 85 247)', items: ['Pera Wallet', 'WalletId.PERA', 'transactionSigner', 'AtomicTransactionComposer', 'Box MBR fee'] },
                { layer: 'Backend', accent: 'rgb(245 158 11)', items: ['Python 3.11 + FastAPI', 'imagehash (pHash)', 'Pillow MedianFilter', 'numpy + scipy DCT', 'Cloudinary CDN'] },
                { layer: 'Blockchain', accent: 'rgb(34 197 94)', items: ['Algorand Testnet', `App ID #${APP_ID}`, 'VeritasRegistry ARC4', 'BoxMap(String→Account)', 'AlgoNode (no token)'] },
              ].map(({ layer, accent, items }) => (
                <div key={layer} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{layer}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(item => (
                      <div key={item} className="flex items-start gap-2 text-xs" style={{ color: 'rgb(113 113 122)' }}>
                        <span style={{ color: 'rgb(39 39 42)', flexShrink: 0 }}>·</span>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Footer */}
      <footer className="py-6 sm:py-8 px-4 sm:px-6 mt-auto" style={{ borderTop: '1px solid rgb(30 30 33)' }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center sm:justify-between gap-2 text-xs text-center sm:text-left" style={{ color: 'rgb(63 63 70)' }}>
          <span>© 2026 Veritas Protocol · Decentralized Copyright on Algorand</span>
          <span className="mono">App #{APP_ID} · Testnet</span>
        </div>
      </footer>
    </div>
  )
}
