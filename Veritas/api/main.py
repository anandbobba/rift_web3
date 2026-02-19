from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import imagehash
from PIL import Image
import io

app = FastAPI(title="Veritas Perceptual Hashing API")

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def calculate_phash(image_bytes: bytes) -> str:
    """Calculates the 64-bit Perceptual Hash of an image."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        hash_val = imagehash.phash(img)
        return str(hash_val)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image content: {str(e)}")

@app.post("/calculate-hash")
async def get_hash(file: UploadFile = File(...)):
    """Accepts an image and returns its pHash string."""
    content = await file.read()
    phash_str = calculate_phash(content)
    return {"hash": phash_str}

@app.post("/verify-infringement")
async def verify_infringement(
    file: UploadFile = File(...),
    target_hash: str = Form(...)
):
    """
    Accepts a 'suspect' image and a 'target' hash string.
    Calculates Hamming Distance and detects plagiarism if distance < 10.
    """
    content = await file.read()
    suspect_hash_str = calculate_phash(content)

    try:
        suspect_hash = imagehash.hex_to_hash(suspect_hash_str)
        reference_hash = imagehash.hex_to_hash(target_hash)

        distance = suspect_hash - reference_hash

        if distance < 10:
            return {
                "match": True,
                "score": int(distance),
                "message": "Plagiarism Detected"
            }
        else:
            return {
                "match": False,
                "score": int(distance),
                "message": "No significant similarity detected"
            }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error comparing hashes: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
