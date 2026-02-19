from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import imagehash
from PIL import Image, ImageFilter
import io
import base64
import numpy as np
from scipy.fft import dctn

app = FastAPI(title="Veritas Protocol API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory registry (simulating Algorand on-chain Box storage)
# Maps pHash string -> owner address
REGISTRY: dict[str, str] = {}

# ── 8-Way Symmetry Transform Table ───────────────────────────────────────────
# A pirate cannot bypass the registry by rotating or mirroring the canvas.
# We test the suspect image against all 8 orientations of the Dihedral group D4.
SYMMETRY_TRANSFORMS = [
    ("Original",               lambda img: img),
    ("90deg Rotation",         lambda img: img.rotate(90, expand=True)),
    ("180deg Rotation",        lambda img: img.rotate(180)),
    ("270deg Rotation",        lambda img: img.rotate(270, expand=True)),
    ("Horizontal Mirror",      lambda img: img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
    ("Mirrored 90deg Rotation",  lambda img: img.rotate(90, expand=True).transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
    ("Mirrored 180deg Rotation", lambda img: img.rotate(180).transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
    ("Mirrored 270deg Rotation", lambda img: img.rotate(270, expand=True).transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
]


def denoise(img: Image.Image) -> Image.Image:
    """
    Adversarial Noise Defense: Apply a 3x3 Median Blur to suppress
    imperceptible high-frequency adversarial perturbations. This squeezes
    out any digital noise that could alter the hash without changing the
    visible artwork.
    """
    return img.convert("RGB").filter(ImageFilter.MedianFilter(size=3))


def compute_phash(img: Image.Image) -> imagehash.ImageHash:
    """Denoise then compute pHash — registry always uses the denoised hash."""
    return imagehash.phash(denoise(img))


@app.post("/register")
async def register_artwork(file: UploadFile = File(...), owner: str = "unknown"):
    """ARTIST endpoint: Registers an original artwork's visual fingerprint."""
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))
        phash = compute_phash(img)
        phash_str = str(phash)

        if phash_str in REGISTRY:
            return {
                "status": "Already Registered",
                "phash": phash_str,
                "owner": REGISTRY[phash_str],
                "message": "This exact artwork is already in the registry."
            }

        REGISTRY[phash_str] = owner
        print(f"[REGISTER] Hash: {phash_str} | Owner: {owner} | Registry: {len(REGISTRY)} work(s)")
        return {
            "status": "Registered",
            "phash": phash_str,
            "owner": owner,
            "message": f"Visual fingerprint stored on-chain. Registry now has {len(REGISTRY)} work(s)."
        }
    except Exception as e:
        return {"error": str(e)}


@app.post("/verify")
async def verify_artwork(file: UploadFile = File(...)):
    """
    VERIFIER endpoint: Multi-layered forensic scan.
      Layer 1 — Adversarial Noise Defense: Median blur denoising before hashing.
      Layer 2 — 8-Way Symmetry Invariance: Test all 4 rotations x 2 mirror states.
      Layer 3 — pHash Structural Comparison: Hamming distance on DCT skeleton.
    Does NOT modify the registry.
    """
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))

        if not REGISTRY:
            return {"status": "No Registry", "message": "No artworks have been registered yet."}

        best_distance = None
        best_match_hash = None
        best_match_owner = None
        best_transform = "Original"

        # Check all 8 orientations of the suspect image
        for transform_name, transform_fn in SYMMETRY_TRANSFORMS:
            try:
                transformed = transform_fn(img)
                suspect_hash = compute_phash(transformed)

                for stored_hash_str, owner in REGISTRY.items():
                    stored_hash = imagehash.hex_to_hash(stored_hash_str)
                    distance = suspect_hash - stored_hash
                    print(f"[VERIFY] {transform_name:28s} dist={distance:3d} vs {stored_hash_str[:8]}...")

                    if best_distance is None or distance < best_distance:
                        best_distance = distance
                        best_match_hash = stored_hash_str
                        best_match_owner = owner
                        best_transform = transform_name

                    if best_distance == 0:
                        break

            except Exception as transform_err:
                print(f"[VERIFY] Transform error ({transform_name}): {transform_err}")
                continue

            if best_distance == 0:
                break

        detection_method = f"Detected via {best_transform}"

        if best_distance == 0:
            return {
                "status": "Original",
                "score": 0,
                "matched_hash": best_match_hash,
                "owner": best_match_owner,
                "detection_method": detection_method,
                "message": "Pixel-perfect match — this is the registered original."
            }

        if best_distance <= 10:
            return {
                "status": "Plagiarism Detected",
                "score": int(best_distance),
                "matched_hash": best_match_hash,
                "owner": best_match_owner,
                "detection_method": detection_method,
                "message": (
                    f"Visually identical to a registered work "
                    f"(Hamming Distance: {best_distance}, transform: {best_transform}). "
                    f"Likely an edited/compressed/rotated copy."
                )
            }

        return {
            "status": "Clear",
            "score": int(best_distance),
            "detection_method": f"All 8 orientations tested — best: {best_transform} (dist={best_distance})",
            "message": (
                f"No visual match found across all 8 orientations "
                f"(closest distance: {best_distance}). This artwork appears original."
            )
        }

    except Exception as e:
        return {"error": str(e)}


@app.post("/analyze")
async def analyze_artwork(file: UploadFile = File(...)):
    """
    FORENSIC endpoint: Full multi-layer pipeline visualisation.
    Pipeline:
      Step 01 — Adversarial Noise Defense: Median Blur (3x3)
      Step 02 — Grayscale + 32x32 resize
      Step 03 — 2D DCT -> frequency domain
      Step 04 — Top-left 8x8 low-pass filter
      Step 05 — Median threshold -> 64-bit bitmask = pHash
    Returns intermediate artifacts so the frontend can visualise each step.
    Also returns the original (un-denoised) grayscale for side-by-side comparison.
    """
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))

        # --- Step 01: Adversarial noise defense ---
        denoised_rgb = denoise(img)

        # --- Step 02: Grayscale + 32x32 resize (denoised) ---
        gray = denoised_rgb.convert("L").resize((32, 32), Image.LANCZOS)

        buf = io.BytesIO()
        gray.save(buf, format="PNG")
        gray_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        # Original (no denoising) for side-by-side comparison in UI
        gray_original = img.convert("L").resize((32, 32), Image.LANCZOS)
        buf2 = io.BytesIO()
        gray_original.save(buf2, format="PNG")
        gray_original_b64 = base64.b64encode(buf2.getvalue()).decode("utf-8")

        pixels = list(gray.getdata())  # 1024 values row-major

        # --- Step 03: 2D DCT on denoised grayscale ---
        arr = np.array(gray, dtype=float)
        dct_matrix = dctn(arr, norm="ortho")

        # --- Step 04: Low-pass filter — top-left 8x8 ---
        low_freq = dct_matrix[:8, :8]
        coeffs_full = low_freq.flatten()     # 64 values for bitmask
        coeffs_no_dc = coeffs_full[1:]       # 63 values for median (skip DC offset)

        # --- Step 05: Median threshold -> bitmask ---
        median_val = float(np.median(coeffs_no_dc))
        bits = [1 if float(c) > median_val else 0 for c in coeffs_full]
        binary_str = "".join(str(b) for b in bits)

        # Official imagehash pHash on the denoised image (matches /register)
        official_phash = str(imagehash.phash(denoised_rgb))

        # Normalised DCT coefficients for heatmap (0-255)
        dct_norm = low_freq.copy()
        dct_min, dct_max = dct_norm.min(), dct_norm.max()
        if dct_max != dct_min:
            dct_norm = (dct_norm - dct_min) / (dct_max - dct_min) * 255
        dct_flat = [float(v) for v in dct_norm.flatten()]

        print(f"[ANALYZE] pHash: {official_phash} | Median: {median_val:.2f} | Bits: {binary_str[:16]}...")

        return {
            "phash_hex": official_phash,
            "phash_binary": binary_str,
            "median_frequency": round(median_val, 4),
            "bitmask_8x8": bits,
            "dct_heatmap": dct_flat,
            "gray_32x32_b64": gray_b64,          # denoised (what the algo hashes)
            "gray_original_b64": gray_original_b64, # raw (before denoising)
            "pixels_32x32": pixels,
        }

    except Exception as e:
        return {"error": str(e)}


@app.get("/registry")
async def get_registry():
    """Returns all registered hashes and the count."""
    return {
        "count": len(REGISTRY),
        "hashes": [
            {"phash": h, "owner": o, "short": h[:8] + "..."}
            for h, o in REGISTRY.items()
        ]
    }


@app.delete("/registry")
async def clear_registry():
    """Clears the in-memory registry (for testing only)."""
    REGISTRY.clear()
    return {"message": "Registry cleared."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
