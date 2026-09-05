# PayPilot AI demo recorder

This folder records the existing PayPilot AI UI. It does not modify or mock application state. The only intercepted browser requests are held briefly before their real responses are delivered, giving the recorded UI enough time to be read.

Prerequisites:

- PayPilot AI frontend at `http://localhost:3000`
- PayPilot AI backend health endpoint at `http://localhost:8000/health`
- Chrome or Edge installed
- Razorpay test credentials and a reachable Razorpay webhook endpoint
- `ffmpeg` on `PATH` (`winget install Gyan.FFmpeg`)

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\demo-video\run-demo.ps1
```

The script installs its local `playwright-core` dependency when needed, opens a visible 1920×1080 browser, records the real success and mandate-rejection flows, generates Windows TTS narration, and writes `output/paypilot-ai-demo.mp4`.

At Razorpay Checkout, complete the test payment in the visible browser. The recorder waits for the app's backend-verified webhook state and resumes automatically. It deliberately refuses to manufacture completion when the backend is in Razorpay mock mode.
