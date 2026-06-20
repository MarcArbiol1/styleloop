"""Fashion image embedder (shared by the indexer and the server).

Uses Marqo-FashionSigLIP — a SigLIP model fine-tuned for fashion that matches
design/style/color far better than the older FashionCLIP. Loaded via open_clip.
Returns L2-normalized vectors.
"""
import numpy as np
import torch
import open_clip

MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"
DIM = 768  # set for real at load time from the model's output

_model = None
_preprocess = None


def _device():
    if torch.backends.mps.is_available():   # Apple Silicon GPU
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model():
    global _model, _preprocess
    if _model is None:
        print(f"Loading {MODEL_NAME} on {_device()} (first run downloads the model)...")
        model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME)
        _model = model.to(_device()).eval()
        _preprocess = preprocess
    return _model, _preprocess


def embed_image(pil_image):
    """Return an L2-normalized float32 vector for a PIL image."""
    global DIM
    model, preprocess = load_model()
    img_t = preprocess(pil_image.convert("RGB")).unsqueeze(0).to(_device())
    with torch.no_grad():
        feats = model.encode_image(img_t)
    feats = torch.nn.functional.normalize(feats, p=2, dim=-1)
    vec = feats[0].cpu().numpy().astype(np.float32)
    DIM = vec.shape[0]
    return vec
