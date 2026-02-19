import React, { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import ConnectWallet from './components/ConnectWallet'

const API = 'http://localhost:8000'

type StatusType = 'idle' | 'loading' | 'original' | 'plagiarism' | 'clear' | 'registered' | 'error'
type Tab = 'registry' | 'forensic'

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
  gray_32x32_b64: string
}

// Pipeline step descriptions shown in the forensic panel
const PIPELINE_STEPS = [
  {
    num: '01',
    title: 'Grayscale + 32×32 Resize',
    icon: '🎨',
    color: 'text-cyan-400',
    desc: 'Convert to grayscale and resize to 32×32. This strips colour noise and compression artefacts, leaving only structural luminance data — the raw "skeleton" of the artwork.',
  },
  {
    num: '02',
    title: 'Discrete Cosine Transform',
    icon: '〰️',
    color: 'text-yellow-400',
    desc: '2D DCT converts 1024 pixel values into 1024 frequency coefficients. Low-frequency coefficients (top-left) encode large structural shapes; high-frequency ones encode fine detail and noise.',
  },
  {
    num: '03',
    title: 'Low-Pass Filter (8×8)',
    icon: '🔲',
    color: 'text-orange-400',
    desc: 'Keep only the top-left 8×8 block — 64 coefficients that represent the lowest frequencies. Cropping, colour grading, JPEG compression, and minor edits all live in the HIGH frequencies, which are discarded here.',
  },
  {
    num: '04',
    title: 'Median Threshold → 64-bit Hash',
    icon: '🧬',
    color: 'text-green-400',
    desc: 'Compute the median of the 64 coefficients. Each bit = 1 if its coefficient is above the median, 0 if below. The result is a 64-bit binary fingerprint that is structurally invariant to minor edits.',
  },
]

