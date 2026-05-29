import numpy as np
import librosa
import os
import glob

def process_audio_to_text(input_wav, output_txt, fft_channels=32, fps=60, precision=4):
    """
    Converts a WAV file into normalized amplitude and FFT data at a target FPS,
    saving the result to a formatted text file.
    """
    # 1. Load the audio file (resampled to a standard rate, mono)
    # Using sr=None keeps the native sample rate
    y, sr = librosa.load(input_wav, sr=None, mono=True)

    # 2. Calculate frame parameters for exactly 60 FPS
    # hop_length is the number of audio samples between consecutive 60fps frames
    hop_length = int(sr / fps)

    # For a clean FFT with N channels, we want N frequency bins.
    # rfft returns (n_fft // 2) + 1 bins. So to get exactly `fft_channels`,
    # we set n_fft = (fft_channels - 1) * 2
    n_fft = (fft_channels - 1) * 2

    print(f"  Sample Rate: {sr} Hz")
    print(f"  Hop Length for {fps} FPS: {hop_length} samples")
    print(f"  STFT Window Size (n_fft): {n_fft} samples")

    # 3. Compute Short-Time Fourier Transform (STFT)
    # We use a Hann window and center=True to align frames with timestamps
    stft_matrix = librosa.stft(y, n_fft=n_fft, hop_length=hop_length, window='hann', center=True)

    # Get magnitudes and transpose so rows represent time frames
    fft_data = np.abs(stft_matrix).T

    # 4. Compute Overall Root-Mean-Square (RMS) Amplitude per frame
    # Match the hop/window parameters to keep timelines aligned
    rms_data = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop_length, center=True).T
    rms_data = rms_data.flatten()

    # 5. Normalize Data to 0.0 - 1.0 range
    # We normalize against the global maximums found across the entire file
    max_rms = np.max(rms_data) if np.max(rms_data) > 0 else 1.0
    rms_norm = rms_data / max_rms

    max_fft = np.max(fft_data) if np.max(fft_data) > 0 else 1.0
    fft_norm = fft_data / max_fft

    # Ensure strict clamping just in case
    rms_norm = np.clip(rms_norm, 0.0, 1.0)
    fft_norm = np.clip(fft_norm, 0.0, 1.0)

    # 6. Save to Text File
    # Create a dynamic formatting string based on requested precision digits
    fmt_str = f"%.{precision}f"

    num_frames = min(len(rms_norm), len(fft_norm))

    with open(output_txt, 'w') as f:
        # Header lines (lines starting with # are comments, skip when parsing)
        f.write(f"# Audio data extracted from: {os.path.basename(input_wav)}\n")
        f.write(f"# fps={fps} channels={fft_channels} precision={precision} frames={num_frames}\n")
        f.write(f"# Each row: col 0 = overall RMS amplitude (0.0–1.0, normalised to loudest frame)\n")
        f.write(f"#            col 1..{fft_channels} = FFT magnitude per frequency bin, low→high\n")
        f.write(f"#                    (each bin normalised to its global max across the file)\n")
        f.write(f"# Total values per row: {fft_channels + 1}  (1 amplitude + {fft_channels} FFT bins)\n")

        for i in range(num_frames):
            amp_val = fmt_str % rms_norm[i]
            fft_vals = [fmt_str % val for val in fft_norm[i]]
            line = amp_val + " " + " ".join(fft_vals) + "\n"
            f.write(line)

    print(f"  → {num_frames} frames written to '{output_txt}'")


if __name__ == "__main__":
    # Parameters — adjust as needed
    FFT_CHANNELS = 32   # N frequency bins
    FPS          = 60   # Target frames per second
    PRECISION    = 4    # Decimal digits (0.0000 – 1.0000)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    wav_files  = glob.glob(os.path.join(script_dir, "*.wav"))

    if not wav_files:
        print("No WAV files found in this directory.")
    else:
        for wav_path in sorted(wav_files):
            base = os.path.splitext(os.path.basename(wav_path))[0]
            out_path = os.path.join(script_dir, base + ".txt")
            print(f"Processing: {os.path.basename(wav_path)}")
            process_audio_to_text(wav_path, out_path, FFT_CHANNELS, FPS, PRECISION)