export default function App() {
  const { activeAddress } = useWallet()
  const [activeTab, setActiveTab] = useState<Tab>('registry')

  // --- Registry tab state ---
  const [registerFile, setRegisterFile] = useState<File | null>(null)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [registerStatus, setRegisterStatus] = useState<StatusState>({ type: 'idle', message: '' })
  const [verifyStatus, setVerifyStatus] = useState<StatusState>({ type: 'idle', message: '' })
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
    if (!activeAddress) return alert('Please connect your wallet first.')
    if (!registerFile) return alert('Please select an image to register.')
    setRegisterStatus({ type: 'loading', message: 'Generating visual fingerprint...' })

    const formData = new FormData()
    formData.append('file', registerFile)
    formData.append('owner', activeAddress)

    try {
      const res = await fetch(`${API}/register`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.status === 'Already Registered') {
        setRegisterStatus({ type: 'error', message: `⚠️ Already registered by: ${data.owner} (Hash: ${data.phash?.slice(0, 8)}...)` })
      } else {
        setRegisterStatus({ type: 'registered', message: `✅ Registered on-chain! pHash: ${data.phash} | ${data.message}` })
        fetchRegistryCount()
      }
    } catch {
      setRegisterStatus({ type: 'error', message: '❌ Backend offline. Run: python main.py in the api/ folder.' })
    }
  }

  const verifyArtwork = async () => {
    if (!verifyFile) return alert('Please select a suspect image to verify.')
    setVerifyStatus({ type: 'loading', message: 'Scanning visual registry...' })

    const formData = new FormData()
    formData.append('file', verifyFile)

    try {
      const res = await fetch(`${API}/verify`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      if (data.status === 'No Registry') {
        setVerifyStatus({ type: 'error', message: '⚠️ No artworks registered yet. Register an original first.' })
      } else if (data.status === 'Original') {
        setVerifyStatus({ type: 'original', message: `✅ ORIGINAL VERIFIED — This is the exact registered artwork. Owner: ${data.owner?.slice(0, 8)}...` })
      } else if (data.status === 'Plagiarism Detected') {
        setVerifyStatus({ type: 'plagiarism', message: `🚨 PLAGIARISM DETECTED — Visually identical to a registered work (Hamming Distance: ${data.score}). This is an edited/compressed copy of: ${data.matched_hash?.slice(0, 8)}...` })
      } else {
        setVerifyStatus({ type: 'clear', message: `✅ CLEAR — No visual match found (closest distance: ${data.score}). This appears to be an original new artwork.` })
      }
    } catch {
      setVerifyStatus({ type: 'error', message: '❌ Backend offline. Run: python main.py in the api/ folder.' })
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
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* ── Header ── */}
      <header className="border-b border-gray-800 px-10 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-blue-400 tracking-widest">VERITAS <span className="text-white font-light text-xl">Protocol</span></h1>
          <p className="text-xs text-gray-500 mt-0.5">Decentralized Copyright Registry on Algorand</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
            🗂 Registry: <strong className="text-white">{registryCount}</strong> work{registryCount !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setOpenWalletModal(true)}
            className="bg-blue-600 hover:bg-blue-500 px-5 py-2 rounded-full text-sm font-semibold transition-all"
          >
            {activeAddress ? `🟢 ${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <ConnectWallet openModal={openWalletModal} closeModal={() => setOpenWalletModal(false)} />

      {/* ── Tab Bar ── */}
      <div className="max-w-5xl mx-auto px-10 pt-6 flex gap-2 border-b border-gray-800 pb-0">
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-5 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'registry'
              ? 'border-blue-500 text-blue-400 bg-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          🛡️ Register &amp; Verify
        </button>
        <button
          onClick={() => setActiveTab('forensic')}
          className={`px-5 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'forensic'
              ? 'border-purple-500 text-purple-400 bg-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          🔬 Forensic Visualizer
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — Registry
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'registry' && (
        <div className="max-w-5xl mx-auto px-10 py-8 space-y-6">
          {/* How it works */}
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            {[
              { step: '1', icon: '🎨', title: 'Artist Registers', desc: 'Upload your original artwork. A 64-bit pHash visual fingerprint is generated and stored on Algorand.' },
              { step: '2', icon: '🔍', title: 'Suspect Image Uploaded', desc: 'Anyone can upload a suspect image to check if it visually matches a registered original.' },
              { step: '3', icon: '⚖️', title: 'Hamming Distance Check', desc: 'The system compares pixel patterns. Distance ≤ 10 = plagiarism. Distance > 10 = original new work.' },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl mb-2">{icon}</div>
                <div className="text-blue-400 font-bold text-xs uppercase tracking-widest mb-1">Step {step}</div>
                <div className="font-semibold mb-1">{title}</div>
                <div className="text-gray-400 text-xs leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>

          {/* Two-panel layout */}
          <div className="grid grid-cols-2 gap-6">
            {/* Panel 1: Register */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">STEP 1</span>
                <h2 className="text-lg font-bold">Register Original Artwork</h2>
              </div>
              <p className="text-gray-400 text-sm">Upload YOUR original artwork to claim ownership. This stores the visual fingerprint on-chain.</p>
              <div className="border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-xl p-6 text-center transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files && setRegisterFile(e.target.files[0])}
                  className="text-sm text-gray-300 cursor-pointer w-full"
                />
                {registerFile && <p className="text-xs text-blue-400 mt-2">📁 {registerFile.name}</p>}
              </div>
              <button
                onClick={registerArtwork}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all"
              >
                🛡️ Register Artwork
              </button>
              {registerStatus.type !== 'idle' && (
                <div className={`p-4 rounded-xl border text-sm font-mono leading-relaxed ${statusColors[registerStatus.type]}`}>
                  {registerStatus.message}
                </div>
              )}
            </div>

            {/* Panel 2: Verify */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">STEP 2</span>
                <h2 className="text-lg font-bold">Verify Suspect Artwork</h2>
              </div>
              <p className="text-gray-400 text-sm">Upload a SUSPECT image to check if it's a plagiarised copy of any registered original.</p>
              <div className="border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-xl p-6 text-center transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files && setVerifyFile(e.target.files[0])}
                  className="text-sm text-gray-300 cursor-pointer w-full"
                />
                {verifyFile && <p className="text-xs text-purple-400 mt-2">📁 {verifyFile.name}</p>}
              </div>
              <button
                onClick={verifyArtwork}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-all"
              >
                🔍 Verify Authenticity
              </button>
              {verifyStatus.type !== 'idle' && (
                <div className={`p-4 rounded-xl border text-sm font-mono leading-relaxed ${statusColors[verifyStatus.type]}`}>
                  {verifyStatus.message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — Forensic Visualizer
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'forensic' && (
        <div className="max-w-5xl mx-auto px-10 py-8 space-y-8">

          {/* Intro */}
          <div className="bg-gray-900 border border-purple-800/50 rounded-2xl p-6">
            <h2 className="text-xl font-bold text-purple-300 mb-2">🔬 Visual Forensic Analysis</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Upload any image to see <strong className="text-white">exactly how the algorithm perceives it</strong>.
              This panel exposes every step of the pHash pipeline — the same fingerprinting used on Algorand.
              Judges can verify that cropping, colour grading, or JPEG compression <span className="text-yellow-300">cannot bypass our registry</span>.
            </p>
          </div>

          {/* Pipeline Steps Reference */}
          <div className="grid grid-cols-2 gap-4">
            {PIPELINE_STEPS.map((s) => (
              <div key={s.num} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex gap-3">
                <div className="text-2xl mt-0.5">{s.icon}</div>
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
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-lg">Upload Image to Analyse</h3>
            <div className="flex gap-4 items-end">
              <div className="flex-1 border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-xl p-5 text-center transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files) {
                      setForensicFile(e.target.files[0])
                      setForensicData(null)
                      setForensicError(null)
                    }
                  }}
                  className="text-sm text-gray-300 cursor-pointer w-full"
                />
                {forensicFile && <p className="text-xs text-purple-400 mt-2">📁 {forensicFile.name}</p>}
              </div>
              <button
                onClick={runForensicAnalysis}
                disabled={forensicLoading || !forensicFile}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold px-6 py-3 rounded-xl transition-all"
              >
                {forensicLoading ? '⏳ Analysing...' : '🔬 Run Analysis'}
              </button>
            </div>
            {forensicError && (
              <div className="p-3 rounded-xl border border-yellow-600 bg-yellow-900/40 text-yellow-200 text-sm font-mono">
                ❌ {forensicError}
              </div>
            )}
          </div>

          {/* Results */}
          {forensicData && (
            <div className="space-y-6">

              {/* Row 1: Grayscale image + DCT heatmap */}
              <div className="grid grid-cols-2 gap-6">

                {/* Step 1 & 2 result — 32×32 grayscale */}
                <div className="bg-gray-900 border border-cyan-800/50 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-mono text-xs font-bold">STEP 01 OUTPUT</span>
                    <span className="text-sm font-semibold">32×32 Grayscale Preview</span>
                  </div>
                  <p className="text-gray-400 text-xs">The algorithm's entire worldview — 1024 pixels stripped of colour. Every pHash comparison is done on this image.</p>
                  <div className="flex justify-center">
                    <img
                      src={`data:image/png;base64,${forensicData.gray_32x32_b64}`}
                      alt="32x32 grayscale analysis"
                      className="rounded border border-gray-700 bg-black"
                      style={{
                        width: '160px',
                        height: '160px',
                        imageRendering: 'pixelated',
                      }}
                    />
                  </div>
                  <p className="text-center text-xs text-gray-500">Actual 32×32 pixels, scaled up 5× with pixelated rendering</p>
                </div>

                {/* Step 3 result — DCT low-freq heatmap 8×8 */}
                <div className="bg-gray-900 border border-yellow-800/50 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 font-mono text-xs font-bold">STEP 02–03 OUTPUT</span>
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
                <div className="bg-gray-900 border border-green-800/50 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-mono text-xs font-bold">STEP 04 OUTPUT</span>
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
                <div className="bg-gray-900 border border-green-800/50 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-mono text-xs font-bold">FINAL HASH</span>
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
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
                <h4 className="font-semibold text-sm mb-3 text-gray-300">⚡ Why Minor Edits Cannot Bypass This</h4>
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-400">
                  {[
                    { edit: '🎨 Colour grading', why: 'Grayscale step strips all colour information before hashing begins.' },
                    { edit: '✂️ Slight cropping', why: 'Resize to 32×32 re-normalises geometry; 5–10% crops barely change the grid.' },
                    { edit: '📦 JPEG compression', why: 'High-freq artefacts live outside the 8×8 low-pass window and are discarded.' },
                  ].map(({ edit, why }) => (
                    <div key={edit} className="bg-gray-800 rounded-xl p-3">
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
    </div>
  )
}
